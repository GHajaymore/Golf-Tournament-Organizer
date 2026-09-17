import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

/**
 * DRAWING A LEAGUE WEEK, AGAINST REAL ROWS.
 *
 * Four clubs, two weeks. Club 3 puts up one pair where the others put up two,
 * so the week has an opponent missing — the case a first-against-first draw
 * has to handle without doubling anybody up.
 *
 * What this proves that `league-draw.test.ts` cannot: the week number comes
 * from the round's place in the tournament, the matches land on a carrier and
 * not on a club, a scored week is not thrown away, the generic draw refuses a
 * league, and the league screen's own reader finds the meetings the draw made.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "zz-league-draw";

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
const { generateTeamMatches, autoDrawTeams } = await import("@/app/actions/teams");
const { leagueMeetings } = await import("@/lib/services/league");

const club: string[] = [];
const week: string[] = [];
/** pair ids per week, per club, in nomination order */
const pairs: string[][][] = [];

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

const matchesIn = (stageId: string) =>
  prisma.match.findMany({
    where: { eventId: session.eventId, stageId },
    select: { teamAId: true, teamBId: true, groupId: true, holes: true, round: true },
    orderBy: { round: "asc" },
  });

/** Which club a pair plays for, by the fixture's own bookkeeping. */
const clubOf = (w: number, pairId: string) => pairs[w].findIndex((ps) => ps.includes(pairId));

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({
    data: { name: `${TAG} club`, kind: "club" },
    select: { id: true },
  });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} league`,
      status: "live",
      shape: "series",
      format: "stroke",
      formationRule: "balanced",
      leaguePoints: "match",
      dates: "", course: "", city: "", address: "", regDeadline: "", capacity: 0,
      shareToken: randomBytes(12).toString("hex"),
      registrationToken: randomBytes(8).toString("hex"),
    },
    select: { id: true },
  });
  session.eventId = event.id;

  for (let c = 0; c < 4; c += 1) {
    const g = await prisma.group.create({
      data: { eventId: event.id, name: `${TAG} club ${c}`, position: c },
      select: { id: true },
    });
    club.push(g.id);
  }

  // A stroke round first, so "week" cannot be read off the stage position.
  await prisma.stage.create({
    data: { eventId: event.id, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18 },
  });
  for (let w = 0; w < 2; w += 1) {
    const s = await prisma.stage.create({
      data: { eventId: event.id, position: w + 1, type: "Round Robin", format: "Four-Ball", holes: 18 },
      select: { id: true },
    });
    week.push(s.id);
    pairs.push([]);
    for (let c = 0; c < 4; c += 1) {
      const ids: string[] = [];
      const count = c === 3 ? 1 : 2;
      for (let p = 0; p < count; p += 1) {
        const t = await prisma.team.create({
          data: {
            eventId: event.id,
            stageId: s.id,
            clubGroupId: club[c],
            name: `${TAG} w${w} c${c} p${p}`,
            seed: p + 1,
          },
          select: { id: true },
        });
        ids.push(t.id);
      }
      pairs[w].push(ids);
    }
  }
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("drawing a league week", () => {
  it("draws the first week of the rotation, first pair against first pair", async () => {
    const res = await drawLeagueWeek(week[0]);
    // Circle method on [c0, c1, c2, c3], week one: c0 v c3 and c1 v c2.
    // c3 has one pair, so c0's second pair has nobody.
    expect(res).toEqual({ ok: true, matches: 3, byeClub: null, playoff: null, unmatched: 1 });

    const ms = await matchesIn(week[0]);
    const drawn = ms.map((m) => [m.teamAId, m.teamBId]);
    // A match has no creation order to read back, so compared as a set —
    // which still pins who plays whom exactly.
    const asSet = (xs: (string | null)[][]) => xs.map((x) => x.join(">")).sort();
    expect(asSet(drawn)).toEqual(
      asSet([
        [pairs[0][0][0], pairs[0][3][0]],
        [pairs[0][1][0], pairs[0][2][0]],
        [pairs[0][1][1], pairs[0][2][1]],
      ]),
    );
    // Never a club against itself.
    for (const [a, b] of drawn) expect(clubOf(0, a!)).not.toBe(clubOf(0, b!));
  });

  it("files the matches on the round's carrier, not on a club, with a card the round's length", async () => {
    const ms = await matchesIn(week[0]);
    const groups = new Set(ms.map((m) => m.groupId));
    expect(groups.size).toBe(1);
    const carrier = await prisma.group.findUniqueOrThrow({
      where: { id: [...groups][0] },
      select: { isCarrier: true, stageId: true },
    });
    expect(carrier).toEqual({ isCarrier: true, stageId: week[0] });
    expect(club).not.toContain([...groups][0]);
    for (const m of ms) expect(JSON.parse(m.holes)).toHaveLength(18);
  });

  it("draws the second team round as week two, not week one again", async () => {
    const res = await drawLeagueWeek(week[1]);
    // Week two: c0 v c2 and c3 v c1 — c3's one pair leaves c1's second out.
    expect(res).toEqual({ ok: true, matches: 3, byeClub: null, playoff: null, unmatched: 1 });
    const drawn = (await matchesIn(week[1]))
      .map((m) => `${clubOf(1, m.teamAId!)}v${clubOf(1, m.teamBId!)}`)
      .sort();
    expect(drawn).toEqual(["0v2", "0v2", "3v1"]);
  });

  it("the league screen finds the meetings the draw made", async () => {
    const meetings = await leagueMeetings(session.eventId, week[0], "match");
    const pairsOfMeetings = meetings
      .map((m) => [m.clubAId, m.clubBId].sort().join(":"))
      .sort();
    expect(pairsOfMeetings).toEqual(
      [[club[0], club[3]].sort().join(":"), [club[1], club[2]].sort().join(":")].sort(),
    );
    expect(meetings.map((m) => m.pairings.length).sort()).toEqual([1, 2]);
  });

  it("asks before replacing a drawn week, and replaces it when told to", async () => {
    const again = await drawLeagueWeek(week[0]);
    expect(again).toMatchObject({ ok: false, needsConfirm: true, existing: 3 });
    expect(await drawLeagueWeek(week[0], true)).toMatchObject({ ok: true, matches: 3 });
    expect(await matchesIn(week[0])).toHaveLength(3);
  });

  it("refuses to throw away a week somebody has scored", async () => {
    const card = await prisma.teamScorecard.create({
      data: {
        eventId: session.eventId,
        stageId: week[0],
        teamId: pairs[0][1][0],
        strokes: JSON.stringify([4, ...new Array(17).fill(null)]),
      },
    });
    try {
      const res = await drawLeagueWeek(week[0], true);
      expect(res).toEqual({ ok: false, error: "Scores have already been recorded for this round." });
      expect(await matchesIn(week[0])).toHaveLength(3);
    } finally {
      await prisma.teamScorecard.delete({ where: { id: card.id } });
    }
  });

  it("lets an assistant draw, and refuses a player", async () => {
    session.role = "assistant";
    try {
      expect(await drawLeagueWeek(week[1], true)).toMatchObject({ ok: true });
      session.role = "player";
      await expect(drawLeagueWeek(week[1], true)).rejects.toThrow("Organizer access required");
    } finally {
      session.role = "admin";
    }
  });

  it("refuses a round that is not in this tournament", async () => {
    // Its own second tournament: CI's database holds nothing else to borrow.
    const org = await prisma.organization.findFirstOrThrow({
      where: { name: { startsWith: TAG } },
      select: { id: true },
    });
    const foreign = await prisma.event.create({
      data: {
        organizationId: org.id,
        name: `${TAG} another club's league`,
        status: "live",
        shape: "series",
        format: "stroke",
        formationRule: "balanced",
        leaguePoints: "match",
        dates: "", course: "", city: "", address: "", regDeadline: "", capacity: 0,
        shareToken: randomBytes(12).toString("hex"),
        registrationToken: randomBytes(8).toString("hex"),
      },
      select: { id: true },
    });
    const other = await prisma.stage.create({
      data: { eventId: foreign.id, position: 0, type: "Round Robin", format: "Four-Ball", holes: 18 },
      select: { id: true },
    });
    expect(await drawLeagueWeek(other.id)).toEqual({ ok: false, error: "Round not found." });
  });

  it("the generic draw and auto-draw refuse a league, and leave the week alone", async () => {
    const msg =
      "This tournament is run as a league. Nominate pairs and draw the week in the League section.";
    expect(await generateTeamMatches(week[0], true)).toEqual({ ok: false, error: msg });
    expect(await autoDrawTeams(week[0], true)).toEqual({ ok: false, error: msg });
    expect(await matchesIn(week[0])).toHaveLength(3);
    expect(await prisma.team.count({ where: { stageId: week[0] } })).toBe(7);
  });
});
