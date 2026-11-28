import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

/**
 * A REDRAW OVER ANY RECORDED RESULT IS REFUSED, WHICHEVER TABLE HOLDS IT (B115b, PR B).
 *
 * `drawLeagueWeek` and `generateTeamMatches` each kept a private copy of "has this round a score": a team card with a
 * stroke. A week kept by tapping holes writes `Match.holes` and no team card at all, and a stroke-card match writes a
 * `MatchScorecard`; the redraw deleted both in silence. Both now ask the one rule, `redrawRefusalFor` (the rule
 * `generateCutRound` asks): `enteredCardCount`, which unions the stroke, team and match cards that hold a stroke and the
 * matches that hold a tapped hole, in `redrawRefusal`'s words.
 *
 * Each action gets the same four presses: a tapped hole and NO card is refused (same ids, same holes); a match card with a
 * stroke is refused; and two CONTROLS, an untouched drawn round and one holding only all-null cards, redraw.
 *
 *   npx vitest run --config vitest.audit.config.ts src/lib/__tests__/a-redraw-is-refused-over-any-result.audit.test.ts
 */

const prisma = new PrismaClient();
const TAG = "zz-redraw-any-result";

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

const { drawLeagueWeek } = await import("@/app/actions/league");
const { generateTeamMatches } = await import("@/app/actions/teams");

const EMPTY = JSON.stringify(new Array(18).fill(null));
const TAPPED = JSON.stringify(["A", ...new Array(17).fill(null)]);
const ONE_STROKE = JSON.stringify([4, ...new Array(17).fill(null)]);
const REFUSAL = /^Round [0-9]+ has scores — clear them on Score entry first[.]$/;

let leagueEvent = "";
let leagueWeek = "";
let plainEvent = "";
let plainRound = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

async function makeEvent(name: string, leaguePoints: string) {
  const org = await prisma.organization.create({ data: { name: `${TAG} ${name} club`, kind: "club" }, select: { id: true } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} ${name}`,
      status: leaguePoints ? "live" : "draft",
      launchedAt: leaguePoints ? new Date() : null,
      shape: leaguePoints ? "series" : "tournament",
      format: "stroke",
      formationRule: "balanced",
      leaguePoints,
      dates: "", course: "", city: "", address: "", regDeadline: "", capacity: 0,
      shareToken: randomBytes(12).toString("hex"),
      registrationToken: randomBytes(8).toString("hex"),
    },
    select: { id: true },
  });
  const stage = (
    await prisma.stage.create({ data: { eventId: event.id, position: 0, type: "Round Robin", format: "Four-Ball", holes: 18 }, select: { id: true } })
  ).id;
  return { eventId: event.id, stageId: stage };
}

beforeAll(async () => {
  await cleanup();
  // A league week: two clubs, two pairs each.
  const league = await makeEvent("league", "match");
  leagueEvent = league.eventId;
  leagueWeek = league.stageId;
  const clubs: string[] = [];
  for (let c = 0; c < 2; c += 1) {
    clubs.push((await prisma.group.create({ data: { eventId: leagueEvent, name: `${TAG} club ${c}`, position: c }, select: { id: true } })).id);
  }
  for (let c = 0; c < 2; c += 1) {
    for (let p = 0; p < 2; p += 1) {
      await prisma.team.create({
        data: { eventId: leagueEvent, stageId: leagueWeek, clubGroupId: clubs[c], name: `${TAG} c${c} p${p}`, seed: p + 1 },
      });
    }
  }
  // A plain team round robin: four event-wide sides, no league.
  const plain = await makeEvent("plain", "");
  plainEvent = plain.eventId;
  plainRound = plain.stageId;
  for (let i = 1; i <= 4; i += 1) {
    await prisma.team.create({ data: { eventId: plainEvent, name: `${TAG} side ${i}`, seed: i } });
  }
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const cases = [
  {
    door: "drawLeagueWeek",
    eventId: () => leagueEvent,
    stageId: () => leagueWeek,
    draw: (replace: boolean) => drawLeagueWeek(leagueWeek, replace),
  },
  {
    door: "generateTeamMatches",
    eventId: () => plainEvent,
    stageId: () => plainRound,
    draw: (replace: boolean) => generateTeamMatches(plainRound, replace),
  },
];

for (const c of cases) {
  describe(`${c.door}: a redraw over a recorded result`, () => {
    const matches = () =>
      prisma.match.findMany({ where: { eventId: c.eventId(), stageId: c.stageId() }, select: { id: true, holes: true }, orderBy: { id: "asc" } });

    it("CONTROL: the first draw, then an untouched drawn round, redraws on a yes", async () => {
      session.eventId = c.eventId();
      expect(await c.draw(false)).toMatchObject({ ok: true });
      const first = await matches();
      expect(first.length).toBeGreaterThan(0);
      expect(await c.draw(true)).toMatchObject({ ok: true });
      const second = await matches();
      expect(second.length).toBe(first.length);
      // A real redraw: the old rows are gone.
      expect(second.map((m) => m.id)).not.toEqual(first.map((m) => m.id));
    });

    it("CONTROL: a round holding only all-null cards (placeholders, no result) redraws", async () => {
      session.eventId = c.eventId();
      const [first] = await matches();
      const team = await prisma.team.findFirstOrThrow({ where: { eventId: c.eventId() }, select: { id: true } });
      await prisma.teamScorecard.create({ data: { eventId: c.eventId(), stageId: c.stageId(), teamId: team.id, strokes: EMPTY } });
      await prisma.matchScorecard.create({ data: { eventId: c.eventId(), matchId: first.id, slot: "A", strokes: EMPTY } });
      try {
        expect(await c.draw(true)).toMatchObject({ ok: true });
      } finally {
        await prisma.teamScorecard.deleteMany({ where: { eventId: c.eventId() } });
      }
    });

    it("a tapped hole and NO card is refused in the one rule's words, and the matches and holes stand", async () => {
      session.eventId = c.eventId();
      const [first] = await matches();
      await prisma.match.update({ where: { id: first.id }, data: { holes: TAPPED } });
      expect(await prisma.teamScorecard.count({ where: { eventId: c.eventId() } })).toBe(0);
      const before = await matches();
      const res = await c.draw(true);
      expect(res).toEqual({ ok: false, error: expect.stringMatching(REFUSAL) });
      expect(await matches()).toEqual(before);
      expect(before.find((m) => m.id === first.id)?.holes).toBe(TAPPED);
      await prisma.match.update({ where: { id: first.id }, data: { holes: EMPTY } });
    });

    it("a match card holding a stroke and NO team card is refused, and the matches stand", async () => {
      session.eventId = c.eventId();
      const [first] = await matches();
      const card = await prisma.matchScorecard.upsert({
        where: { matchId_slot: { matchId: first.id, slot: "A" } },
        create: { eventId: c.eventId(), matchId: first.id, slot: "A", strokes: ONE_STROKE },
        update: { strokes: ONE_STROKE },
      });
      try {
        const before = await matches();
        expect(await c.draw(true)).toEqual({ ok: false, error: expect.stringMatching(REFUSAL) });
        expect(await matches()).toEqual(before);
      } finally {
        await prisma.matchScorecard.delete({ where: { id: card.id } });
      }
    });
  });
}
