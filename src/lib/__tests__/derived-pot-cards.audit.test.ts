import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { moneyFor } from "../services/expenses";

/**
 * A birdie pot settles on the cards the round actually kept, whatever table
 * that is.
 *
 * The third instance of one defect, and the reason `roundStrokes` now exists.
 * A round's scores live in THREE tables — `Scorecard` for a stroke round,
 * `MatchScorecard` for a match played on full gross cards, `TeamScorecard` for
 * a team round — and every money reader that asked `prisma.scorecard` alone was
 * silently asking what the STROKE players did.
 *
 * Skins was fixed for match play on 2026-09-08 and for four-balls the same day.
 * The DERIVED pots — birdies, eagles, low gross, low net — were not, and the
 * comment sitting on their gate argued they did not need to be: "a match round
 * returns no Scorecard rows at all … so a derived pot on a match round has
 * nothing to pay either way."
 *
 * That was a true statement about storage doing duty as a claim about money,
 * and it expired. A casual round's birdie pot FORCES gross cards — `needsCards`
 * exists precisely so the birdies can be counted — so from the day match play
 * could hold a card, every such pot was staked and never settled. Two players
 * at £10 is £20 collected on a game that could not be decided.
 *
 * THE FOURTH TEST IS THE IMPORTANT ONE. This is money code, and what makes the
 * change safe is that the new sources only ever FILL A GAP: a player who has a
 * card of their own keeps it, so a pot that settles today reads exactly the
 * same cards tomorrow. That is asserted directly rather than reasoned about.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-DERIVEDCARDS";

const at = (who: string) => `${TAG}.${who}@example.invalid`.toLowerCase();

/** Every hole a par 4, so a 3 is a birdie and a 4 is not. */
const PARS = new Array(18).fill(4);
const SI = Array.from({ length: 18 }, (_, i) => i + 1);
/** One birdie, on the 1st. Nothing else on either card can produce one. */
const BIRDIE_CARD = JSON.stringify([3, ...new Array(17).fill(4)]);
const PAR_CARD = JSON.stringify(new Array(18).fill(4));

let organizationId = "";
let courseId = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.course.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({
    data: { name: `${TAG} club`, kind: "club" },
    select: { id: true },
  });
  organizationId = org.id;
  const course = await prisma.course.create({
    data: {
      organizationId,
      name: `${TAG} course`,
      city: "",
      pars: JSON.stringify(PARS),
      yards: JSON.stringify(new Array(18).fill(400)),
      strokeIndex: JSON.stringify(SI),
    },
    select: { id: true },
  });
  courseId = course.id;
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

/**
 * A round of `format`, two players, and a £10-a-head birdie pot on it.
 *
 * The caller then stores the cards wherever that format keeps them, which is
 * the only thing that differs between the tests below.
 */
async function roundWithBirdiePot(name: string, type: string, format: string) {
  const event = await prisma.event.create({
    data: {
      organizationId,
      name: `${TAG} ${name}`,
      dates: "",
      course: `${TAG} course`,
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${name}-${process.pid}`.slice(0, 60),
      customPars: JSON.stringify(PARS),
      customYards: JSON.stringify(new Array(18).fill(400)),
      customStrokeIndex: JSON.stringify(SI),
      moneyMode: "split",
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
      format,
      holes: 18,
      nine: "full",
      scoringBasis: "gross",
      courseId,
    },
    select: { id: true },
  });

  const ids: Record<string, string> = {};
  for (const [i, who] of ["birdie", "steady"].entries()) {
    const p = await prisma.player.create({
      data: {
        eventId: event.id,
        name: `${TAG} ${who}`,
        email: at(`${name}.${who}`),
        seed: i + 1,
        status: "confirmed",
        handicap: 0,
      },
      select: { id: true },
    });
    ids[who] = p.id;
  }

  const pot = await prisma.sideGame.create({
    data: {
      eventId: event.id,
      stageId: stage.id,
      kind: "birdies",
      buyInCents: 1000,
      entryMode: "opt-in",
    },
    select: { id: true },
  });
  await prisma.sideGameEntry.createMany({
    data: [
      { sideGameId: pot.id, playerId: ids.birdie, confirmed: true },
      { sideGameId: pot.id, playerId: ids.steady, confirmed: true },
    ],
  });

  const group = await prisma.group.create({
    data: { eventId: event.id, name: "A", position: 0 },
    select: { id: true },
  });

  return { eventId: event.id, stageId: stage.id, groupId: group.id, ids };
}

/**
 * The whole £20 pot moved to the player who birdied, and nothing invented.
 *
 * Asserted by VALUE and in both directions. A reader that finds no cards pays
 * nobody and both figures are 0 — which also sums to zero, so the zero-sum
 * check alone cannot tell the fix from the defect.
 */
async function expectPotPaid(eventId: string, name: string) {
  const [won, lost] = await Promise.all([
    moneyFor(eventId, at(`${name}.birdie`)),
    moneyFor(eventId, at(`${name}.steady`)),
  ]);
  expect(won.gamesCents, "the one birdie takes the pot").toBe(1000);
  expect(lost.gamesCents, "and the other player pays for it").toBe(-1000);
}

describe("a birdie pot on a match-play round scored on gross cards", () => {
  it("settles from the cards the MATCH kept", async () => {
    const round = await roundWithBirdiePot("match", "Round Robin", "Match Play");
    const match = await prisma.match.create({
      data: {
        eventId: round.eventId,
        stageId: round.stageId,
        groupId: round.groupId,
        round: 1,
        playerAId: round.ids.birdie,
        playerBId: round.ids.steady,
        // Won on the 1st and halved from there — the result `saveMatchCard`
        // derives from these two cards, stored here directly.
        holes: JSON.stringify(["A", ...new Array(17).fill("H")]),
      },
      select: { id: true },
    });
    // One row per SLOT, not per player. This is the table the pot could not
    // see, and the reason the round looked unplayed to the gate above it.
    await prisma.matchScorecard.createMany({
      data: [
        { eventId: round.eventId, matchId: match.id, slot: "A", strokes: BIRDIE_CARD },
        { eventId: round.eventId, matchId: match.id, slot: "B", strokes: PAR_CARD },
      ],
    });

    await expectPotPaid(round.eventId, "match");
  });
});

describe("a birdie pot on a four-ball", () => {
  it("settles from the cards the TEAM round kept", async () => {
    /**
     * `TeamScorecard` carries its own `playerId` — a four-ball is two cards a
     * side, one per player, which is what makes an individual birdie a thing
     * that happened. (Foursomes is the case that stays out, and for a reason
     * about golf: partners play one ball, so the side returns one card with
     * nobody's id on it.)
     */
    const round = await roundWithBirdiePot("fourball", "Round Robin", "Four-Ball");
    const team = await prisma.team.create({
      data: { eventId: round.eventId, name: `${TAG} pair`, seed: 1 },
      select: { id: true },
    });
    await prisma.teamScorecard.createMany({
      data: [
        {
          eventId: round.eventId,
          stageId: round.stageId,
          teamId: team.id,
          playerId: round.ids.birdie,
          strokes: BIRDIE_CARD,
        },
        {
          eventId: round.eventId,
          stageId: round.stageId,
          teamId: team.id,
          playerId: round.ids.steady,
          strokes: PAR_CARD,
        },
      ],
    });

    await expectPotPaid(round.eventId, "fourball");
  });
});

describe("a birdie pot on an ordinary stroke round", () => {
  it("still settles exactly as it always did", async () => {
    // The control. If this ever breaks, the change did more than fill a gap.
    const round = await roundWithBirdiePot("stroke", "Stroke Play Round", "Stroke Play");
    await prisma.scorecard.createMany({
      data: [
        {
          eventId: round.eventId,
          stageId: round.stageId,
          playerId: round.ids.birdie,
          strokes: BIRDIE_CARD,
        },
        {
          eventId: round.eventId,
          stageId: round.stageId,
          playerId: round.ids.steady,
          strokes: PAR_CARD,
        },
      ],
    });

    await expectPotPaid(round.eventId, "stroke");
  });
});

describe("and a player's own card is never displaced by one stored elsewhere", () => {
  it("reads the Scorecard when there is one, whatever a match row says", async () => {
    /**
     * THE SAFETY PROPERTY, asserted rather than reasoned about.
     *
     * `roundStrokes` reads three tables in a fixed order and takes the FIRST
     * answer for each (round, player). That ordering is the entire argument
     * for putting a new source under money at all, so it is measured: here the
     * match row says the opposite of the player's own card, and the pot must
     * go on paying what the `Scorecard` says.
     *
     * A round in this state is not hypothetical — it is what a stroke round
     * looks like after its format was changed from Match Play, where the old
     * rows stay behind and nothing deletes them.
     */
    const round = await roundWithBirdiePot("both", "Stroke Play Round", "Stroke Play");
    await prisma.scorecard.createMany({
      data: [
        {
          eventId: round.eventId,
          stageId: round.stageId,
          playerId: round.ids.birdie,
          strokes: BIRDIE_CARD,
        },
        {
          eventId: round.eventId,
          stageId: round.stageId,
          playerId: round.ids.steady,
          strokes: PAR_CARD,
        },
      ],
    });
    const match = await prisma.match.create({
      data: {
        eventId: round.eventId,
        stageId: round.stageId,
        groupId: round.groupId,
        round: 1,
        // Deliberately the WRONG way round: the match rows would hand the
        // birdie to the other player if they were read.
        playerAId: round.ids.steady,
        playerBId: round.ids.birdie,
        holes: JSON.stringify(new Array(18).fill("H")),
      },
      select: { id: true },
    });
    await prisma.matchScorecard.createMany({
      data: [
        { eventId: round.eventId, matchId: match.id, slot: "A", strokes: BIRDIE_CARD },
        { eventId: round.eventId, matchId: match.id, slot: "B", strokes: PAR_CARD },
      ],
    });

    // Unchanged: the player who birdied on their OWN card still takes it.
    await expectPotPaid(round.eventId, "both");
  });
});
