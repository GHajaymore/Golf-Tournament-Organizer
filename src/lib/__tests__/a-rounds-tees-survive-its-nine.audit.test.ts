import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A ROUND'S TEES SURVIVE ITS NINE (QA Director, item 1, 14 Nov) — the mirror of
 * `a-rounds-nine-survives-its-tees.audit.test.ts`, which proved the nine
 * survives the tees and never asked whether the tees survive the nine.
 *
 * The organizer picks a nine-hole round's tees on Score entry (`setStageCourse`
 * with the course and the set). Then, on Rounds & formats, they choose **Which
 * nine**, and the screen calls `setStageCourse(stageId, course, "back")` — the
 * course and the nine, no tees. The action defaulted the tees to null and wrote
 * them every time, so the course had not changed and the tees were gone: the
 * round fell back to the tournament's set, every card in the field priced off
 * the wrong rating, and once the first card was in the rounds rule froze the
 * wrong tees in.
 *
 * WORKED FROM THE RULES OF HANDICAPPING (Rule 6.1b, a nine-hole Course
 * Handicap: half the Handicap Index × Slope ÷ 113 + (nine-hole Course Rating −
 * nine-hole par)), in WHOLE NUMBERS — an index in tenths, a rating in tenths,
 * everything over 2260 — so it shares neither formula nor floating point with
 * `domain/handicap.ts`. The app holds an eighteen's rating and takes half of it
 * for either nine (`nineHoleTee`), so a nine's rating is half the set's:
 *
 *   Blue  73.4 / 135 / 72  →  a nine 36.7 / 135 / 36   (the round's, set on Score entry)
 *   White 71.2 / 126 / 72  →  a nine 35.6 / 126 / 36   (the tournament's)
 *   Red   69.0 / 118 / 72  →  a nine 34.5 / 118 / 36   (one flight's)
 *
 *   A, index 18.4, on the round's Blue: 9.2 × 135/113 + 0.7 = 11.69 → 12 (White: 9.86 → 10)
 *   B, index  6.0, on the round's Blue: 3.0 × 135/113 + 0.7 =  4.28 →  4 (White: 2.95 →  3)
 *   C, index 24.0, in the Red flight:  12.0 × 118/113 − 1.5 = 11.03 → 11
 *   D, index 12.0, moved to White:      6.0 × 126/113 − 0.4 =  6.29 →  6
 *
 * Before the fix the nine took A to 10 and B to 3 — two shots and one — while
 * C and D, whose tees live on their flight and their own row, did not move.
 * All three of the organizer's levels resolve through `teeIdFor` in
 * `courseHandicapMap`; this reads them through `loadEventState`, the board's
 * reader.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-TEESKEPT";
const EMAIL = `${TAG}.staff@example.invalid`.toLowerCase();
const session = { email: EMAIL, name: `${TAG} staff`, eventId: "", role: "assistant" };
vi.mock("@/lib/auth", () => ({ getSession: async () => session, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { setStageCourse, setEventCourses } = await import("@/app/actions/courses");
const { loadEventState } = await import("@/lib/services/tournament");

const eighteen = (n: number) => JSON.stringify(Array.from({ length: 18 }, () => n));

/** The sets, in tenths of a stroke — the units the worked figures use. */
const SETS = {
  Blue: { rating10: 734, slope: 135, par: 72 },
  White: { rating10: 712, slope: 126, par: 72 },
  Red: { rating10: 690, slope: 118, par: 72 },
} as const;
type SetName = keyof typeof SETS;

/**
 * Rule 6.1b over nine holes, in 2260ths of a stroke: (index10 / 20) × slope / 113
 * + (rating10 / 20 − par / 2), times 2260, is index10 × slope + (rating10 − 10 × par) × 113.
 */
const nineCH2260 = (index10: number, set: SetName) => {
  const s = SETS[set];
  return index10 * s.slope + (s.rating10 - 10 * s.par) * 113;
};
/** Rounded once, a half upward (Rule 6.1), on whole numbers. */
const halfUp = (num: number, den: number) => Math.floor((2 * num + den) / (2 * den));

const PLAYERS = [
  { key: "A", index10: 184, on: "Blue" as SetName, wouldBe: "White" as SetName },
  { key: "B", index10: 60, on: "Blue" as SetName, wouldBe: "White" as SetName },
  { key: "C", index10: 240, on: "Red" as SetName, wouldBe: "Red" as SetName },
  { key: "D", index10: 120, on: "White" as SetName, wouldBe: "White" as SetName },
];

let eventId = "";
let stageId = "";
let homeId = "";
let awayId = "";
const tee: Record<string, string> = {};
const player: Record<string, string> = {};

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.course.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await scrub();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  const course = (name: string) =>
    prisma.course.create({
      data: {
        organizationId: org.id,
        name: `${TAG} ${name}`,
        city: "",
        pars: eighteen(4),
        yards: eighteen(380),
        strokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      },
    });
  homeId = (await course("home")).id;
  awayId = (await course("away")).id;
  for (const [position, name] of (["Blue", "White", "Red"] as const).entries()) {
    const s = SETS[name];
    tee[name] = (
      await prisma.tee.create({
        data: { courseId: homeId, name, courseRating: s.rating10 / 10, slopeRating: s.slope, par: s.par, position },
      })
    ).id;
  }
  await prisma.tee.create({ data: { courseId: awayId, name: "Gold", courseRating: 70.1, slopeRating: 120, par: 72 } });

  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} twilight nine`,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${process.pid}`,
      courseId: homeId,
      // The tournament's level: White. A flight or a player may differ.
      defaultTeeId: tee.White,
      teePolicy: "own",
    },
  });
  eventId = event.id;
  session.eventId = eventId;
  await prisma.eventCourse.create({ data: { eventId, courseId: homeId } });
  await prisma.account.create({ data: { eventId, email: EMAIL, name: `${TAG} staff`, role: "assistant" } });

  // The flight's level: Red.
  const flight = await prisma.group.create({ data: { eventId, name: `${TAG} flight`, position: 0, teeId: tee.Red } });
  for (const [i, p] of PLAYERS.entries()) {
    player[p.key] = (
      await prisma.player.create({
        data: {
          eventId,
          name: `${TAG} ${p.key}`,
          email: `${TAG}.${p.key}@example.invalid`.toLowerCase(),
          seed: i + 1,
          status: "confirmed",
          handicap: p.index10 / 10,
          // C in the Red flight; D moved to White by the organizer (the player's level).
          groupId: p.key === "C" ? flight.id : null,
          teeId: p.key === "D" ? tee.White : null,
        },
      })
    ).id;
  }

  stageId = (
    await prisma.stage.create({
      data: { eventId, position: 0, type: "Stroke Play Round", format: "Stableford", holes: 9, nine: "front", courseId: homeId },
    })
  ).id;
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

const round = async () => prisma.stage.findUnique({ where: { id: stageId }, select: { nine: true, teeId: true, courseId: true } });

/** Each player's whole Course Handicap and playing handicap, as the board prices the round. */
async function priced() {
  const state = await loadEventState(eventId);
  return Object.fromEntries(
    PLAYERS.map((p) => {
      const parts = state!.strokeHandicapPartsFor(player[p.key], stageId);
      return [p.key, { course: Math.round(parts.courseExact + 1e-9), playing: parts.playing }];
    }),
  );
}

/** What the Rules say, from the set each player SHOULD be on: Stableford is 95% (Appendix C). */
const byTheRules = (set: (p: (typeof PLAYERS)[number]) => SetName) =>
  Object.fromEntries(
    PLAYERS.map((p) => {
      const ch = nineCH2260(p.index10, set(p));
      return [p.key, { course: halfUp(ch, 2260), playing: halfUp(ch * 95, 2260 * 100) }];
    }),
  );

describe("choosing Which nine keeps the round's tees, at all three of the organizer's levels", () => {
  it("the worked figures, by hand: 12, 4, 11, 6 off the committee's tees; 10 and 3 off the tournament's", () => {
    // The constant-offset check: one row whole against the Rule, so the sweep
    // below cannot pass on the helper agreeing with itself.
    expect(byTheRules((p) => p.on)).toEqual({
      A: { course: 12, playing: 11 },
      B: { course: 4, playing: 4 },
      C: { course: 11, playing: 10 },
      D: { course: 6, playing: 6 },
    });
    expect(byTheRules((p) => p.wouldBe)).toMatchObject({ A: { course: 10 }, B: { course: 3 } });
  });

  it("Score entry sets the round's tees to Blue", async () => {
    const res = await setStageCourse(stageId, homeId, undefined, true, tee.Blue);
    expect(res).toEqual({ ok: true });
    expect(await round()).toEqual({ nine: "front", teeId: tee.Blue, courseId: homeId });
    expect(await priced()).toEqual(byTheRules((p) => p.on));
  });

  it("Rounds & formats, Which nine → Back: the round is still on Blue, and nobody's strokes move", async () => {
    // Exactly what `commitVenue` sends: the course it has, the nine, nothing else.
    const res = await setStageCourse(stageId, homeId, "back");
    expect(res).toEqual({ ok: true });
    expect(await round(), "Which nine wiped the round's tees").toEqual({ nine: "back", teeId: tee.Blue, courseId: homeId });
    // A plays off 12, not the tournament's 10; B off 4, not 3. C keeps the
    // flight's Red, D the White the organizer moved him to.
    expect(await priced()).toEqual(byTheRules((p) => p.on));
  });

  it("and back to the front: the same figures, since a nine is rated as half the set either way", async () => {
    expect(await setStageCourse(stageId, homeId, "front")).toEqual({ ok: true });
    expect((await round())?.teeId).toBe(tee.Blue);
    expect(await priced()).toEqual(byTheRules((p) => p.on));
  });

  it("restating the venue from Score entry, with no tees named, keeps them too", async () => {
    expect(await setStageCourse(stageId, homeId)).toEqual({ ok: true });
    expect((await round())?.teeId).toBe(tee.Blue);
  });

  it("Same as the tournament on Rounds & formats, where the tournament is at this course, keeps them too", async () => {
    // What Rounds & formats sends for "Same as the tournament": no course of its own, the nine.
    // The course PLAYED is unchanged (the tournament is at home), so the tees stay (Fable, #1159:
    // the stored column moved from home to null, and A went from 12 to 10).
    expect(await setStageCourse(stageId, null, "front")).toEqual({ ok: true });
    expect(await round()).toEqual({ nine: "front", teeId: tee.Blue, courseId: null });
    expect(await priced()).toEqual(byTheRules((p) => p.on));
    // And back to naming the course: still the same course, still Blue.
    expect(await setStageCourse(stageId, homeId, "front")).toEqual({ ok: true });
    expect((await round())?.teeId).toBe(tee.Blue);
  });

  it("CONTROL: choosing the tournament's tees on Score entry (null) still clears the round's", async () => {
    expect(await setStageCourse(stageId, homeId, undefined, true, null)).toEqual({ ok: true });
    expect((await round())?.teeId).toBeNull();
    // Now the round is on the tournament's White: A 10, B 3; C and D unmoved.
    expect(await priced()).toEqual(byTheRules((p) => p.wouldBe));
  });

  it("CONTROL: a move to another course still clears the tees, which belong to the old one", async () => {
    await setStageCourse(stageId, homeId, undefined, true, tee.Blue);
    expect(await setStageCourse(stageId, awayId, "front")).toEqual({ ok: true });
    expect(await round()).toEqual({ nine: "front", teeId: null, courseId: awayId });
  });

  it("CONTROL: a set from another course is still refused", async () => {
    const gold = await prisma.tee.findFirst({ where: { courseId: awayId }, select: { id: true } });
    expect(await setStageCourse(stageId, homeId, undefined, true, gold!.id)).toEqual({
      ok: false,
      error: "Those tees aren't on that course.",
    });
    expect((await round())?.courseId).toBe(awayId);
  });
});

describe("taking a course off the tournament takes its tees off the rounds and matches on it", () => {
  it("setEventCourses clears the round's and the match's set with their course", async () => {
    // Fixture, read back: the round and a match at the away course, both off its Gold.
    const gold = await prisma.tee.findFirstOrThrow({ where: { courseId: awayId }, select: { id: true } });
    await prisma.stage.update({ where: { id: stageId }, data: { courseId: awayId, teeId: gold.id } });
    const flight = await prisma.group.findFirstOrThrow({ where: { eventId }, select: { id: true } });
    const match = await prisma.match.create({
      data: { eventId, stageId, groupId: flight.id, round: 1, playerAId: player.A, playerBId: player.B, holes: "[]", courseId: awayId, teeId: gold.id },
    });
    expect(await prisma.eventCourse.count({ where: { eventId, courseId: awayId } }), "the away course is not a venue").toBe(1);
    session.role = "admin";
    try {
      expect(await setEventCourses([homeId])).toEqual({ ok: true });
    } finally {
      session.role = "assistant";
    }
    expect(await round(), "the round kept a set from the course taken off").toMatchObject({ courseId: null, teeId: null });
    expect(await prisma.match.findUniqueOrThrow({ where: { id: match.id }, select: { courseId: true, teeId: true } }), "the match kept a set from the course taken off").toEqual({
      courseId: null,
      teeId: null,
    });
  });
});
