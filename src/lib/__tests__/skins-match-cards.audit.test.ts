import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * Skins settles on a match-play round, and settles nothing differently anywhere
 * else.
 *
 * A stroke round writes `Scorecard`, one row per player. A match round writes
 * `MatchScorecard`, one row per SIDE of the fixture, keyed by slot "A" or "B".
 * `skinsPotFor` read the first and only the first — so a pot on a match round
 * found no cards at all and reported "0 skins · provisional" for ever.
 *
 * Measured in the browser on 2026-09-08: a £5 pot on a match that went Final
 * at 5&4, then a second scored as full gross cards, both reading zero. Ten
 * pounds in a game that could not be decided. Nothing was ever paid wrongly —
 * the pot refuses to settle rather than guessing — but it could not be paid at
 * all, and nothing said why.
 *
 * THE SECOND HALF OF THIS FILE IS THE IMPORTANT ONE. This is money code, and
 * the property that makes the change safe to make is that it can only ever
 * FILL A GAP: a pot that settles today reads exactly the same cards tomorrow.
 * That is asserted directly, by settling the same stroke pot with match cards
 * sitting beside it.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-SKINS-MATCH";

const { skinsPotFor } = await import("@/lib/services/skins-pot");

const PAR = [4, 5, 3, 4, 5, 4, 3, 4, 4, 4, 5, 4, 4, 5, 3, 4, 3, 4];
const SI = [11, 13, 17, 15, 3, 5, 9, 7, 1, 18, 14, 6, 16, 4, 10, 8, 12, 2];

let organizationId = "";
let courseId = "";

async function scrub() {
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.course.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await scrub();
  const org = await prisma.organization.create({ data: { name: `${TAG} club` }, select: { id: true } });
  organizationId = org.id;
  const course = await prisma.course.create({
    data: {
      organizationId,
      name: `${TAG} course`,
      city: "",
      pars: JSON.stringify(PAR),
      strokeIndex: JSON.stringify(SI),
      yards: JSON.stringify(new Array(18).fill(0)),
    },
    select: { id: true },
  });
  courseId = course.id;
});

afterAll(async () => {
  await scrub();
  await prisma.$disconnect();
});

/** An event with one round on the fixture course, and two players in it. */
async function makeRound(name: string, format: string, type: string) {
  const event = await prisma.event.create({
    data: {
      organizationId,
      name: `${TAG} ${name}`,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      capacity: 0,
      shareToken: `zz-skins-${Math.random().toString(36).slice(2)}`,
      status: "live",
      shape: "match",
      courseId,
    },
    select: { id: true },
  });
  await prisma.eventCourse.create({ data: { eventId: event.id, courseId } });
  const stage = await prisma.stage.create({
    data: {
      eventId: event.id,
      position: 0,
      type,
      description: "",
      format,
      holes: 18,
      nine: "full",
      scoringBasis: "gross",
      courseId,
    },
    select: { id: true },
  });
  const group = await prisma.group.create({
    data: { eventId: event.id, name: "A", position: 0 },
    select: { id: true },
  });
  const players = [];
  for (const [i, who] of [`${TAG} Ines`, `${TAG} Otto`].entries()) {
    players.push(
      await prisma.player.create({
        data: {
          eventId: event.id,
          groupId: group.id,
          name: who,
          handicap: 0,
          seed: i + 1,
          status: "confirmed",
        },
        select: { id: true, name: true },
      }),
    );
  }
  return { eventId: event.id, stageId: stage.id, groupId: group.id, players };
}

/** A pot on that round, with both players staked. */
async function makePot(eventId: string, stageId: string, playerIds: string[]) {
  const pot = await prisma.skinsPot.create({
    data: { eventId, stageId, buyInCents: 500, net: false, scope: "full", groupKey: "" },
    select: { id: true },
  });
  await prisma.skinsEntry.createMany({
    data: playerIds.map((playerId) => ({ potId: pot.id, playerId })),
  });
  return pot.id;
}

/**
 * Two outright wins for the first player and sixteen ties.
 *
 * Built so a wrong answer looks different from a right one: the count of
 * claimed skins, the count of unclaimed, the winner and the amount are all
 * distinct numbers, and a reader that found no cards reports zero for every
 * one of them.
 */
const CARD_A = PAR.map((p, i) => (i < 2 ? p - 1 : p));
const CARD_B = PAR.slice();

describe("a skins pot on a match-play round", () => {
  it("settles from the cards the match kept", async () => {
    const round = await makeRound("match round", "Match Play", "Round Robin");
    await makePot(round.eventId, round.stageId, round.players.map((p) => p.id));

    const match = await prisma.match.create({
      data: {
        eventId: round.eventId,
        stageId: round.stageId,
        groupId: round.groupId,
        round: 1,
        playerAId: round.players[0].id,
        playerBId: round.players[1].id,
        holes: JSON.stringify(new Array(18).fill(null)),
      },
      select: { id: true },
    });
    // The shape a match round actually stores: one row per SLOT, not per
    // player. This is the table the pot could not see.
    await prisma.matchScorecard.createMany({
      data: [
        { eventId: round.eventId, matchId: match.id, slot: "A", strokes: JSON.stringify(CARD_A) },
        { eventId: round.eventId, matchId: match.id, slot: "B", strokes: JSON.stringify(CARD_B) },
      ],
    });

    const view = await skinsPotFor(round.eventId, round.stageId, false, "full", "");
    expect(view, "the pot should exist").not.toBeNull();

    // VALUES, not shape. Two holes were won outright and sixteen were tied.
    expect(view!.result, "the pot should have a result").not.toBeNull();
    expect(view!.result!.claimedSkins, "claimed skins").toBe(2);
    expect(view!.result!.unclaimedSkins, "tied holes").toBe(16);
    expect(view!.result!.provisional, "every hole has a score").toBe(false);

    const shareOf = (name: string) =>
      view!.result!.shares.find((s) => view!.nameById[s.playerId]?.endsWith(name));
    expect(shareOf("Ines")?.skins).toBe(2);
    expect(shareOf("Otto")?.skins).toBe(0);
    // The whole pot goes to the only player who won a skin, and the two
    // figures are equal and opposite — a settle-up that does not sum to zero
    // is money invented or lost.
    expect(view!.result!.shares.reduce((t, s) => t + s.netCents, 0)).toBe(0);
    expect(shareOf("Ines")?.netCents).toBe(500);
    expect(shareOf("Otto")?.netCents).toBe(-500);
  });
});

describe("and changes nothing for a round that already settled", () => {
  it("reads the player's own card when there is one, whatever a match row says", async () => {
    /**
     * THE SAFETY PROPERTY, asserted directly rather than reasoned about.
     *
     * The new source fills a gap and must never overwrite. So this puts a
     * `Scorecard` and a CONTRADICTORY `MatchScorecard` on the same player and
     * asserts the pot settles off the Scorecard — which is what every round
     * that settles today has.
     */
    const round = await makeRound("stroke round", "Stroke Play", "Stroke Play Round");
    await makePot(round.eventId, round.stageId, round.players.map((p) => p.id));

    await prisma.scorecard.createMany({
      data: [
        {
          eventId: round.eventId,
          stageId: round.stageId,
          playerId: round.players[0].id,
          strokes: JSON.stringify(CARD_A),
        },
        {
          eventId: round.eventId,
          stageId: round.stageId,
          playerId: round.players[1].id,
          strokes: JSON.stringify(CARD_B),
        },
      ],
    });

    const before = await skinsPotFor(round.eventId, round.stageId, false, "full", "");

    // Now a match row that would give the OPPOSITE answer if it were read:
    // player B winning the first two holes instead of player A.
    const match = await prisma.match.create({
      data: {
        eventId: round.eventId,
        stageId: round.stageId,
        groupId: round.groupId,
        round: 1,
        playerAId: round.players[0].id,
        playerBId: round.players[1].id,
        holes: JSON.stringify(new Array(18).fill(null)),
      },
      select: { id: true },
    });
    await prisma.matchScorecard.createMany({
      data: [
        { eventId: round.eventId, matchId: match.id, slot: "A", strokes: JSON.stringify(CARD_B) },
        { eventId: round.eventId, matchId: match.id, slot: "B", strokes: JSON.stringify(CARD_A) },
      ],
    });

    const after = await skinsPotFor(round.eventId, round.stageId, false, "full", "");

    // Identical, share for share and penny for penny.
    const shape = (v: NonNullable<typeof before>) =>
      v.result!.shares.map((s) => [v.nameById[s.playerId], s.skins, s.netCents]);
    expect(shape(after!)).toEqual(shape(before!));
    // And still the right answer, so "identical" is not two copies of a
    // wrong one.
    expect(
      after!.result!.shares.find((s) => after!.nameById[s.playerId]?.endsWith("Ines"))?.skins,
    ).toBe(2);
  });

  it("credits nobody off a match fixture that names teams rather than players", async () => {
    /**
     * A team round names TEAMS on the fixture and leaves the player columns
     * empty — the schema is explicit about it — so slot "A" is a side of two
     * and not somebody's card. Attributing it to a player would credit one
     * partner with the pair's strokes.
     *
     * This is about the MATCH fixture only, and the claim that once sat here
     * — "team rounds are deliberately still unsettled" — was WRONG and has
     * been removed. A team round keeps its own per-player cards on
     * `TeamScorecard`, which carries a `playerId`; the four-ball case below is
     * the one that reads them. Only foursomes stays out, and for a reason
     * about golf rather than storage.
     *
     * WHAT THIS TEST DOES AND DOES NOT PIN, measured rather than claimed:
     * deleting the reader's `!playerId` check leaves this green, because an
     * empty id matches nobody in the strokes map either way. So this asserts
     * the OUTCOME — no player is credited off a side's card — and not the
     * line that looks like it causes it. The check is defensive; the empty
     * player column is what actually makes it safe.
     */
    const round = await makeRound("team round", "Four-Ball", "Round Robin");
    await makePot(round.eventId, round.stageId, round.players.map((p) => p.id));

    const match = await prisma.match.create({
      data: {
        eventId: round.eventId,
        stageId: round.stageId,
        groupId: round.groupId,
        round: 1,
        playerAId: "",
        playerBId: "",
        teamAId: "zz-team-a",
        teamBId: "zz-team-b",
        holes: JSON.stringify(new Array(18).fill(null)),
      },
      select: { id: true },
    });
    await prisma.matchScorecard.createMany({
      data: [
        { eventId: round.eventId, matchId: match.id, slot: "A", strokes: JSON.stringify(CARD_A) },
        { eventId: round.eventId, matchId: match.id, slot: "B", strokes: JSON.stringify(CARD_B) },
      ],
    });

    const view = await skinsPotFor(round.eventId, round.stageId, false, "full", "");
    // Nobody is credited with a skin off a side's card.
    expect(view!.result!.claimedSkins).toBe(0);
    expect(view!.result!.shares.every((s) => s.skins === 0)).toBe(true);
  });
});

/**
 * A four-ball settles per player; foursomes cannot, and the difference is golf
 * rather than storage.
 *
 * In a four-ball everyone plays their OWN ball, so `TeamScorecard` holds one
 * row per player with that player's id on it — read off a real round on
 * 2026-09-08: four rows, four ids, four cards. An individual skin is a thing
 * that happened and can be paid.
 *
 * In foursomes the partners play ONE ball. The side returns a single card with
 * no player against it, and "who won this hole outright" has no individual
 * answer at all. Leaving that pot unsettled is the correct outcome, not a gap.
 */
describe("a skins pot on a team round", () => {
  it("settles a four-ball off each player's own card", async () => {
    const round = await makeRound("four-ball", "Four-Ball", "Round Robin");
    // Two more players, because a four-ball is four.
    const extra = [];
    for (const [i, who] of [`${TAG} Ravi`, `${TAG} Suki`].entries()) {
      extra.push(
        await prisma.player.create({
          data: {
            eventId: round.eventId,
            groupId: round.groupId,
            name: who,
            handicap: 0,
            seed: i + 3,
            status: "confirmed",
          },
          select: { id: true, name: true },
        }),
      );
    }
    const all = [...round.players, ...extra];
    await makePot(round.eventId, round.stageId, all.map((p) => p.id));

    const teamA = await prisma.team.create({
      data: { eventId: round.eventId, stageId: round.stageId, name: "A", seed: 1 },
      select: { id: true },
    });
    const teamB = await prisma.team.create({
      data: { eventId: round.eventId, stageId: round.stageId, name: "B", seed: 2 },
      select: { id: true },
    });
    const match = await prisma.match.create({
      data: {
        eventId: round.eventId,
        stageId: round.stageId,
        groupId: round.groupId,
        round: 1,
        playerAId: "",
        playerBId: "",
        teamAId: teamA.id,
        teamBId: teamB.id,
        holes: JSON.stringify(new Array(18).fill(null)),
      },
      select: { id: true },
    });

    // One card per PLAYER, which is what a four-ball stores. Only the first
    // player wins anything outright; the other three par everything.
    await prisma.teamScorecard.createMany({
      data: all.map((p, i) => ({
        eventId: round.eventId,
        stageId: round.stageId,
        teamId: i < 2 ? teamA.id : teamB.id,
        matchId: match.id,
        playerId: p.id,
        strokes: JSON.stringify(i === 0 ? CARD_A : CARD_B),
      })),
    });

    const view = await skinsPotFor(round.eventId, round.stageId, false, "full", "");
    expect(view!.result!.claimedSkins, "two holes won outright").toBe(2);
    expect(view!.result!.unclaimedSkins, "sixteen tied").toBe(16);

    const shareOf = (name: string) =>
      view!.result!.shares.find((s) => view!.nameById[s.playerId]?.endsWith(name));
    expect(shareOf("Ines")?.skins).toBe(2);
    // The whole pot — four stakes of 500 — goes to the only player who won a
    // skin, so she is up three stakes and everybody else is down one.
    expect(shareOf("Ines")?.netCents).toBe(1500);
    for (const loser of ["Otto", "Ravi", "Suki"]) {
      expect(shareOf(loser)?.skins, loser).toBe(0);
      expect(shareOf(loser)?.netCents, loser).toBe(-500);
    }
    expect(view!.result!.shares.reduce((t, s) => t + s.netCents, 0)).toBe(0);
  });

  it("leaves foursomes unsettled, because one ball has no individual winner", async () => {
    /**
     * Partners play a single ball, so the side returns one card with no player
     * against it. There is no individual skin to pay, and inventing one would
     * credit a hole to whichever partner the row happened to name.
     *
     * What this test pins is the OUTCOME, and measurement says so: deleting
     * the reader's `!playerId` check leaves this green, exactly as it does on
     * the match source. An empty key matches no player either way, so what
     * keeps foursomes out is that its card carries nobody's id — not the line
     * that looks like it does.
     *
     * Worth stating because the opposite was written here first, and the
     * mutation contradicted it. A guard is defensive until a red test says
     * otherwise.
     */
    const round = await makeRound("foursomes", "Foursomes", "Round Robin");
    await makePot(round.eventId, round.stageId, round.players.map((p) => p.id));

    const team = await prisma.team.create({
      data: { eventId: round.eventId, stageId: round.stageId, name: "A", seed: 1 },
      select: { id: true },
    });
    // ONE card for the side, with no player on it — the shape a shared ball
    // produces.
    await prisma.teamScorecard.create({
      data: {
        eventId: round.eventId,
        stageId: round.stageId,
        teamId: team.id,
        matchId: "",
        playerId: "",
        strokes: JSON.stringify(CARD_A),
      },
    });

    const view = await skinsPotFor(round.eventId, round.stageId, false, "full", "");
    expect(view!.result!.claimedSkins).toBe(0);
    expect(view!.result!.shares.every((s) => s.skins === 0)).toBe(true);
    expect(view!.result!.shares.every((s) => s.netCents === 0)).toBe(true);
  });
});
