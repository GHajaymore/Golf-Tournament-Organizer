import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A member's club handicap, built from cards actually in the database.
 *
 * The domain tests prove the arithmetic against the Rules. This proves the
 * gathering: that a member's rounds are found across every event they entered,
 * that only APPROVED cards count, and that each round is priced off what it was
 * played off on the day rather than off today's roster.
 *
 * That last one is the reason this test exists rather than being a unit test.
 * The whole feature is worthless if a differential is computed from a handicap
 * the player did not have — and nothing about it looks wrong on screen.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

import { memberHandicapRecord } from "@/lib/services/handicap-record";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-HCPREC";

let orgId = "";
let memberId = "";
let eventId = "";
let courseId = "";
let teeId = "";
const stageIds: string[] = [];
let playerId = "";

/** Pebble Beach's real card, blue tees. */
const PARS = [4, 5, 4, 4, 3, 5, 3, 4, 4, 4, 4, 3, 4, 5, 4, 4, 3, 5];
const SI = [6, 10, 12, 16, 14, 2, 18, 4, 8, 3, 9, 17, 7, 1, 13, 11, 15, 5];

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.course.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.member.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();

  const org = await prisma.organization.create({
    data: { name: `${TAG} Club`, kind: "club", subscription: { create: { plan: "free", status: "active" } } },
  });
  orgId = org.id;

  const member = await prisma.member.create({
    data: { organizationId: orgId, name: `${TAG} Vaughn`, handicap: 18, handicapSource: "manual" },
  });
  memberId = member.id;

  const course = await prisma.course.create({
    data: {
      organizationId: orgId,
      name: `${TAG} Course`,
      pars: JSON.stringify(PARS),
      strokeIndex: JSON.stringify(SI),
      yards: JSON.stringify(new Array(18).fill(400)),
    },
  });
  courseId = course.id;

  const tee = await prisma.tee.create({
    data: { courseId, name: "Blue", gender: "men", courseRating: 74.9, slopeRating: 144, par: 72 },
  });
  teeId = tee.id;

  const event = await prisma.event.create({
    data: {
      organizationId: orgId,
      name: `${TAG} Cup`,
      dates: "2026-05-01",
      course: `${TAG} Course`,
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-token`,
    },
  });
  eventId = event.id;
  await prisma.eventCourse.create({ data: { eventId, courseId } });

  const player = await prisma.player.create({
    data: { eventId, memberId, name: `${TAG} Vaughn`, handicap: 18, teeId, seed: 1, status: "confirmed" },
  });
  playerId = player.id;

  // Four rounds on four dates, so ordering and the 20-window are exercised.
  for (let i = 0; i < 4; i += 1) {
    const stage = await prisma.stage.create({
      data: {
        eventId,
        position: i,
        type: "Stroke Play Round",
        format: "Stroke Play",
        holes: 18,
        courseId,
        playedOn: `2026-0${i + 1}-10`,
      },
    });
    stageIds.push(stage.id);
  }
}, 60000);

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

/** A card that is `over` shots worse than par, one shot at a time. */
const cardOf = (over: number) => JSON.stringify(PARS.map((p, i) => p + (i < over ? 1 : 0)));

describe("a member's record, from the database", () => {
  it("finds nothing before any card is approved", async () => {
    // An entered card is not a result. Scorecard.status says so itself:
    // "approved — the committee has accepted it. Only now is it a result."
    await prisma.scorecard.create({
      data: { eventId, stageId: stageIds[0], playerId, strokes: cardOf(14), status: "entered" },
    });
    const r = await memberHandicapRecord(orgId, memberId);
    expect(r).not.toBeNull();
    expect(r!.cardsFound).toBe(0);
    expect(r!.suggestion).toBeNull();
  });

  it("counts a card once the committee approves it", async () => {
    await prisma.scorecard.updateMany({
      where: { stageId: stageIds[0], playerId },
      data: { status: "approved" },
    });
    const r = await memberHandicapRecord(orgId, memberId);
    expect(r!.cardsFound).toBe(1);
    expect(r!.differentials).toHaveLength(1);
    // Still no handicap: the Rules issue none below three scores.
    expect(r!.suggestion).toBeNull();
  });

  it("issues a handicap at three approved cards, and shows the working", async () => {
    for (const [i, over] of [[1, 18], [2, 22]] as const) {
      await prisma.scorecard.create({
        data: { eventId, stageId: stageIds[i], playerId, strokes: cardOf(over), status: "approved" },
      });
    }
    const r = await memberHandicapRecord(orgId, memberId);
    expect(r!.differentials).toHaveLength(3);
    expect(r!.suggestion).not.toBeNull();
    // Lowest 1 minus 2.0 at three scores — Appendix E.
    expect(r!.suggestion!.lowestCounted).toBe(1);
    expect(r!.suggestion!.adjustment).toBe(-2.0);
    // A real number for a bogey-ish golfer off a 144 slope, not 40 and not 2.
    expect(r!.suggestion!.handicap).toBeGreaterThan(2);
    expect(r!.suggestion!.handicap).toBeLessThan(20);
  });

  it("prices a round off what it was played off THAT DAY, not today's roster", async () => {
    // The whole point of the feature, and the thing that looks fine when it is
    // wrong. Freeze round one at scratch, then move the roster to 36. The
    // differential for that round must not move.
    const before = await memberHandicapRecord(orgId, memberId);
    const baseline = before!.differentials[0];

    await prisma.roundHandicap.create({
      data: { eventId, stageId: stageIds[0], playerId, frozen: 0 },
    });
    const frozen = await memberHandicapRecord(orgId, memberId);
    // A lower handicap raises the net-double-bogey caps less, so the adjusted
    // gross can only go up or stay level — never down.
    expect(frozen!.differentials[0]).toBeGreaterThanOrEqual(baseline);

    const pinned = frozen!.differentials[0];
    await prisma.member.update({ where: { id: memberId }, data: { handicap: 36 } });
    await prisma.player.update({ where: { id: playerId }, data: { handicap: 36 } });

    const after = await memberHandicapRecord(orgId, memberId);
    expect(after!.differentials[0]).toBe(pinned);

    await prisma.member.update({ where: { id: memberId }, data: { handicap: 18 } });
    await prisma.player.update({ where: { id: playerId }, data: { handicap: 18 } });
  });

  it("counts out a round on an unrated tee rather than inventing a rating", async () => {
    const unrated = await prisma.tee.create({
      data: { courseId, name: "Unrated", gender: "any", courseRating: 0, slopeRating: 0, par: 72 },
    });
    await prisma.player.update({ where: { id: playerId }, data: { teeId: unrated.id } });

    const r = await memberHandicapRecord(orgId, memberId);
    expect(r!.differentials).toHaveLength(0);
    expect(r!.skipped["unrated-tee"]).toBeGreaterThan(0);
    // The cards are still FOUND — the member is told they exist and why they
    // did not count, rather than watching their record shrink.
    expect(r!.cardsFound).toBeGreaterThan(0);

    await prisma.player.update({ where: { id: playerId }, data: { teeId } });
  });

  /**
   * THE ORDINARY CLUB SETUP: rated tees, an event default, and nobody carrying
   * a personal tee.
   *
   * Every test above assigns `teeId` to the player in `beforeAll`, so the case
   * that actually ships was the one case never exercised. `Player.teeId` is
   * only ever written from a matched `preferredTee` — most members have none —
   * and this resolved the tee from that column alone. So `teeRatingFor` got
   * null, every card was counted out, and the screen read "N cards found, 0
   * differentials". No club handicap was ever issued, however many approved
   * medals a member returned.
   */
  it("prices a round off the event's tee when the player carries none", async () => {
    await prisma.event.update({ where: { id: eventId }, data: { defaultTeeId: teeId, teePolicy: "own" } });
    await prisma.player.update({ where: { id: playerId }, data: { teeId: null } });
    try {
      const r = await memberHandicapRecord(orgId, memberId);
      expect(r!.cardsFound).toBeGreaterThan(0);
      // The differentials the same cards produce when the tee IS on the player.
      expect(r!.differentials).toHaveLength(3);
      expect(r!.skipped["unrated-tee"] ?? 0).toBe(0);
    } finally {
      // In a finally because this fixture is shared with every test below, and
      // a failure here used to leave the player on no tee — so the next four
      // tests failed too, describing this fault rather than their own.
      await prisma.event.update({ where: { id: eventId }, data: { defaultTeeId: null } });
      await prisma.player.update({ where: { id: playerId }, data: { teeId } });
    }
  });

  /**
   * `one` means the committee's set for the whole field, and a stale personal
   * tee must not quietly win — Rule 6.1b makes playing from the wrong tee a
   * penalty, so a differential built off one the player did not use is worse
   * than no differential.
   */
  it("under a single-tee policy the round is priced off the round's tee, not a stale personal one", async () => {
    const other = await prisma.tee.create({
      data: { courseId, name: `${TAG} Forward`, gender: "men", courseRating: 68.0, slopeRating: 113, par: 72 },
    });
    try {
      await prisma.event.update({ where: { id: eventId }, data: { defaultTeeId: teeId, teePolicy: "one" } });
      await prisma.player.update({ where: { id: playerId }, data: { teeId: other.id } });
      const single = await memberHandicapRecord(orgId, memberId);

      // The same cards off the default set, with no personal tee in the way.
      await prisma.player.update({ where: { id: playerId }, data: { teeId: null } });
      const baseline = await memberHandicapRecord(orgId, memberId);

      expect(single!.differentials).toEqual(baseline!.differentials);

      // And the two tees really do price a card differently, so the assertion
      // above cannot pass by their being interchangeable — which is how a
      // policy test quietly stops testing the policy.
      await prisma.event.update({ where: { id: eventId }, data: { teePolicy: "own" } });
      await prisma.player.update({ where: { id: playerId }, data: { teeId: other.id } });
      const ownTee = await memberHandicapRecord(orgId, memberId);
      expect(ownTee!.differentials).not.toEqual(baseline!.differentials);
    } finally {
      await prisma.event.update({ where: { id: eventId }, data: { defaultTeeId: null, teePolicy: "own" } });
      await prisma.player.update({ where: { id: playerId }, data: { teeId } });
      await prisma.tee.delete({ where: { id: other.id } });
    }
  });

  /**
   * A stored NINE-hole index is not the number an 18-hole round is priced off.
   *
   * `handicapsForRound` converts through `indexForHoles` before it computes
   * anything; this passed `entry.handicap` raw, so a member whose index is
   * recorded as a nine had every eighteen-hole differential built off half the
   * handicap they actually play to.
   */
  it("doubles a stored nine-hole index for an eighteen-hole round", async () => {
    /**
     * On a BLOW-UP hole, because nothing else can show this.
     *
     * The cards above are straight bogeys, and a bogey never exceeds net double
     * bogey at any handicap — so the caps never bind, the adjusted gross is the
     * gross whatever index is used, and a differential built off half the right
     * handicap looks identical to one built off all of it. The first version of
     * this test asserted against those cards and passed on both branches.
     *
     * A 10 on the stroke-index-1 hole is the discriminator: capped at par+2+1
     * off an 18 index, and at par+2+3 once that index is read as a nine and
     * doubled.
     */
    const blowUp = PARS.map((p, i) => (i === SI.indexOf(1) ? 10 : p));
    const card = await prisma.scorecard.create({
      data: { eventId, stageId: stageIds[3], playerId, strokes: JSON.stringify(blowUp), status: "approved" },
    });
    try {
      const eighteen = await memberHandicapRecord(orgId, memberId);
      await prisma.player.update({ where: { id: playerId }, data: { handicapType: "9" } });
      const nine = await memberHandicapRecord(orgId, memberId);

      // Both read the same four cards, so any difference is the index alone.
      expect(eighteen!.differentials).toHaveLength(4);
      expect(nine!.differentials).toHaveLength(4);
      // More strokes received raises the cap on that hole, so the adjusted
      // gross is higher and the differential with it.
      expect(nine!.differentials).not.toEqual(eighteen!.differentials);
    } finally {
      await prisma.player.update({ where: { id: playerId }, data: { handicapType: "18" } });
      await prisma.scorecard.delete({ where: { id: card.id } });
    }
  });

  it("never suggests over an association figure", async () => {
    await prisma.member.update({ where: { id: memberId }, data: { handicapSource: "ghin" } });
    const r = await memberHandicapRecord(orgId, memberId);
    expect(r!.maySuggest).toBe(false);
    // The record is still computed — a club may look at it. It just is not
    // offered as a replacement for a licensed figure.
    expect(r!.differentials.length).toBeGreaterThan(0);
    await prisma.member.update({ where: { id: memberId }, data: { handicapSource: "manual" } });
  });

  it("returns a member with no entries rather than throwing", async () => {
    const lonely = await prisma.member.create({
      data: { organizationId: orgId, name: `${TAG} Newcomer`, handicap: 0 },
    });
    const r = await memberHandicapRecord(orgId, lonely.id);
    expect(r!.cardsFound).toBe(0);
    expect(r!.suggestion).toBeNull();
  });

  it("refuses a member from another club", async () => {
    // The organization is the scope. A member id from elsewhere is not ours to
    // report on, however valid the id.
    expect(await memberHandicapRecord("not-this-org", memberId)).toBeNull();
  });
});
