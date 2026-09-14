import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadEventState } from "../services/tournament";
import { playingHandicapFrom } from "../domain/handicap";

/**
 * A TOURNAMENT PLAYED OVER TWO CLUBS IS SCORED OFF EACH CLUB'S OWN TEES.
 *
 * The COURSE has walked match -> round -> event since the venue library was
 * built; the tees had no such chain. They were a single `Event.defaultTeeId`
 * with a flight and a player layered over it, and `roundTeeId` filled the gap
 * with the first tee by POSITION — across every venue, because `teesForEvent`
 * gathers them course by course.
 *
 * So a two-day member-guest at two clubs scored day two off day ONE's slope
 * and course rating. A real number, from the wrong course, and until #348 the
 * card did not even name the set it claimed to use.
 *
 * Asserted against real rows because that is the only place it is provable:
 * `teesForEvent`'s ordering, `Stage.courseId`, and the resolution in
 * `loadEventState` are three separate pieces and the bug lived between them.
 *
 * The two venues are rated far enough apart that one stroke cannot be a
 * rounding accident — and the test asserts they differ before asserting
 * anything else, so a fixture that accidentally converged could not pass
 * vacuously.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-TWOVENUE";

let eventId = "";
let dayOneId = "";
let dayTwoId = "";
let playerId = "";

const PARS = new Array(18).fill(4);
const SI = Array.from({ length: 18 }, (_, i) => i + 1);

/** The host club, whose tees sort FIRST and used to price both rounds. */
const HOST = { courseRating: 74.9, slopeRating: 144, par: 72 };
/** The away club, a far gentler course. */
const AWAY = { courseRating: 68.2, slopeRating: 105, par: 72 };

const INDEX = 12;

/** WHS: Course Handicap = Index x Slope/113 + (CR - par), rounded. */
const playsOff = (t: { courseRating: number; slopeRating: number; par: number }) =>
  Math.round(INDEX * (t.slopeRating / 113) + (t.courseRating - t.par));

/** Stroke Play's 95% is already applied by `strokeHandicapFor`. */
const playing = (t: { courseRating: number; slopeRating: number; par: number }) =>
  playingHandicapFrom(playsOff(t), 95);

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.course.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} society`, kind: "club" } });

  const card = {
    pars: JSON.stringify(PARS),
    yards: JSON.stringify(new Array(18).fill(400)),
    strokeIndex: JSON.stringify(SI),
  };
  const [host, away] = await Promise.all([
    prisma.course.create({ data: { organizationId: org.id, name: `${TAG} host`, city: "", ...card } }),
    prisma.course.create({ data: { organizationId: org.id, name: `${TAG} away`, city: "", ...card } }),
  ]);

  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} member-guest`,
      dates: "",
      course: `${TAG} host`,
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${process.pid}`,
      customPars: JSON.stringify(PARS),
      customYards: JSON.stringify(new Array(18).fill(400)),
      customStrokeIndex: JSON.stringify(SI),
      courseId: host.id,
      /**
       * NOTHING CONFIGURED, deliberately — `defaultTeeId` stays null. This is
       * the case the bug lived in and the commonest state there is: a club
       * that never opened the tee setting. The fallback is then the only rule
       * deciding how the whole field is priced.
       */
    },
  });
  eventId = event.id;
  await prisma.eventCourse.createMany({
    data: [
      { eventId, courseId: host.id },
      { eventId, courseId: away.id },
    ],
  });

  /**
   * Position 0 on BOTH courses. That is the point: `teesForEvent` orders by
   * course and then position, so the host's set sorts first overall and used
   * to win for every round regardless of where it was played.
   */
  await Promise.all([
    prisma.tee.create({ data: { courseId: host.id, name: `${TAG} host white`, ...HOST, position: 0 } }),
    prisma.tee.create({ data: { courseId: away.id, name: `${TAG} away white`, ...AWAY, position: 0 } }),
  ]);

  const [d1, d2] = await Promise.all([
    prisma.stage.create({
      data: { eventId, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18, courseId: host.id },
    }),
    prisma.stage.create({
      // Day two is AT THE AWAY CLUB, which the round has always been able to say.
      data: { eventId, position: 1, type: "Stroke Play Round", format: "Stroke Play", holes: 18, courseId: away.id },
    }),
  ]);
  dayOneId = d1.id;
  dayTwoId = d2.id;

  const p = await prisma.player.create({
    data: {
      eventId,
      name: `${TAG} golfer`,
      email: `${TAG}.golfer@example.invalid`.toLowerCase(),
      seed: 1,
      status: "confirmed",
      handicap: INDEX,
    },
  });
  playerId = p.id;
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("the two venues really are different", () => {
  it("separates them by more than a rounding accident", () => {
    // Without this every assertion below could pass on a fixture whose two
    // courses happen to price the same index identically.
    expect(playsOff(HOST)).toBeGreaterThan(playsOff(AWAY) + 5);
  });
});

describe("a round is priced off the tees of the course it is played on", () => {
  it("prices day one off the host club", async () => {
    const state = await loadEventState(eventId);
    expect(state).not.toBeNull();
    expect(state!.strokeHandicapFor(playerId, dayOneId)).toBe(playing(HOST));
  });

  it("prices day two off the AWAY club, not the host's", async () => {
    /**
     * THE DEFECT, STATED AS A NUMBER. Before `teeForPlay` this returned
     * `playing(HOST)` — the host's 144 slope and 74.9 rating applied to a
     * round played at a course rated 105 and 68.2. Measured by reverting the
     * fix against this fixture: **17 strokes where 7 is right**, on a card
     * that named no tee at all.
     */
    const state = await loadEventState(eventId);
    expect(state!.strokeHandicapFor(playerId, dayTwoId)).toBe(playing(AWAY));
  });

  it("gives the two rounds different numbers, which is the whole point", async () => {
    // Asserted separately from the values: if a later change made both rounds
    // resolve the same way again, the two tests above could both be updated to
    // match and this one would still say the tournament had stopped
    // distinguishing its venues.
    const state = await loadEventState(eventId);
    expect(state!.strokeHandicapFor(playerId, dayOneId)).not.toBe(
      state!.strokeHandicapFor(playerId, dayTwoId),
    );
  });

  it("lets a round name its own set, overriding the course's first", async () => {
    /**
     * `Stage.teeId` — the round's own answer, which is what a medal off the
     * whites needs when the club's first set is the blues. Set here rather
     * than in the fixture so the tests above prove the FALLBACK on its own.
     */
    const back = await prisma.tee.create({
      data: {
        courseId: (await prisma.stage.findUnique({ where: { id: dayTwoId }, select: { courseId: true } }))!
          .courseId!,
        name: `${TAG} away back`,
        ...HOST,
        position: 9,
      },
    });
    await prisma.stage.update({ where: { id: dayTwoId }, data: { teeId: back.id } });
    try {
      const state = await loadEventState(eventId);
      expect(state!.strokeHandicapFor(playerId, dayTwoId)).toBe(playing(HOST));
    } finally {
      await prisma.stage.update({ where: { id: dayTwoId }, data: { teeId: null } });
      await prisma.tee.delete({ where: { id: back.id } });
    }
  });
});
