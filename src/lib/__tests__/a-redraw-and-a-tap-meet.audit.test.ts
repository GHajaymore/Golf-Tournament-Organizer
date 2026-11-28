import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

/**
 * A REDRAW AND A TAP AT THE SAME MOMENT (B134), on two real connections.
 *
 * `drawLeagueWeek`, `generateTeamMatches` and `autoDrawTeams` re-ask the one redraw rule inside their transaction
 * (`redrawRefusalUnderLock`), and that function first locks the round's rows `FOR UPDATE` in one order: Event, Team, Match,
 * MatchScorecard, TeamScorecard. A hole tap's `UPDATE "Match"` already takes that row's lock and a card INSERT already takes
 * `FOR KEY SHARE` on its parent, so the scoring path gains nothing. `prisma` is the fixture client; `racer` is a second
 * client that plays the phone. A wait is SEEN in `pg_stat_activity` / `pg_blocking_pids` keyed on the racer's own backend
 * pid, so other sessions on the development database do not confuse it; a wait that never comes FAILS in words after 3 s.
 *
 *   1. a tap in flight: the redraw waits on it (a `FOR UPDATE`), then sees it and is refused; the tap stands.
 *   2. a tap AFTER the re-check, before the delete: the tap waits on the redraw's lock; once the matches are gone it is
 *      told (P2025), never silently lost. (autoDrawTeams leaves matches alone, so there the tap simply lands.)
 *   3. a match card updated in flight (generateTeamMatches, drawLeagueWeek): the card lock waits, then refuses.
 *   4. a team card inserted in flight (autoDrawTeams): the Team lock waits, then refuses.
 *   5. CONTROLS: no racer, the redraw runs; two first "Generate" presses together draw ONE round robin.
 *
 *   npx vitest run --config vitest.audit.config.ts src/lib/__tests__/a-redraw-and-a-tap-meet.audit.test.ts
 */

const prisma = new PrismaClient();
const racer = new PrismaClient();
const TAG = "zz-redraw-race";

const session = {
  email: `${TAG}@example.invalid`,
  name: `${TAG} organizer`,
  eventId: "",
  role: "admin",
  viewRole: "admin",
};
vi.mock("@/lib/auth", () => ({ getSession: async () => session, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/services/board-refresh", () => ({ boardChanged: () => {} }));

/** Runs after the REAL locked re-check has returned, inside the redraw's open transaction (case 2). */
let afterRecheck: (() => Promise<void>) | null = null;
vi.mock("@/lib/services/round-cards", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/services/round-cards")>();
  return {
    ...real,
    redrawRefusalUnderLock: async (...args: Parameters<typeof real.redrawRefusalUnderLock>) => {
      const refusal = await real.redrawRefusalUnderLock(...args);
      if (afterRecheck) await afterRecheck();
      return refusal;
    },
  };
});

const { drawLeagueWeek } = await import("@/app/actions/league");
const { generateTeamMatches, autoDrawTeams } = await import("@/app/actions/teams");

const EMPTY = JSON.stringify(new Array(18).fill(null));
const TAPPED = JSON.stringify(["A", ...new Array(17).fill(null)]);
const ONE_STROKE = JSON.stringify([4, ...new Array(17).fill(null)]);
const REFUSAL = /^Round [0-9]+ has scores — clear them on Score entry first[.]$/;

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

let counter = 0;
async function makeEvent(kind: "league" | "plain") {
  counter += 1;
  const name = `${kind}-${counter}`;
  const org = await prisma.organization.create({ data: { name: `${TAG} ${name} club`, kind: "club" }, select: { id: true } });
  const league = kind === "league";
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} ${name}`,
      status: league ? "live" : "draft",
      launchedAt: league ? new Date() : null,
      shape: league ? "series" : "tournament",
      format: "stroke",
      formationRule: "balanced",
      leaguePoints: league ? "match" : "",
      dates: "", course: "", city: "", address: "", regDeadline: "", capacity: 0,
      shareToken: randomBytes(12).toString("hex"),
      registrationToken: randomBytes(8).toString("hex"),
    },
    select: { id: true },
  });
  const stageId = (
    await prisma.stage.create({ data: { eventId: event.id, position: 0, type: "Round Robin", format: "Four-Ball", holes: 18 }, select: { id: true } })
  ).id;
  return { eventId: event.id, stageId };
}

interface Scenario {
  door: string;
  eventId: string;
  stageId: string;
  redraw: () => Promise<{ ok: boolean; error?: string }>;
  /** What a redraw replaces: the matches (the two match doors) or the stage's sides (autoDrawTeams). */
  ids: () => Promise<string[]>;
  /** One match to tap, with its card. */
  matchId: string;
}

const matchIds = async (eventId: string, stageId: string) =>
  (await prisma.match.findMany({ where: { eventId, stageId }, select: { id: true }, orderBy: { id: "asc" } })).map((m) => m.id);

async function scenario(door: "drawLeagueWeek" | "generateTeamMatches" | "autoDrawTeams"): Promise<Scenario> {
  if (door === "drawLeagueWeek") {
    const { eventId, stageId } = await makeEvent("league");
    const clubs: string[] = [];
    for (let c = 0; c < 2; c += 1) {
      clubs.push((await prisma.group.create({ data: { eventId, name: `${TAG} club ${c}`, position: c }, select: { id: true } })).id);
    }
    for (let c = 0; c < 2; c += 1) {
      for (let p = 0; p < 2; p += 1) {
        await prisma.team.create({ data: { eventId, stageId, clubGroupId: clubs[c], name: `${TAG} c${c} p${p}`, seed: p + 1 } });
      }
    }
    session.eventId = eventId;
    expect(await drawLeagueWeek(stageId, false)).toMatchObject({ ok: true });
    return {
      door, eventId, stageId,
      redraw: () => drawLeagueWeek(stageId, true),
      ids: () => matchIds(eventId, stageId),
      matchId: (await matchIds(eventId, stageId))[0],
    };
  }
  if (door === "generateTeamMatches") {
    const { eventId, stageId } = await makeEvent("plain");
    for (let i = 1; i <= 4; i += 1) await prisma.team.create({ data: { eventId, name: `${TAG} side ${i}`, seed: i } });
    session.eventId = eventId;
    expect(await generateTeamMatches(stageId, false)).toMatchObject({ ok: true });
    return {
      door, eventId, stageId,
      redraw: () => generateTeamMatches(stageId, true),
      ids: () => matchIds(eventId, stageId),
      matchId: (await matchIds(eventId, stageId))[0],
    };
  }
  const { eventId, stageId } = await makeEvent("plain");
  for (let i = 0; i < 4; i += 1) {
    await prisma.player.create({
      data: { eventId, name: `${TAG} auto p${i}`, email: `${TAG}-auto${i}-${counter}@example.invalid`, handicap: i, seed: i + 1, status: "confirmed" },
    });
  }
  const a = await prisma.team.create({ data: { eventId, stageId, name: `${TAG} auto a`, seed: 1 }, select: { id: true } });
  const b = await prisma.team.create({ data: { eventId, stageId, name: `${TAG} auto b`, seed: 2 }, select: { id: true } });
  const group = await prisma.group.create({ data: { eventId, stageId, isCarrier: true, name: `${TAG} auto carrier`, position: 9 }, select: { id: true } });
  const match = await prisma.match.create({
    data: { eventId, stageId, groupId: group.id, round: 1, playerAId: "", playerBId: "", teamAId: a.id, teamBId: b.id, holes: EMPTY },
    select: { id: true },
  });
  session.eventId = eventId;
  return {
    door, eventId, stageId,
    redraw: () => autoDrawTeams(stageId, true),
    ids: async () => (await prisma.team.findMany({ where: { eventId, stageId }, select: { id: true }, orderBy: { id: "asc" } })).map((t) => t.id),
    matchId: match.id,
  };
}

/** A write on the racer's own connection, held open until `release()`; `pid` is its backend process id. */
function holdWrite(work: (t: Parameters<Parameters<typeof racer.$transaction>[0]>[0]) => Promise<unknown>) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let pidReady!: (pid: number) => void;
  const pid = new Promise<number>((r) => (pidReady = r));
  let heldReady!: () => void;
  const held = new Promise<void>((r) => (heldReady = r));
  const done = racer.$transaction(
    async (t) => {
      const [{ pid: p }] = await t.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      pidReady(p);
      await work(t);
      heldReady();
      await gate;
    },
    { timeout: 20_000 },
  );
  done.catch(() => {
    pidReady(0);
    heldReady();
  });
  return { pid, held, release, done };
}

/** Wait (at most 3 s, then FAIL in words) until some query is blocked by `holderPid` and its text matches. */
async function waitBlockedBy(holderPid: number, what: RegExp): Promise<string> {
  const end = Date.now() + 3000;
  let last: string[] = [];
  while (Date.now() < end) {
    const rows = await prisma.$queryRaw<{ query: string }[]>`
      SELECT a.query FROM pg_stat_activity a WHERE ${holderPid}::int = ANY(pg_blocking_pids(a.pid))`;
    last = rows.map((r) => r.query);
    const hit = last.find((q) => what.test(q));
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`Nothing matching ${what} was waiting on the tap within 3 s (waiting: ${JSON.stringify(last)}), so the redraw did not lock the round's rows first.`);
}

/** Wait (at most 3 s, then FAIL in words) until the connection `pid` is itself blocked by another session. */
async function waitUntilBlocked(pid: number): Promise<void> {
  const end = Date.now() + 3000;
  while (Date.now() < end) {
    const [row] = await prisma.$queryRaw<{ n: number }[]>`SELECT cardinality(pg_blocking_pids(${pid}::int))::int AS n`;
    if (row.n > 0) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("The tap was never made to wait: the redraw holds no lock on the match it deletes.");
}

beforeAll(cleanup);
afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
    await racer.$disconnect();
  }
});

const DOORS = ["drawLeagueWeek", "generateTeamMatches", "autoDrawTeams"] as const;

for (const door of DOORS) {
  describe(`${door}: a redraw and a tap at the same moment`, () => {
    it("1. a tap in flight is waited for, then seen: refused, the ids and the tapped hole stand", async () => {
      const s = await scenario(door);
      const before = await s.ids();
      const tap = holdWrite((t) => t.match.update({ where: { id: s.matchId }, data: { holes: TAPPED } }));
      try {
        const holderPid = await tap.pid;
        await tap.held;
        expect(holderPid).toBeGreaterThan(0);
        const redraw = s.redraw();
        expect(await waitBlockedBy(holderPid, /FOR UPDATE/i)).toMatch(/FOR UPDATE/i);
        tap.release();
        await tap.done;
        expect(await redraw).toEqual({ ok: false, error: expect.stringMatching(REFUSAL) });
        expect(await s.ids()).toEqual(before);
        expect((await prisma.match.findUniqueOrThrow({ where: { id: s.matchId } })).holes).toBe(TAPPED);
      } finally {
        tap.release();
        await tap.done.catch(() => {});
      }
    }, 30_000);

    it("2. a tap after the re-check waits on the redraw's lock and is never silently lost", async () => {
      const s = await scenario(door);
      let racerWrite: Promise<unknown> | null = null;
      afterRecheck = async () => {
        afterRecheck = null;
        const tap = holdWrite((t) => t.match.update({ where: { id: s.matchId }, data: { holes: TAPPED } }));
        racerWrite = tap.done;
        racerWrite.catch(() => {});
        // The write is in flight on its own connection; the redraw goes on only once it is seen to WAIT.
        await waitUntilBlocked(await tap.pid);
        tap.release();
      };
      try {
        expect(await s.redraw()).toMatchObject({ ok: true });
        if (door === "autoDrawTeams") {
          // Matches are not redrawn by a sides redraw: the tap waited, then landed.
          await racerWrite;
          expect((await prisma.match.findUniqueOrThrow({ where: { id: s.matchId } })).holes).toBe(TAPPED);
        } else {
          await expect(racerWrite!).rejects.toMatchObject({ code: "P2025" });
          expect(await prisma.match.count({ where: { eventId: s.eventId, stageId: s.stageId, holes: TAPPED } })).toBe(0);
        }
      } finally {
        afterRecheck = null;
      }
    }, 30_000);
  });
}

for (const door of ["drawLeagueWeek", "generateTeamMatches"] as const) {
  describe(`${door}: a match card updated in flight`, () => {
    it("3. the card lock waits, then the redraw is refused and the card stands", async () => {
      const s = await scenario(door);
      const card = await prisma.matchScorecard.create({ data: { eventId: s.eventId, matchId: s.matchId, slot: "A", strokes: EMPTY } });
      const before = await s.ids();
      const write = holdWrite((t) => t.matchScorecard.update({ where: { id: card.id }, data: { strokes: ONE_STROKE } }));
      try {
        const holderPid = await write.pid;
        await write.held;
        const redraw = s.redraw();
        expect(await waitBlockedBy(holderPid, /MatchScorecard/)).toMatch(/FOR UPDATE/i);
        write.release();
        await write.done;
        expect(await redraw).toEqual({ ok: false, error: expect.stringMatching(REFUSAL) });
        expect(await s.ids()).toEqual(before);
        expect((await prisma.matchScorecard.findUniqueOrThrow({ where: { id: card.id } })).strokes).toBe(ONE_STROKE);
      } finally {
        write.release();
        await write.done.catch(() => {});
      }
    }, 30_000);
  });
}

describe("autoDrawTeams: a team card inserted in flight", () => {
  it("4. the Team lock waits, then the redraw is refused and the sides stand", async () => {
    const s = await scenario("autoDrawTeams");
    const before = await s.ids();
    const write = holdWrite((t) =>
      t.teamScorecard.create({ data: { eventId: s.eventId, stageId: s.stageId, teamId: before[0], strokes: ONE_STROKE } }),
    );
    try {
      const holderPid = await write.pid;
        await write.held;
      const redraw = s.redraw();
      expect(await waitBlockedBy(holderPid, /"(Event|Team)"/)).toMatch(/FOR UPDATE/i);
      write.release();
      await write.done;
      expect(await redraw).toEqual({ ok: false, error: expect.stringMatching(REFUSAL) });
      expect(await s.ids()).toEqual(before);
    } finally {
      write.release();
      await write.done.catch(() => {});
    }
  }, 30_000);
});

describe("CONTROLS: nothing racing", () => {
  for (const door of DOORS) {
    it(`5. ${door} redraws, and the ids change`, async () => {
      const s = await scenario(door);
      const before = await s.ids();
      expect(await s.redraw()).toMatchObject({ ok: true });
      const after = await s.ids();
      expect(after.length).toBeGreaterThan(0);
      expect(after.some((id) => before.includes(id))).toBe(false);
    }, 30_000);
  }

  it("5. two first 'Generate' presses together draw ONE round robin, not two", async () => {
    const { eventId, stageId } = await makeEvent("plain");
    for (let i = 1; i <= 4; i += 1) await prisma.team.create({ data: { eventId, name: `${TAG} dbl side ${i}`, seed: i } });
    session.eventId = eventId;
    const [x, y] = await Promise.all([generateTeamMatches(stageId, false), generateTeamMatches(stageId, false)]);
    expect([x.ok, y.ok].filter(Boolean)).toHaveLength(1);
    expect([x, y].find((r) => !r.ok)).toMatchObject({ needsConfirm: true });
    // Four sides meet once each: six matches.
    expect(await prisma.match.count({ where: { eventId, stageId } })).toBe(6);
  }, 30_000);
});
