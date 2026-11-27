import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

/**
 * A LEAGUE'S WRITES ARE OPEN ALL SEASON AND REFUSED ONCE THE TOURNAMENT IS COMPLETED (B115b), AND ITS SIDES HAVE ONE DOOR.
 *
 * `nominatePair`, `withdrawPair`, `setLeagueSettings` and `setPlayoffHoleWinner` asked no lock, so a COMPLETED season's
 * pairs, its scoring rules and its play-off result could still be changed (the table is derived on every read, so a change
 * re-scores a FINAL table). A live league does all of them all season, so the lock cannot be the launch lock: each asks
 * `refuseIfCompleted(eventId, "sides", what)`, the machine's words, returned, with the lock for the screen to catch up with.
 *
 * AND THE GENERIC SIDE WRITES REFUSE A LEAGUE. A pair is a `Team` with `clubGroupId` set; `createTeam`, `deleteTeam`,
 * `addTeamMember` and `removeTeamMember` write the same rows with their own lock and none of the club-roster rule, so
 * they could put another club's player into a pair. They answer `LEAGUE_SIDES_REFUSAL`.
 *
 * THE CONTROLS are the point of (b) and (e): the same presses on the same launched league go through, and the same generic
 * presses on a tournament that is not a league go through, so each refusal is what it says it is and not a press that
 * refuses everything.
 *
 *   npx vitest run --config vitest.audit.config.ts src/lib/__tests__/league-writes-are-refused-when-completed.audit.test.ts
 */

const prisma = new PrismaClient();
const TAG = "zz-league-writes";

const session = {
  email: `${TAG}@example.invalid`,
  name: `${TAG} organizer`,
  eventId: "",
  role: "admin" as "admin" | "assistant",
  viewRole: "admin",
};
vi.mock("@/lib/auth", () => ({ getSession: async () => session, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/services/board-refresh", () => ({ boardChanged: () => {} }));

const { nominatePair, withdrawPair, setLeagueSettings, setPlayoffHoleWinner } = await import("@/app/actions/league");
const { createTeam, deleteTeam, addTeamMember, removeTeamMember } = await import("@/app/actions/teams");
const { lockRefusalWords } = await import("@/lib/domain/tournament-status");
const { LEAGUE_SIDES_REFUSAL } = await import("@/lib/domain/league-meeting");

let week = "";
const clubs: string[] = [];
const p: Record<string, string> = {};
let plainEvent = "";
let plainStage = "";
const plain: string[] = [];

const SETTINGS = { points: "match", matchBonus: 2, pairs: 2, playoffs: 0 };

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

const eventOf = (name: string, extra: Record<string, unknown>, orgId: string) =>
  prisma.event.create({
    data: {
      organizationId: orgId,
      name: `${TAG} ${name}`,
      shape: "series",
      format: "stroke",
      formationRule: "balanced",
      dates: "", course: "", city: "", address: "", regDeadline: "", capacity: 0,
      shareToken: randomBytes(12).toString("hex"),
      registrationToken: randomBytes(8).toString("hex"),
      ...extra,
    },
    select: { id: true },
  });

const player = (eventId: string, who: string, i: number, groupId: string | null) =>
  prisma.player.create({
    data: {
      eventId,
      name: `${TAG} ${who}`,
      email: `${TAG}.${who}@example.invalid`.toLowerCase(),
      handicap: 10 + i,
      handicapType: "18",
      seed: i + 1,
      status: "confirmed",
      groupId,
    },
    select: { id: true },
  });

const setStatus = (status: "live" | "completed" | "draft") =>
  prisma.event.update({ where: { id: session.eventId }, data: { status } });

/** Everything these four writes could change, as one comparable value. */
async function snapshot() {
  const [teams, event, holes] = await Promise.all([
    prisma.team.findMany({
      where: { eventId: session.eventId },
      orderBy: { id: "asc" },
      select: { id: true, name: true, clubGroupId: true, members: { orderBy: { position: "asc" }, select: { playerId: true } } },
    }),
    prisma.event.findUniqueOrThrow({
      where: { id: session.eventId },
      select: { leaguePoints: true, leagueMatchBonus: true, leaguePairs: true, leaguePlayoffClubs: true },
    }),
    prisma.leaguePlayoffHole.count({ where: { eventId: session.eventId } }),
  ]);
  return { teams, event, holes };
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" }, select: { id: true } });
  // LAUNCHED and live: the state a league is in all season, and the one the completion lock must not refuse.
  const event = await eventOf(
    "league",
    { status: "live", launchedAt: new Date(), leaguePoints: "match", leagueMatchBonus: 2, leaguePairs: 2, leaguePlayoffClubs: 0 },
    org.id,
  );
  session.eventId = event.id;
  for (let c = 0; c < 2; c += 1) {
    clubs.push((await prisma.group.create({ data: { eventId: event.id, name: `${TAG} club ${c}`, position: c }, select: { id: true } })).id);
  }
  week = (await prisma.stage.create({ data: { eventId: event.id, position: 0, type: "Round Robin", format: "Four-Ball", holes: 18 }, select: { id: true } })).id;
  // Club 0: A1..A4. Club 1: B1, B2.
  let i = 0;
  for (const who of ["A1", "A2", "A3", "A4"]) p[who] = (await player(event.id, who, i++, clubs[0])).id;
  for (const who of ["B1", "B2"]) p[who] = (await player(event.id, who, i++, clubs[1])).id;

  // A tournament that is NOT a league, still being set up: the generic presses' control.
  const other = await eventOf("plain", { status: "draft" }, org.id);
  plainEvent = other.id;
  plainStage = (await prisma.stage.create({ data: { eventId: other.id, position: 0, type: "Round Robin", format: "Four-Ball", holes: 18 }, select: { id: true } })).id;
  for (const [n, who] of ["C1", "C2"].entries()) plain.push((await player(other.id, who, 20 + n, null)).id);
}, 120_000);

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("CONTROL: on the launched, live league the four writes go through and write", () => {
  it("nominate, change the settings, withdraw, and a play-off press is not refused by any lock", async () => {
    expect(await nominatePair(week, clubs[0], [p.A1, p.A2])).toEqual({ ok: true });
    const pair = await prisma.team.findFirstOrThrow({ where: { eventId: session.eventId, stageId: week, clubGroupId: clubs[0] }, select: { id: true } });
    expect(await prisma.teamMember.count({ where: { teamId: pair.id } })).toBe(2);

    expect(await setLeagueSettings({ ...SETTINGS, matchBonus: 3 })).toEqual({ ok: true });
    expect((await snapshot()).event).toMatchObject({ leaguePoints: "match", leagueMatchBonus: 3 });
    expect(await setLeagueSettings(SETTINGS)).toEqual({ ok: true });

    // The play-off press needs a played meeting to succeed; what matters here is that no LOCK answers it.
    const decided = await setPlayoffHoleWinner(week, clubs[0], clubs[1], clubs[0]);
    expect(decided).toMatchObject({ ok: false });
    expect(decided).not.toHaveProperty("lock");
    expect(decided.ok === false && decided.error).toBe("Those clubs did not meet in this round.");

    expect(await withdrawPair(pair.id)).toEqual({ ok: true });
    expect(await prisma.team.count({ where: { eventId: session.eventId } })).toBe(0);
  });
});

describe("completed: each of the four is refused in the machine's words, with its lock, and nothing is written", () => {
  it("nominate, withdraw, settings and the play-off decision", async () => {
    // A pair put up while the league was live, so there is something to withdraw.
    expect(await nominatePair(week, clubs[0], [p.A3, p.A4])).toEqual({ ok: true });
    const pair = await prisma.team.findFirstOrThrow({ where: { eventId: session.eventId, stageId: week }, select: { id: true } });
    const before = await snapshot();
    await setStatus("completed");
    try {
      const presses: [string, string, () => Promise<{ ok: boolean; error?: string; lock?: { by: string; scope: string } }>][] = [
        ["nominate a pair", "nominatePair", () => nominatePair(week, clubs[1], [p.B1, p.B2])],
        ["withdraw a pair", "withdrawPair", () => withdrawPair(pair.id)],
        ["change the league's settings", "setLeagueSettings", () => setLeagueSettings({ ...SETTINGS, matchBonus: 9, pairs: 5, playoffs: 2 })],
        ["record a play-off result", "setPlayoffHoleWinner", () => setPlayoffHoleWinner(week, clubs[0], clubs[1], clubs[0])],
      ];
      for (const [what, name, press] of presses) {
        const res = await press();
        expect(res, name).toMatchObject({ ok: false, lock: { scope: "sides", by: "completed" } });
        // The words are the machine's, and say Reopen.
        expect(res.error, name).toBe(lockRefusalWords(res.lock as never, what, "organizer"));
        expect(res.error, name).toBe(`Locked because the tournament is completed. Reopen it on the dashboard to ${what}.`);
      }
      expect(await snapshot()).toEqual(before);
    } finally {
      await setStatus("live");
    }
  });

  it("an assistant is told to ask the Organizer to reopen it", async () => {
    await setStatus("completed");
    session.role = "assistant";
    try {
      const res = await nominatePair(week, clubs[1], [p.B1, p.B2]);
      expect(res).toMatchObject({ ok: false, lock: { by: "completed" } });
      if (res.ok) throw new Error("unreachable");
      expect(res.error).toBe(lockRefusalWords(res.lock!, "nominate a pair", "staff"));
      expect(res.error).toMatch(/^Locked because the tournament is completed\. Ask the Organizer to reopen it on the dashboard to nominate a pair\.$/);
    } finally {
      session.role = "admin";
      await setStatus("live");
    }
  });

  it("after Reopen (back to live) the same presses are allowed", async () => {
    await setStatus("completed");
    expect(await nominatePair(week, clubs[1], [p.B1, p.B2])).toMatchObject({ ok: false, lock: { by: "completed" } });
    await setStatus("live");
    expect(await nominatePair(week, clubs[1], [p.B1, p.B2])).toEqual({ ok: true });
    expect(await setLeagueSettings({ ...SETTINGS, matchBonus: 4 })).toEqual({ ok: true });
    const pair = await prisma.team.findFirstOrThrow({ where: { eventId: session.eventId, clubGroupId: clubs[1] }, select: { id: true } });
    expect(await withdrawPair(pair.id)).toEqual({ ok: true });
  });
});

describe("a league's sides have one door: the generic side writes refuse a league", () => {
  const states = [["live (launched)", "live"], ["while setting up", "draft"]] as const;

  for (const [label, status] of states) {
    it(`${label}: createTeam, deleteTeam, addTeamMember and removeTeamMember answer the one sentence, and the pair is unchanged`, async () => {
      await setStatus(status);
      try {
        const pair = await prisma.team.findFirstOrThrow({ where: { eventId: session.eventId, stageId: week, clubGroupId: clubs[0] }, select: { id: true } });
        const before = await snapshot();
        const refusal = { ok: false, error: LEAGUE_SIDES_REFUSAL };
        expect(await createTeam("zz-extra", week)).toEqual(refusal);
        expect(await deleteTeam(pair.id)).toEqual(refusal);
        expect(await removeTeamMember(pair.id, p.A3, true)).toEqual(refusal);
        // ANOTHER CLUB'S PLAYER into a club's pair: the door that skipped the roster rule.
        expect(await addTeamMember(pair.id, p.B1)).toEqual(refusal);
        expect(await snapshot()).toEqual(before);
      } finally {
        await setStatus("live");
      }
    });
  }

  it("CONTROL: the same generic presses on a tournament that is not a league, while setting up, succeed", async () => {
    const real = session.eventId;
    session.eventId = plainEvent;
    try {
      expect(await createTeam("zz-plain side", plainStage)).toMatchObject({ ok: true });
      const side = await prisma.team.findFirstOrThrow({ where: { eventId: plainEvent }, select: { id: true } });
      expect(await addTeamMember(side.id, plain[0])).toMatchObject({ ok: true });
      expect(await prisma.teamMember.count({ where: { teamId: side.id } })).toBe(1);
      expect(await removeTeamMember(side.id, plain[0], true)).toMatchObject({ ok: true });
      expect(await deleteTeam(side.id)).toMatchObject({ ok: true });
      expect(await prisma.team.count({ where: { eventId: plainEvent } })).toBe(0);
    } finally {
      session.eventId = real;
    }
  });
});

describe("a bad payload is refused in words, never thrown, and nothing is written", () => {
  it("non-array players, non-string ids, a bad pair id, and an over-long reason", async () => {
    const before = await snapshot();
    const bad = (v: unknown) => v as never;
    for (const res of [
      await nominatePair(week, clubs[1], bad("not-an-array")),
      await nominatePair(week, clubs[1], bad([1, 2])),
      await nominatePair(week, clubs[1], bad([p.B1, p.B2, p.A1])),
      await nominatePair(bad({ x: 1 }), clubs[1], [p.B1, p.B2]),
      await withdrawPair(bad(123)),
      await setPlayoffHoleWinner(week, clubs[0], clubs[1], clubs[0], bad({ reason: 42 })),
      await setPlayoffHoleWinner(week, clubs[0], clubs[1], clubs[0], { reason: "x".repeat(201) }),
    ]) {
      expect(res).toMatchObject({ ok: false });
      expect(res.ok === false && res.error.length).toBeGreaterThan(0);
    }
    expect(await snapshot()).toEqual(before);
  });

  it("the longest reason that is allowed gets past the boundary (the control)", async () => {
    const res = await setPlayoffHoleWinner(week, clubs[0], clubs[1], clubs[0], { reason: "x".repeat(200) });
    // Past the payload, the meeting did not take place, which is its own sentence.
    expect(res).toEqual({ ok: false, error: "Those clubs did not meet in this round." });
  });
});
