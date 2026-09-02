import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { skinsPotFor } from "../services/skins-pot";

/**
 * A net skins pot allocates strokes on the holes that were actually played.
 *
 * Class A of the 2026-09-02 exploratory audit: `cardForStage` is the sanctioned
 * way to narrow an eighteen-hole card to the nine a round was played on, and
 * `audit-guards.test.ts` enforces it over a hand-written list of six files.
 * This file was not on the list, and had two faults because of it — both with
 * money on them.
 *
 * A1. `Stage.nine` was selected in the query and never read. `scopeRange`
 * returns holes 0..9 for any nine-hole round whatever the scope, so a round
 * played on the BACK nine was priced off the FRONT nine's stroke index. The
 * strokes landed on the wrong holes, a different player won the skin, and the
 * pot paid them. `/live` showed the correct winner throughout, because the
 * board resolves the card properly — the two disagreed and only one moved cash.
 *
 * A2. A front- or back-nine scoped pot on an EIGHTEEN-hole round used the
 * round's handicap unchanged against a stroke index re-ranked 1..9. A player
 * owed five strokes on the front nine received nine.
 *
 * Real rows, because the fault is in how a stage's card is resolved.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-SKINSNINE";

/**
 * A card whose two nines rank their holes in OPPOSITE directions.
 *
 * This matters more than it looks, and a first attempt got it wrong: with a
 * plain 1..18 the front nine is 1..9 and the back is 10..18, and BOTH re-rank
 * to exactly 1..9 — so reading the wrong nine produces an identical allocation
 * and the test cannot see the bug at all. A fixture has to be able to fail.
 *
 * Here the front nine takes the odd indexes ascending and the back nine the
 * even ones DESCENDING, which is an ordinary real layout — hole 10 hardest on
 * the back, hole 18 easiest:
 *
 *   front (holes 1-9)    1  3  5  7  9 11 13 15 17   -> re-ranked 1..9
 *   back  (holes 10-18) 18 16 14 12 10  8  6  4  2   -> re-ranked 9..1
 *
 * So a player receiving strokes gets them on the FIRST holes of the front nine
 * and the LAST holes of the back nine. Read the wrong nine and they land
 * somewhere else entirely.
 */
const SI = [
  ...Array.from({ length: 9 }, (_, i) => i * 2 + 1),
  ...Array.from({ length: 9 }, (_, i) => 18 - i * 2),
];
const PARS = new Array(18).fill(4);
/** Slope 113 and rating equal to par, so a Course Handicap IS the Index. */
const NEUTRAL_TEE = { courseRating: 72, slopeRating: 113, par: 72 };

let eventId = "";
let backNineStageId = "";
let fullStageId = "";
const player: Record<string, string> = {};

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.course.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  const course = await prisma.course.create({
    data: {
      organizationId: org.id,
      name: `${TAG} home`,
      city: "",
      pars: JSON.stringify(PARS),
      yards: JSON.stringify(new Array(18).fill(400)),
      strokeIndex: JSON.stringify(SI),
    },
  });

  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} league`,
      dates: "",
      course: `${TAG} home`,
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${process.pid}`,
      customPars: JSON.stringify(PARS),
      customYards: JSON.stringify(new Array(18).fill(400)),
      customStrokeIndex: JSON.stringify(SI),
      teePolicy: "single",
    },
  });
  eventId = event.id;
  await prisma.eventCourse.create({ data: { eventId, courseId: course.id } });
  const tee = await prisma.tee.create({
    data: { courseId: course.id, name: `${TAG} whites`, ...NEUTRAL_TEE, position: 0 },
  });
  await prisma.event.update({ where: { id: eventId }, data: { defaultTeeId: tee.id } });

  const [back, full] = await Promise.all([
    // Nine holes, played on the BACK nine.
    prisma.stage.create({
      data: {
        eventId,
        position: 0,
        type: "Stroke Play Round",
        format: "Skins",
        holes: 9,
        nine: "back",
        courseId: course.id,
      },
    }),
    // A full eighteen, so a front- or back-nine pot covers half of it.
    prisma.stage.create({
      data: {
        eventId,
        position: 1,
        type: "Stroke Play Round",
        format: "Skins",
        holes: 18,
        nine: "full",
        courseId: course.id,
      },
    }),
  ]);
  backNineStageId = back.id;
  fullStageId = full.id;

  /**
   * A scratch man and a nine-handicapper.
   *
   * Both hand in level fours every time, so the ONLY thing that can decide a
   * hole is where the handicap strokes fall. That makes every assertion below
   * a statement about stroke allocation and nothing else.
   */
  for (const [who, handicap] of [["scratch", 0], ["nine", 9]] as const) {
    const p = await prisma.player.create({
      data: {
        eventId,
        name: `${TAG} ${who}`,
        email: `${TAG}.${who}@example.invalid`.toLowerCase(),
        seed: who === "scratch" ? 1 : 2,
        status: "confirmed",
        handicap,
        teeId: tee.id,
      },
    });
    player[who] = p.id;
  }
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

/**
 * Put both players in a pot on a stage, level fours each, and read it back.
 *
 * The pot is created with the SCOPE being asked about: `skinsPotFor` looks a
 * pot up by `(stageId, net, scope, groupKey)`, so a pot stored as "full" is
 * simply not found when the front nine is requested.
 */
async function potFor(stageId: string, scope: "full" | "front" | "back", holes: number) {
  await prisma.scorecard.deleteMany({ where: { eventId, stageId } });
  await prisma.roundHandicap.deleteMany({ where: { eventId, stageId } });
  await prisma.skinsPot.deleteMany({ where: { stageId } });

  const pot = await prisma.skinsPot.create({
    data: { eventId, stageId, net: true, scope, groupKey: "", buyInCents: 1000 },
  });
  for (const who of ["scratch", "nine"] as const) {
    await prisma.skinsEntry.create({
      data: { potId: pot.id, playerId: player[who], confirmed: true },
    });
    await prisma.scorecard.create({
      data: {
        eventId,
        stageId,
        playerId: player[who],
        strokes: JSON.stringify(new Array(holes).fill(4)),
      },
    });
  }

  const view = await skinsPotFor(eventId, stageId, true, scope, "");
  expect(view, "the pot view should resolve").toBeTruthy();
  return view!;
}

/** Which holes the nine-handicapper took, by hole number as displayed. */
const holesWonByNine = (view: { holes: { hole: number; playerId?: string | null }[] }) =>
  view.holes.filter((h) => h.playerId === player.nine).map((h) => h.hole);

describe("a nine-hole round played on the back nine", () => {
  it("allocates strokes down the BACK nine's index, not the front's", async () => {
    /**
     * The regression, and it does not depend on how many strokes he gets.
     *
     * On the back nine the EASIEST hole is played first (index 18) and the
     * hardest last (index 2), so his strokes fall at the END of the card. Read
     * off the front nine by mistake they fall at the START. Whatever his
     * nine-hole handicap works out to, those two readings cannot both be true.
     *
     * Asserting the shape rather than a count also keeps this honest about
     * WHS: a nine-hole round halves an eighteen-hole index before the slope
     * conversion, so his five-ish strokes here are correct and not the nine he
     * would receive over a full round.
     */
    const view = await potFor(backNineStageId, "full", 9);
    const won = holesWonByNine(view);

    expect(won.length, "he must win something, or this proves nothing").toBeGreaterThan(0);
    expect(won, "hole 1 is the EASIEST on the back nine — he has no stroke there").not.toContain(1);
    expect(won, "hole 9 is the hardest — his first stroke belongs here").toContain(9);
  });

  it("still pays a genuine winner on that nine", async () => {
    // The guard against the guard: a pot that can never pay out is not a fix.
    await prisma.scorecard.deleteMany({ where: { eventId, stageId: backNineStageId } });
    await prisma.roundHandicap.deleteMany({ where: { eventId, stageId: backNineStageId } });
    await prisma.skinsPot.deleteMany({ where: { stageId: backNineStageId } });
    const pot = await prisma.skinsPot.create({
      data: { eventId, stageId: backNineStageId, net: true, scope: "full", groupKey: "", buyInCents: 1000 },
    });
    for (const who of ["scratch", "nine"] as const) {
      await prisma.skinsEntry.create({ data: { potId: pot.id, playerId: player[who], confirmed: true } });
    }
    // Scratch eagles the first; the nine-handicapper has no stroke there.
    await prisma.scorecard.create({
      data: {
        eventId,
        stageId: backNineStageId,
        playerId: player.scratch,
        strokes: JSON.stringify([2, 4, 4, 4, 4, 4, 4, 4, 4]),
      },
    });
    await prisma.scorecard.create({
      data: {
        eventId,
        stageId: backNineStageId,
        playerId: player.nine,
        strokes: JSON.stringify(new Array(9).fill(4)),
      },
    });

    const view = await skinsPotFor(eventId, backNineStageId, true, "full", "");
    expect(view!.holes.find((h) => h.hole === 1)?.playerId).toBe(player.scratch);
  });
});

describe("a half-round pot on an eighteen-hole round", () => {
  it("gives him only the strokes he is owed on the front nine", async () => {
    /**
     * Over a full eighteen he plays off 9, so he has a stroke on stroke indexes
     * 1 to 9. On this card that is five holes of the front nine (indexes
     * 1,3,5,7,9) and four of the back (8,6,4,2) — nine in total.
     *
     * Passing his round handicap of 9 through unchanged against a front nine
     * re-ranked 1..9 gave him a stroke on all NINE holes, so he took the whole
     * pot instead of five holes of it.
     */
    const view = await potFor(fullStageId, "front", 18);
    const won = holesWonByNine(view);
    expect(won.length, "five strokes on the front nine, not nine").toBe(5);
    // And they are the five hardest of that nine, which are its first five.
    expect(won).toEqual([1, 2, 3, 4, 5]);
  });

  it("gives him the four he is owed on the back nine", async () => {
    /**
     * The other half, and the reason this is COUNTED rather than halved.
     * `Math.round(9 / 2)` is 5 on both nines; the true split is 5 and 4. Asking
     * the app's own allocator which of these specific holes carry a stroke is
     * exact for any handicap and any index layout.
     */
    const view = await potFor(fullStageId, "back", 18);
    const won = holesWonByNine(view);
    expect(won.length, "four strokes on the back nine").toBe(4);
    /**
     * Numbered as they are PLAYED, 10-18 — the back nine of an eighteen-hole
     * round keeps its real hole numbers, where a nine-hole round played on the
     * back nine numbers them 1-9. So his last four holes are 15-18. (The first
     * version of this expected 6-9, which was the right four holes counted from
     * the wrong end of the numbering.)
     */
    expect(won).toEqual([15, 16, 17, 18]);
  });

  it("leaves a full-round pot exactly as it was", async () => {
    // The conversion must be inert when the pot covers the whole round, or
    // every ordinary eighteen-hole pot changes underneath its club.
    const view = await potFor(fullStageId, "full", 18);
    expect(holesWonByNine(view).length, "a stroke on each of stroke indexes 1-9").toBe(9);
  });

  it("gives the scratch man nothing, on any scope", async () => {
    // Nobody should gain a stroke from this change.
    for (const scope of ["front", "back", "full"] as const) {
      const view = await potFor(fullStageId, scope, 18);
      expect(view.holes.filter((h) => h.playerId === player.scratch).length).toBe(0);
    }
  });
});
