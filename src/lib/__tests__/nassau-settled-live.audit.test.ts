import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { roundMoneyFor } from "../services/expenses";

/**
 * A SETTLED NASSAU SEGMENT SHOWS ON A ROUND STILL IN PLAY — and nothing else
 * does.
 *
 * The money screen's rule was "final only, never live", which is right for a
 * pool pot: a skins position on the 14th is a different number that happens to
 * look like the answer. A Nassau is not a pool. Its front nine is decided the
 * moment the ninth is returned and cannot be re-won by a back nine nobody has
 * started — so withholding it until the whole round is final is hiding a
 * settled result, the opposite failure `money-layout.ts` warns about.
 *
 * `roundMoneyFor` now reports that settled segment in `settledSoFarCents`,
 * separately from `yourCents`/`standing` (which stay final-only) and from the
 * outing total (which stays "the rounds that have finished"). This pins:
 *
 *   - the round is NOT final (its match has nine holes still to play);
 *   - the settled front nine reaches the player's figure, by VALUE and in both
 *     directions — a wiring failure pays nobody, and two zeroes also sum to
 *     zero, so a zero-sum check alone proves nothing;
 *   - it is NOT counted in `yourCents`, `standing` or the outing total;
 *   - it is NOT double-counted as exposure — a Nassau is never in `stake`, so
 *     `stake.cents` is zero here even though there is money on the round.
 *
 * Reverting the fix (`settledSoFarCents = 0`, or gating the Nassau slice on
 * whole-round finality) turns the value assertion red.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-NASSAU-LIVE";

const PARS = new Array(18).fill(4);
const SI = Array.from({ length: 18 }, (_, i) => i + 1);
/** A wins the front nine, back nine unplayed — front SETTLED, round NOT over. */
const FRONT_ONLY = JSON.stringify(["A", "A", "A", "A", "A", "H", "H", "H", "H", ...new Array(9).fill(null)]);
const STAKE = 1000;

const at = (who: string) => `${TAG}.${who}@example.invalid`.toLowerCase();

let eventId = "";

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.course.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await scrub();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" }, select: { id: true } });
  const course = await prisma.course.create({
    data: {
      organizationId: org.id,
      name: `${TAG} course`,
      city: "",
      pars: JSON.stringify(PARS),
      yards: JSON.stringify(new Array(18).fill(400)),
      strokeIndex: JSON.stringify(SI),
    },
    select: { id: true },
  });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} matchplay`,
      dates: "",
      course: `${TAG} course`,
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${process.pid}`.slice(0, 60),
      customPars: JSON.stringify(PARS),
      customYards: JSON.stringify(new Array(18).fill(400)),
      customStrokeIndex: JSON.stringify(SI),
      moneyMode: "split",
      status: "live",
      shape: "single",
      format: "match",
      courseId: course.id,
    },
    select: { id: true },
  });
  eventId = event.id;
  await prisma.eventCourse.create({ data: { eventId, courseId: course.id } });
  const stage = await prisma.stage.create({
    data: {
      eventId,
      position: 0,
      type: "Round Robin",
      format: "Match Play",
      holes: 18,
      nine: "full",
      scoringBasis: "gross",
      courseId: course.id,
    },
    select: { id: true },
  });
  const group = await prisma.group.create({ data: { eventId, name: "A", position: 0 }, select: { id: true } });

  const ids: Record<string, string> = {};
  for (const [i, who] of ["won", "lost"].entries()) {
    const p = await prisma.player.create({
      data: {
        eventId,
        groupId: group.id,
        name: `${TAG} ${who}`,
        email: at(who),
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
    data: { eventId, stageId: stage.id, groupId: group.id, round: 1, playerAId: ids.won, playerBId: ids.lost, holes: FRONT_ONLY },
  });
  // A field Nassau at the round stake — no group key, so it is the matches in
  // the round. This is the ONLY money on the round: no pool pot to withhold,
  // so whatever surfaces is the Nassau alone.
  await prisma.sideGame.create({
    data: { eventId, stageId: stage.id, kind: "nassau", buyInCents: STAKE, entryMode: "opt-out" },
  });
}, 120_000);

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a settled Nassau segment on a live round", () => {
  it("shows the finished front nine while the round is still out, without leaking it into the total or the stake", async () => {
    const [won, lost] = await Promise.all([roundMoneyFor(eventId, at("won")), roundMoneyFor(eventId, at("lost"))]);

    const wonRound = won.rounds[0];
    const lostRound = lost.rounds[0];

    // The round is not over — nine holes still to play.
    expect(wonRound.final, "round still in play").toBe(false);

    // The settled front nine reaches the player, by value and both ways.
    expect(wonRound.settledSoFarCents, "winner's settled front nine").toBe(STAKE);
    expect(lostRound.settledSoFarCents, "loser's settled front nine").toBe(-STAKE);

    // Not in the round result or the outing total — those stay final-only.
    expect(wonRound.yourCents, "not in the round net").toBe(0);
    expect(wonRound.standing, "not in the payout sheet").toEqual([]);
    expect(won.yourTotalCents, "not in the outing total").toBe(0);

    // Not double-counted as exposure: a Nassau is never in the stake, so the
    // one figure the player sees is the settled one, not the same money again.
    expect(won.stake.cents, "Nassau is not exposure").toBe(0);
  });
});
