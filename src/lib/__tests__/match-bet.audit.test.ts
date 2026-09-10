import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { moneyFor } from "../services/expenses";

/**
 * "We're playing for a tenner" settles, end to end.
 *
 * The commonest bet in golf, and the one the app had nowhere to put. Every
 * other side game is a POT — everybody pays in and the cards decide who takes
 * it out — and this is not: it is one wager between two sides, settled by the
 * match result and nothing else.
 *
 * A Nassau is three of these on one card, so the only way to record a single
 * stake was to describe it as three bets and divide by three.
 *
 * THE POINT OF AN AUDIT TEST HERE rather than the unit tests next door: the
 * arithmetic is already covered against values in `match-bet.test.ts`. What
 * this proves is the WIRING — that a `SideGame` row of kind "match" is picked
 * up by `gameNets`, resolved against the round's real matches, and reaches a
 * player's own money figure. That is the join the derived pots were stranded
 * on twice before.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-MATCHBET";

const PARS = new Array(18).fill(4);
const SI = Array.from({ length: 18 }, (_, i) => i + 1);
/** A won 1, 2 and 3 and halved to the 16th — 3&2, a finished match. */
const CLOSED_OUT = JSON.stringify(["A", "A", "A", ...new Array(13).fill("H"), null, null]);
/** Two up with sixteen to play — a match anybody can still win. */
const STILL_ON = JSON.stringify(["A", "A", ...new Array(16).fill(null)]);

const at = (who: string) => `${TAG}.${who}@example.invalid`.toLowerCase();

let organizationId = "";
let courseId = "";

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.course.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await scrub();
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
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

/** A match-play round with two players, a £10 match bet, and a given card. */
async function roundWithBet(name: string, holes: string) {
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
      status: "live",
      shape: "single",
      format: "match",
      courseId,
    },
    select: { id: true },
  });
  await prisma.eventCourse.create({ data: { eventId: event.id, courseId } });
  const stage = await prisma.stage.create({
    data: {
      eventId: event.id,
      position: 0,
      type: "Round Robin",
      format: "Match Play",
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

  const ids: Record<string, string> = {};
  for (const [i, who] of ["won", "lost"].entries()) {
    const p = await prisma.player.create({
      data: {
        eventId: event.id,
        groupId: group.id,
        name: `${TAG} ${who}`,
        email: at(`${name}.${who}`),
        handicap: 0,
        handicapType: "18",
        status: "confirmed",
        seed: i + 1,
      },
      select: { id: true },
    });
    ids[who] = p.id;
  }

  await prisma.match.create({
    data: {
      eventId: event.id,
      stageId: stage.id,
      groupId: group.id,
      round: 1,
      playerAId: ids.won,
      playerBId: ids.lost,
      holes,
    },
  });
  await prisma.sideGame.create({
    data: {
      eventId: event.id,
      stageId: stage.id,
      // The kind this whole test is about. `gameNets` has to recognise it.
      kind: "match",
      buyInCents: 1000,
      entryMode: "opt-out",
    },
  });
  return { eventId: event.id, ids };
}

describe("a tenner on the match", () => {
  it("moves from the loser to the winner once the match is over", async () => {
    const round = await roundWithBet("closed", CLOSED_OUT);
    const [won, lost] = await Promise.all([
      moneyFor(round.eventId, at("closed.won")),
      moneyFor(round.eventId, at("closed.lost")),
    ]);
    // By VALUE and in both directions. A wiring failure pays nobody, and two
    // zeroes also sum to zero — so the zero-sum check alone proves nothing.
    expect(won.gamesCents, "the winner takes a stake").toBe(1000);
    expect(lost.gamesCents, "out of the loser").toBe(-1000);
  });

  it("and pays nobody while the match is still being played", async () => {
    /**
     * THE ASSERTION THAT KEEPS THIS HONEST. Paying a lead is settling a bet
     * that is still on: two up with sixteen to play is a match anybody can
     * still win. `matchBetNets` pays only a match `resolveMatch` calls
     * complete — the same rule the Nassau's segments follow.
     */
    const round = await roundWithBet("live", STILL_ON);
    const [a, b] = await Promise.all([
      moneyFor(round.eventId, at("live.won")),
      moneyFor(round.eventId, at("live.lost")),
    ]);
    expect(a.gamesCents).toBe(0);
    expect(b.gamesCents).toBe(0);
  });
});
