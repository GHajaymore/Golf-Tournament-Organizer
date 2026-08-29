import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * The public boards price a card off a Course Handicap, like everything else.
 *
 * From the 2026-08-27 exploratory audit. `skinsBoard` and
 * `modifiedStablefordBoard` handed `Player.handicap` straight to the allocator.
 * That is a Handicap INDEX, and `domain/handicap.ts` opens by saying that using
 * one where the other belongs "is the single most common way an otherwise
 * correct scoring engine produces wrong results".
 *
 * A 12.4 index off a slope-140 course is a Course Handicap of 16, not 12. The
 * settlement screen already converted; the board did not — so for a net skins
 * round the board shown to the field and the money the club actually paid named
 * different winners. Skins are won outright, so a single differing stroke flips
 * a hole from a win to a tie and carries its value onward.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

import { skinsBoard, modifiedStablefordBoard } from "@/lib/services/points-standings";
import { courseHandicapMap, playingHandicapFrom } from "@/lib/domain/handicap";
import { holeStrokesReceived } from "@/lib/domain/stroke";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-BOARDHCP";

let eventId = "";
let stageId = "";
let modStageId = "";
let teeId = "";
const player: Record<string, string> = {};

// An ordinary card, stroke index 1..18 so a hole's number IS its difficulty.
const SI = Array.from({ length: 18 }, (_, i) => i + 1);
const PARS = new Array(18).fill(4);

/**
 * Slope 140 turns a 12.4 index into 15 strokes; the raw index would give 12.
 *
 * Course rating deliberately EQUAL to par, so the only thing separating the
 * two numbers is the slope conversion this is about. A rating above par adds
 * its own half-shot — correctly: a scratch player off a 72.5/72 course plays
 * off 1 — and that would muddy what these tests are pointing at.
 */
const SLOPE = 140;
const RATING = 72;
const INDEX = 12.4;

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
      name: `${TAG} links`,
      city: "",
      pars: JSON.stringify(PARS),
      yards: JSON.stringify(new Array(18).fill(400)),
      strokeIndex: JSON.stringify(SI),
    },
  });

  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} open`,
      dates: "",
      course: `${TAG} links`,
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${process.pid}`,
      customPars: JSON.stringify(PARS),
      customYards: JSON.stringify(new Array(18).fill(400)),
      customStrokeIndex: JSON.stringify(SI),
      // Everyone off the one set of tees, so the conversion is unambiguous.
      teePolicy: "single",
    },
  });
  eventId = event.id;
  await prisma.eventCourse.create({ data: { eventId, courseId: course.id } });

  const tee = await prisma.tee.create({
    data: {
      courseId: course.id,
      name: `${TAG} blues`,
      courseRating: RATING,
      slopeRating: SLOPE,
      par: 72,
      position: 0,
    },
  });
  teeId = tee.id;
  await prisma.event.update({ where: { id: eventId }, data: { defaultTeeId: teeId } });

  const [skins, mod] = await Promise.all([
    prisma.stage.create({
      data: { eventId, position: 0, type: "Stroke Play Round", format: "Skins", holes: 18 },
    }),
    prisma.stage.create({
      data: {
        eventId,
        position: 1,
        type: "Stroke Play Round",
        format: "Modified Stableford",
        holes: 18,
      },
    }),
  ]);
  stageId = skins.id;
  modStageId = mod.id;

  for (const [i, [who, hcp]] of ([["hooper", INDEX], ["scratch", 0]] as const).entries()) {
    const p = await prisma.player.create({
      data: {
        eventId,
        name: `${TAG} ${who}`,
        email: `${TAG}.${who}@example.invalid`.toLowerCase(),
        seed: i + 1,
        status: "confirmed",
        handicap: hcp,
        teeId,
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

/** The conversion, done independently of the code under test. */
function playsOff(index: number, holes = 18, allowance = 100): number {
  const m = courseHandicapMap(
    [{ id: "x", handicap: index }],
    new Map([[teeId, { courseRating: RATING, slopeRating: SLOPE, par: 72 }]]),
    teeId,
    holes,
    "single",
  );
  return playingHandicapFrom(m.get("x") ?? index, allowance);
}

describe("the conversion this is all about", () => {
  it("turns a 12.4 index into more strokes than the index itself", () => {
    // If this ever stops being true the tests below prove nothing.
    expect(playsOff(INDEX)).toBeGreaterThan(Math.round(INDEX));
    expect(playsOff(0)).toBe(0);
  });
});

describe("a net skins board", () => {
  const cardsFor = async (sid: string, hooper: number[], scratch: number[]) => {
    await prisma.scorecard.deleteMany({ where: { eventId, stageId: sid } });
    await prisma.scorecard.createMany({
      data: [
        { eventId, stageId: sid, playerId: player.hooper, strokes: JSON.stringify(hooper) },
        { eventId, stageId: sid, playerId: player.scratch, strokes: JSON.stringify(scratch) },
      ],
    });
  };

  it("gives a stroke on a hole the raw index would not have covered", async () => {
    /**
     * The whole defect in one hole.
     *
     * Stroke index 14. A Course Handicap of 16 gets a shot there; the raw
     * index of 12 does not. Both players make 4, so with the stroke the hooper
     * nets 3 and takes the skin outright — and without it the hole is halved
     * and its value carries. One stroke, a different winner.
     */
    const hole = 14;
    expect(holeStrokesReceived(playsOff(INDEX), hole, 18)).toBe(1);
    expect(holeStrokesReceived(Math.round(INDEX), hole, 18)).toBe(0);

    // Everyone level everywhere else so only hole 14 can produce a skin, and
    // both players complete every hole so nothing is skipped as unplayed.
    const level = new Array(18).fill(4);
    await cardsFor(stageId, level, level);

    const board = await skinsBoard(eventId, stageId, 18, true, SI);
    const hooper = board.outcome.standings.find((s) => s.playerId === player.hooper);
    expect(hooper, "the hooper should be on the board").toBeTruthy();
    expect(hooper!.holesWon).toContain(hole);
  });

  it("gives the scratch player nothing on that hole", async () => {
    const board = await skinsBoard(eventId, stageId, 18, true, SI);
    const scratch = board.outcome.standings.find((s) => s.playerId === player.scratch);
    expect(scratch?.holesWon ?? []).not.toContain(14);
  });

  it("leaves a GROSS skins board alone — no handicap belongs in it", async () => {
    const board = await skinsBoard(eventId, stageId, 18, false, SI);
    // Every hole halved on identical gross cards, so nobody wins anything.
    expect(board.outcome.standings.every((s) => s.skins === 0)).toBe(true);
  });
});

describe("a modified Stableford board", () => {
  it("scores the card off the Playing Handicap, not the Index", async () => {
    const level = new Array(18).fill(4);
    await prisma.scorecard.deleteMany({ where: { eventId, stageId: modStageId } });
    await prisma.scorecard.create({
      data: { eventId, stageId: modStageId, playerId: player.hooper, strokes: JSON.stringify(level) },
    });

    const rows = await modifiedStablefordBoard(eventId, modStageId, PARS, SI);
    const row = rows.find((r) => r.playerId === player.hooper)!;

    // Worked out here from the conversion, with Modified Stableford's own 95%
    // allowance, rather than trusting the board to agree with itself.
    const allowance = 95;
    const expected = SI.reduce(
      (sum, si, h) =>
        sum +
        (4 - holeStrokesReceived(playsOff(INDEX, 18, allowance), si, 18) - PARS[h] === 0
          ? 0
          : 4 - holeStrokesReceived(playsOff(INDEX, 18, allowance), si, 18) - PARS[h] === -1
            ? 2
            : -1),
      0,
    );
    expect(row.points).toBe(expected);
  });

  it("does not score it off the raw index", async () => {
    // The old behaviour, stated as a number so the test fails loudly if the
    // conversion is ever removed rather than quietly agreeing again.
    const rows = await modifiedStablefordBoard(eventId, modStageId, PARS, SI);
    const row = rows.find((r) => r.playerId === player.hooper)!;

    const rawIndexPoints = SI.reduce((sum, si, h) => {
      const net = 4 - holeStrokesReceived(Math.round(INDEX), si, 18) - PARS[h];
      return sum + (net === 0 ? 0 : net === -1 ? 2 : -1);
    }, 0);
    expect(row.points).not.toBe(rawIndexPoints);
  });
});

describe("a committee override reaches the boards", () => {
  it("is honoured, where it used to be ignored entirely", async () => {
    // `skinsBoard` never read roundHandicapRows, so an override applied to the
    // pot and not to the board that showed the field who was winning.
    await prisma.roundHandicap.deleteMany({ where: { eventId, stageId } });
    await prisma.roundHandicap.create({
      // Off scratch: the hooper should now get no strokes at all.
      data: { eventId, stageId, playerId: player.hooper, override: 0 },
    });

    const board = await skinsBoard(eventId, stageId, 18, true, SI);
    const hooper = board.outcome.standings.find((s) => s.playerId === player.hooper);
    expect(hooper?.holesWon ?? []).not.toContain(14);

    await prisma.roundHandicap.deleteMany({ where: { eventId, stageId } });
  });
});
