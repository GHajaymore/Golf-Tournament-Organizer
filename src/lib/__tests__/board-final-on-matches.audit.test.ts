import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

// The board is `unstable_cache`d in production. Identity here, so each read
// reflects the rows as they stand rather than a minute ago.
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}));

import { liveBoard } from "@/lib/services/live-board";

/**
 * THE PUBLIC BOARD CALLED A MATCH ROUND "FINAL" ON ONE HOLE.
 *
 * `allIn` drives the chip on `/live/[token]` — "Final" against "Live" — and it
 * has two branches that were held to completely different standards:
 *
 *     cards    every player who is IN has `thru >= holeCount`
 *     matches  every match `matchSettled`
 *
 * The card branch demands a full round. `matchSettled` is satisfied by a match
 * with ONE HOLE on it. So a club's spectators, the widest audience anything in
 * this app has, were told a round was FINAL while every pairing was still on
 * the 2nd tee.
 *
 * THIS IS THE THIRD TIME THE SAME TWO FUNCTIONS HAVE BEEN CONFUSED, and the
 * distinction is already written down twice — once on `matchSettled` itself
 * and once, at length, on `matchIsOver`, whose doc block exists to record the
 * previous instance:
 *
 *     "That gap was load-bearing. `roundMoneyFor` fed `matchSettled` into
 *      `roundMoneyIsFinal`, so a match round flipped to 'final' the moment
 *      every pairing had a single hole entered."
 *
 * Same sentence, different screen. `matchSettled` is right for "which round is
 * the tournament on" — a round somebody has begun scoring is the round being
 * played — and wrong for any claim about a RESULT. `matchIsOver` is the strict
 * reading: it lives beside `resolveMatch`, it counts a closeout so 5&4 is over
 * with four holes unplayed, and it guards the empty card explicitly.
 *
 * BOTH DIRECTIONS ARE ASSERTED, because either alone is easy to satisfy
 * wrongly: a rule that never goes Final passes every "still being played" case,
 * and the rule being replaced passes every "is finished" case.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-BOARDMATCH";

let eventId = "";
let stageId = "";
let shareToken = "";
const player: Record<string, string> = {};
const matchId: Record<string, string> = {};

/** One hole played and nothing else — started, nowhere near over. */
const ONE_HOLE = JSON.stringify(["A", ...new Array(17).fill(null)]);
/** A won 5&4: decided, with four holes never played. */
const WON_5_AND_4 = JSON.stringify([...new Array(14).fill("A"), null, null, null, null]);

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

const setHoles = (key: string, holes: string) =>
  prisma.match.update({ where: { id: matchId[key] }, data: { holes } });

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({
    data: { name: `${TAG} club`, kind: "club" },
    select: { id: true },
  });

  shareToken = randomBytes(12).toString("hex");
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} matchplay`,
      // NOT completed — the committee's word is its own escape hatch and would
      // make the board Final whatever the matches say.
      status: "live",
      shape: "series",
      format: "match",
      formationRule: "balanced",
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      capacity: 0,
      shareToken,
      registrationToken: randomBytes(8).toString("hex"),
      leaderboardVisibility: "public",
    },
    select: { id: true },
  });
  eventId = event.id;

  const stage = await prisma.stage.create({
    data: {
      eventId,
      position: 0,
      type: "Round Robin",
      format: "Match Play",
      holes: 18,
      scoringBasis: "gross",
      handicapAllowance: 100,
    },
    select: { id: true },
  });
  stageId = stage.id;

  const group = await prisma.group.create({
    data: { eventId, name: "A", position: 0 },
    select: { id: true },
  });

  for (const [i, who] of ["ann", "bea", "cal", "dee"].entries()) {
    const p = await prisma.player.create({
      data: {
        eventId,
        name: `${TAG} ${who}`,
        email: `${TAG}-${who}@example.invalid`.toLowerCase(),
        handicap: 6 + i * 4,
        seed: i + 1,
        status: "confirmed",
        groupId: group.id,
      },
      select: { id: true },
    });
    player[who] = p.id;
  }

  // Two pairings, so "every match" is a claim about more than one thing.
  for (const [key, a, b] of [
    ["one", "ann", "bea"],
    ["two", "cal", "dee"],
  ] as const) {
    const m = await prisma.match.create({
      data: {
        eventId,
        stageId,
        groupId: group.id,
        round: 1,
        playerAId: player[a],
        playerBId: player[b],
        holes: ONE_HOLE,
      },
      select: { id: true },
    });
    matchId[key] = m.id;
  }
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const board = async () => {
  const b = await liveBoard(eventId);
  expect(b, "the public board did not load").not.toBeNull();
  return b!;
};

describe("the public board on a match round", () => {
  it("stays LIVE while every match is one hole old", async () => {
    // THE FAULT. Both pairings have teed off and neither is decided; the chip
    // on /live said "Final".
    await setHoles("one", ONE_HOLE);
    await setHoles("two", ONE_HOLE);
    expect(
      (await board()).allIn,
      "two matches on the 2nd tee is not a finished round",
    ).toBe(false);
  });

  it("stays LIVE while one match is over and the other is not", async () => {
    await setHoles("one", WON_5_AND_4);
    await setHoles("two", ONE_HOLE);
    expect((await board()).allIn, "one pairing still out holds the board Live").toBe(false);
  });

  it("goes FINAL once every match is actually over", async () => {
    /**
     * THE CELL THAT KEEPS THE RULE FROM BEING "NEVER". Tightening the test is
     * only correct if the board can still turn — otherwise a match-play club's
     * board reads Live for ever, which is the exact defect
     * `league-board-final.audit.test.ts` was written for, on the other branch.
     *
     * And a CLOSEOUT has to count: 5&4 is over with four holes unplayed, so a
     * rule demanding eighteen returned holes would refuse most real match play.
     */
    await setHoles("one", WON_5_AND_4);
    await setHoles("two", WON_5_AND_4);
    expect((await board()).allIn, "every match decided is a finished round").toBe(true);
  });

  it("does not go FINAL on a round nobody has started", async () => {
    /**
     * The empty card is the trap `matchIsOver` guards explicitly:
     * `resolveMatch([])` is COMPLETE, because nothing is left to play. A drawn
     * round nobody has touched is stored as "[]", so without that guard a
     * board would announce Final before the first tee shot.
     */
    await setHoles("one", "[]");
    await setHoles("two", "[]");
    expect((await board()).allIn, "a drawn round is not a played one").toBe(false);
  });
});
