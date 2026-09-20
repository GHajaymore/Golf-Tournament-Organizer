import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { weekViewFor } from "@/lib/services/week-view";

/**
 * A TEAM LEAGUE NIGHT IS NOT AN EMPTY ONE EITHER.
 *
 * `week-view-match.audit.test.ts` is this file's older half: the week sheet
 * decided whether a night had been played by looking for CARDS, and a match
 * week keeps its result on the matches. Fixed, and the fix knew about two
 * kinds of night. There are THREE.
 *
 * A side files `TeamScorecard` — one row per side for a shared ball, one row
 * per player for a four-ball — and the individual `Scorecard` table stays
 * empty for the whole round. So a foursomes week found no cards, found no
 * matches, and declared itself unplayed for ever.
 *
 * Measured on the seeded club on 2026-09-20. The leaderboard for that night
 * read "Foursomes · 8 sides · lowest net wins" with all eight sides round in
 * eighteen; the week sheet for the same night read "No scores are in for week
 * 2 yet. Once cards are entered, the night's results, the table and the skins
 * all appear here." Two screens, one question, two answers — and the one that
 * was wrong is the one a league reads every week.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-WEEK-TEAM";

const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];
const SI = [1, 11, 17, 5, 3, 13, 15, 7, 9, 2, 12, 18, 6, 4, 14, 16, 8, 10];

/**
 * The strokes the high pair gives back, measured rather than assumed.
 *
 * It is the difference between the two sides' playing handicaps, which the
 * app works out from the format's allowance — so the fixture asserts it (in
 * "the fixture really does tie" below) instead of trusting this number, and a
 * change to the allowance fails loudly here rather than quietly making the two
 * sides unequal and the tie test vacuous.
 */
const TIE_GAP = 10;

let eventId = "";
let foursomesId = "";
let fourBallId = "";
let tieWeekId = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

/** A side's round, one ball between them: `playerId` is blank by design. */
function sharedCard(eventId: string, stageId: string, teamId: string, strokes: number[]) {
  return prisma.teamScorecard.create({
    data: { eventId, stageId, teamId, playerId: "", strokes: JSON.stringify(strokes) },
  });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });

  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} league`,
      shape: "series",
      format: "stroke",
      status: "active",
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${Date.now()}`,
      // A card on the event, because a side's gross is scored against pars and
      // a fixture without them ranks everybody on nought — which passes a
      // shape assertion and proves nothing. `matrix.test.ts` has a section on
      // exactly that.
      customPars: JSON.stringify(PARS),
      customYards: JSON.stringify(new Array(18).fill(400)),
      customStrokeIndex: JSON.stringify(SI),
    },
  });
  eventId = event.id;

  const group = await prisma.group.create({ data: { eventId, name: `${TAG} group`, position: 0 } });
  const names = ["Ann", "Bob", "Cal", "Dee"];
  const players = [];
  for (let i = 0; i < names.length; i += 1) {
    players.push(
      await prisma.player.create({
        data: {
          eventId,
          groupId: group.id,
          name: `${TAG} ${names[i]}`,
          email: `${TAG}-${names[i]}@example.invalid`.toLowerCase(),
          seed: i + 1,
          status: "confirmed",
          handicap: 10 + i,
        },
      }),
    );
  }

  /**
   * WEEK 1 IS A FOURSOMES: one ball per side, so there is no individual score
   * anywhere in the round. The ABSENCE of any `Scorecard` row is the fixture,
   * exactly as the missing scorecard was in the match-play file.
   */
  const foursomes = await prisma.stage.create({
    data: {
      eventId,
      position: 0,
      description: "Week 1",
      type: "Stroke Play Round",
      format: "Foursomes",
      scoringBasis: "gross",
      holes: 18,
    },
  });
  foursomesId = foursomes.id;

  const pairs = [
    { name: `${TAG} Pair A`, members: [players[0], players[1]], strokes: PARS.map((p) => p) },
    { name: `${TAG} Pair B`, members: [players[2], players[3]], strokes: PARS.map((p) => p + 1) },
  ];
  for (let i = 0; i < pairs.length; i += 1) {
    const team = await prisma.team.create({
      data: { eventId, stageId: foursomesId, name: pairs[i].name, seed: i + 1 },
    });
    for (let m = 0; m < pairs[i].members.length; m += 1) {
      await prisma.teamMember.create({
        data: { teamId: team.id, playerId: pairs[i].members[m].id, position: m },
      });
    }
    await sharedCard(eventId, foursomesId, team.id, pairs[i].strokes);
  }

  /**
   * WEEK 2 IS A FOUR-BALL, which files a card PER PLAYER — and still files it
   * in the team table, so it was just as invisible. Worth its own week rather
   * than trusting that one team format stands for the other: the shared-ball
   * refusal on the money screens is deliberately narrow for exactly the
   * opposite reason, and a fix keyed on `ball === "single"` here would have
   * left this night still reading as unplayed.
   */
  const fourBall = await prisma.stage.create({
    data: {
      eventId,
      position: 1,
      description: "Week 2",
      type: "Stroke Play Round",
      format: "Four-Ball",
      scoringBasis: "gross",
      holes: 18,
    },
  });
  fourBallId = fourBall.id;

  const fourBallTeam = await prisma.team.create({
    data: { eventId, stageId: fourBallId, name: `${TAG} Pair C`, seed: 1 },
  });
  for (let m = 0; m < 2; m += 1) {
    await prisma.teamMember.create({
      data: { teamId: fourBallTeam.id, playerId: players[m].id, position: m },
    });
    await prisma.teamScorecard.create({
      data: {
        eventId,
        stageId: fourBallId,
        teamId: fourBallTeam.id,
        playerId: players[m].id,
        strokes: JSON.stringify(PARS.map((p) => p + m)),
      },
    });
  }

  /**
   * WEEK 3 IS A TIE ON THE RANKED FIGURE, decided differently by the two
   * conventions this app has live at once.
   *
   * Two sides level on net and apart on gross: `placesByValue`, which the team
   * leaderboard uses, calls that a tie for first; `levelOnBasis`, which the
   * PLAYER table on this same screen uses, breaks it on gross and prints 1st
   * and 2nd. The week sheet and the leaderboard rank the same sides on the
   * same night, so this pins them together.
   */
  const tieWeek = await prisma.stage.create({
    data: {
      eventId,
      position: 2,
      description: "Week 3",
      type: "Stroke Play Round",
      format: "Foursomes",
      scoringBasis: "net",
      holes: 18,
    },
  });
  tieWeekId = tieWeek.id;

  const low = [];
  const high = [];
  for (let i = 0; i < 2; i += 1) {
    low.push(
      await prisma.player.create({
        data: {
          eventId,
          groupId: group.id,
          name: `${TAG} Low ${i}`,
          email: `${TAG}-low${i}@example.invalid`.toLowerCase(),
          seed: 10 + i,
          status: "confirmed",
          handicap: 8,
        },
      }),
    );
    high.push(
      await prisma.player.create({
        data: {
          eventId,
          groupId: group.id,
          name: `${TAG} High ${i}`,
          email: `${TAG}-high${i}@example.invalid`.toLowerCase(),
          seed: 20 + i,
          status: "confirmed",
          handicap: 18,
        },
      }),
    );
  }

  for (const [name, members, strokes] of [
    [`${TAG} Low pair`, low, PARS],
    [`${TAG} High pair`, high, PARS.map((p, i) => (i < TIE_GAP ? p + 1 : p))],
  ] as const) {
    const t = await prisma.team.create({
      data: { eventId, stageId: tieWeekId, name, seed: name.includes("Low") ? 1 : 2 },
    });
    for (let m = 0; m < members.length; m += 1) {
      await prisma.teamMember.create({ data: { teamId: t.id, playerId: members[m].id, position: m } });
    }
    await sharedCard(eventId, tieWeekId, t.id, [...strokes]);
  }
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a foursomes league night", () => {
  it("is not reported as having no scores", async () => {
    const view = await weekViewFor(eventId, foursomesId);
    expect(view, "the week sheet did not build at all").toBeTruthy();
    expect(
      view!.empty,
      "a night with every side's card in was called empty, which blanks the whole screen",
    ).toBe(false);
  });

  it("marks the week as played in the strip", async () => {
    /**
     * The sheet's `empty` and the strip's dot are separate computations of one
     * question, and the match-play file records that reverting one of them
     * alone left the other's test green. Both are asserted here for that
     * reason and not for symmetry.
     */
    const view = await weekViewFor(eventId, foursomesId);
    const week = view!.weeks.find((w) => w.stageId === foursomesId);
    expect(week, "this week is missing from its own strip").toBeTruthy();
    expect(week!.played, "a foursomes with every card in wore the no-scores dot").toBe(true);
  });

  it("ranks the SIDES, which is the only thing a shared ball can be ranked by", async () => {
    const view = await weekViewFor(eventId, foursomesId);
    expect(view!.sides.length, "no sides on a played foursomes").toBe(2);

    // Pair A went round in level par and Pair B in one over on every hole, so
    // the order is not an accident of the sort being stable: 72 against 90.
    const [first, second] = view!.sides;
    expect(first.name).toContain("Pair A");
    expect(first.gross).toBe(72);
    expect(first.position).toBe(1);
    expect(second.name).toContain("Pair B");
    expect(second.gross).toBe(90);
    expect(second.position).toBe(2);

    // And both sides are round, which is what the "8 of 8 sides in" line reads.
    expect(view!.sides.every((s) => s.played === 18)).toBe(true);
  });

  it("carries member IDS, not just names", async () => {
    /**
     * The player's own Today screen finds their side with these. Matching on
     * the NAME would be the app putting somebody else's result on the phone of
     * the other member of a club who happens to share it — which is why every
     * score guard here links a person by id or by registration email.
     */
    const view = await weekViewFor(eventId, foursomesId);
    const ids = view!.sides[0].memberIds;
    expect(ids.length).toBe(2);
    expect(ids.every((id) => id.length > 0)).toBe(true);
    const players = await prisma.player.findMany({ where: { id: { in: ids } } });
    expect(players.length, "a side's memberIds do not resolve to players").toBe(2);
  });

  it("names who is in each side", async () => {
    // "Pair A" is not a name anybody recognises at the bar; the members are
    // how a league reads its own sheet.
    const view = await weekViewFor(eventId, foursomesId);
    expect(view!.sides[0].members.length).toBe(2);
    expect(view!.sides[0].members.join(" & ")).toContain("Ann");
  });

  it("offers no gross-and-net PLAYER table, because nobody has an individual score", async () => {
    /**
     * `empty`, `hasScoreTable` and `sides` are three different questions. A
     * played foursomes is NOT empty, has NO player table, and HAS sides —
     * and inventing an individual score to fill the player table is the
     * same mistake `round-cards.ts` refuses money for, one screen along.
     */
    const view = await weekViewFor(eventId, foursomesId);
    expect(view!.hasScoreTable).toBe(false);
    expect(view!.results).toEqual([]);
  });

  it("does not claim the season table has counted the night", async () => {
    /**
     * `standingsWithMovement` sums individual cards, which this night does not
     * file, so it contributes nothing whatever the league is scored on. The
     * heading is the claim: "Standings after this week" over a movement column
     * of dashes is how a week reads as one the app has lost.
     */
    const view = await weekViewFor(eventId, foursomesId);
    expect(view!.standingsIncludeThisWeek).toBe(false);
  });
});

describe("two sides level on the night", () => {
  it("the fixture really does tie, on net and not on gross", async () => {
    /**
     * The control. A tie test whose fixture does not tie passes on any
     * convention and proves nothing — which is the failure `matrix.test.ts`
     * found in four of its own blocks. Asserted before the tie is.
     */
    const view = await weekViewFor(eventId, tieWeekId);
    const [a, b] = view!.sides;
    expect(a.net, `the sides are not level on net (${a.net} v ${b.net}) — TIE_GAP is wrong`).toBe(
      b.net,
    );
    expect(a.gross, "the sides are level on gross too, so the tie proves nothing").not.toBe(
      b.gross,
    );
  });

  it("shares the place, the way the team leaderboard does", async () => {
    /**
     * Two conventions are live in this app at once: `placesByValue` ties on
     * the ranked figure, and `levelOnBasis` — used by the PLAYER table on this
     * very screen — breaks a net tie on gross. Sides are ranked on the
     * leaderboard as well as here, and a club reads both, so the side table
     * follows the leaderboard.
     *
     * Found by eye on the seeded club: three sides on net 60, a three-way tie
     * for first on the leaderboard and 1st, 2nd, 3rd on the week sheet.
     */
    const view = await weekViewFor(eventId, tieWeekId);
    expect(view!.sides.map((s) => s.position)).toEqual([1, 1]);
  });
});

describe("a four-ball league night", () => {
  it("is not reported as having no scores either", async () => {
    // A card per player, still in the team table, still invisible to a reader
    // of the individual one.
    const view = await weekViewFor(eventId, fourBallId);
    expect(view!.empty, "a four-ball with both cards in was called empty").toBe(false);
    expect(view!.weeks.find((w) => w.stageId === fourBallId)!.played).toBe(true);
  });

  it("ranks it by side, not by the half of it one player scored", async () => {
    const view = await weekViewFor(eventId, fourBallId);
    expect(view!.sides.length).toBe(1);
    // Better ball of level par and one over is level par, which is the side's
    // score and neither player's alone.
    expect(view!.sides[0].gross).toBe(72);
    expect(view!.sides[0].played).toBe(18);
    expect(view!.sides[0].position).toBe(1);
  });
});
