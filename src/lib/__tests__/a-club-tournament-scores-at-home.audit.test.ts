import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

let session: { email: string; name: string; eventId: string; role: string; viewRole: string } | null = null;
vi.mock("@/lib/auth", () => ({ getSession: async () => session, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { createEvent } = await import("@/app/actions/tournament");
const { loadEventState } = await import("@/lib/services/tournament");
const { COURSE_REF, courseForRound } = await import("@/lib/services/course-resolution");
const { resolveCourse } = await import("@/lib/courses");

/**
 * A CLUB'S NEW TOURNAMENT IS SCORED AGAINST ITS HOME COURSE, ON EVERY SCREEN.
 *
 * Found 2026-09-26 running a club Scramble from scratch as a newcomer. Both
 * sides' cards were entered and Score entry showed "62 gross · 50 net", the
 * dashboard said "Sides in 2/2 · 100% returned" — and the Live leaderboard,
 * Reports and the public board showed both sides on 0 holes, no score.
 *
 * `createEvent` starts a club's tournament at its home course by linking it as
 * a VENUE, and never set `Event.courseId`. Score entry reads a sole venue as
 * the tournament's course, so the cards went in against the right card; every
 * other reader resolves through `COURSE_REF` → `courseRef`, found nothing, and
 * scored against an empty card — every hole skipped.
 *
 * Two halves, both asserted against real rows: a new tournament is created
 * carrying its course, and one created before that still reads its card.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-HOMECARD";
const EMAIL = `${TAG}-secretary@example.invalid`.toLowerCase();

// Two cards a wrong answer cannot be mistaken for: the home course's pars
// vary, the away course is par 4 on every hole.
const HOME_PARS = [4, 5, 3, 4, 4, 4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 3, 4, 4];
const AWAY_PARS = new Array(18).fill(4);
const card = (pars: number[]) => ({
  pars: JSON.stringify(pars),
  yards: JSON.stringify(new Array(18).fill(380)),
  strokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
});

let organizationId = "";
let homeId = "";
let awayId = "";

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: EMAIL } });
}

beforeAll(async () => {
  await scrub();
  const user = await prisma.user.create({ data: { email: EMAIL, name: `${TAG} secretary` }, select: { id: true } });
  const org = await prisma.organization.create({
    data: { name: `${TAG} Golf Club`, kind: "club" },
    select: { id: true },
  });
  organizationId = org.id;
  await prisma.organizationMember.create({ data: { organizationId, userId: user.id, role: "owner" } });
  // A club that has done its setup — `club-first.audit.test.ts` owns that gate.
  await prisma.member.create({
    data: { organizationId, name: `${TAG} Member`, email: `${TAG}-member@example.invalid`.toLowerCase() },
  });
  const [home, away] = await Promise.all([
    prisma.course.create({ data: { organizationId, name: `${TAG} home`, city: "Hometown", ...card(HOME_PARS) } }),
    prisma.course.create({ data: { organizationId, name: `${TAG} away`, city: "", ...card(AWAY_PARS) } }),
  ]);
  homeId = home.id;
  awayId = away.id;
  await prisma.organization.update({ where: { id: organizationId }, data: { defaultCourseId: homeId } });
  session = { email: EMAIL, name: `${TAG} secretary`, eventId: "", role: "admin", viewRole: "admin" };
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

/** A bare tournament in this club, with one scramble round, linked as given. */
async function tournament(name: string, opts: { courseId?: string; venues: string[] }) {
  const event = await prisma.event.create({
    data: {
      organizationId,
      name: `${TAG} ${name}`,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${name}-${process.pid}`,
      courseId: opts.courseId ?? null,
    },
  });
  for (const courseId of opts.venues) {
    await prisma.eventCourse.create({ data: { eventId: event.id, courseId } });
  }
  const stage = await prisma.stage.create({
    data: { eventId: event.id, position: 0, type: "Stroke Play Round", format: "Scramble", holes: 18 },
  });
  return { eventId: event.id, stageId: stage.id };
}

/** The card every board, the public page and Reports score this round on. */
async function boardPars(eventId: string, stageId: string) {
  const state = await loadEventState(eventId);
  return state!.strokeCourseFor(stageId).pars;
}

/** The same question asked the way the self-loading readers ask it. */
async function readerPars(eventId: string) {
  const event = await prisma.event.findUnique({ where: { id: eventId }, include: COURSE_REF });
  return { round: courseForRound(null, event!)?.pars ?? [], event: resolveCourse(event!).pars };
}

describe("a tournament created at a club", () => {
  it("carries the home course as its own course, not only as a venue", async () => {
    const res = await createEvent(`${TAG} spring medal`, "custom", "single", undefined, organizationId);
    expect(res.ok, res.ok ? "" : res.error).toBe(true);
    const event = await prisma.event.findFirst({
      where: { name: `${TAG} spring medal` },
      select: { courseId: true, course: true, city: true, courses: { select: { courseId: true } } },
    });
    expect(event?.courses.map((c) => c.courseId), "the home course is a venue").toEqual([homeId]);
    // The shape `saveEvent` writes when the course is picked on Tournament
    // details — the id, and the name and city beside it.
    expect(event?.courseId, "Event.courseId was left empty").toBe(homeId);
    expect(event?.course).toBe(`${TAG} home`);
    expect(event?.city).toBe("Hometown");
  });
});

describe("a tournament created before that, holding the venue alone", () => {
  it("is the broken shape — a venue and no courseId", async () => {
    // Without this the next test could pass on a tournament that happens to
    // carry its course, proving nothing about the case it exists for.
    const { eventId } = await tournament("legacy shape", { venues: [homeId] });
    const row = await prisma.event.findUnique({ where: { id: eventId }, select: { courseId: true } });
    expect(row?.courseId).toBeNull();
  });

  it("scores its round on the home card, on the board and in every reader", async () => {
    const { eventId, stageId } = await tournament("legacy", { venues: [homeId] });
    expect(await boardPars(eventId, stageId), "the board scored against an empty card").toEqual(HOME_PARS);
    const readers = await readerPars(eventId);
    expect(readers.round, "courseForRound found no card").toEqual(HOME_PARS);
    expect(readers.event, "resolveCourse found no card").toEqual(HOME_PARS);
  });
});

describe("what the fallback must not do", () => {
  it("never overrides the course the tournament names", async () => {
    // A `courseRef` wins, as it always has: the fallback only answers where
    // the answer was "no card at all", so nothing that resolves today moves.
    const { eventId, stageId } = await tournament("named away", { courseId: awayId, venues: [homeId] });
    expect(await boardPars(eventId, stageId)).toEqual(AWAY_PARS);
    const readers = await readerPars(eventId);
    expect(readers.round).toEqual(AWAY_PARS);
    expect(readers.event).toEqual(AWAY_PARS);
  });

  it("never guesses between two venues", async () => {
    // Which of two courses the tournament "is" is a real question, and the
    // round is where it gets answered — not here.
    const { eventId, stageId } = await tournament("two venues", { venues: [homeId, awayId] });
    expect(await boardPars(eventId, stageId)).toEqual([]);
    const readers = await readerPars(eventId);
    expect(readers.round).toEqual([]);
    expect(readers.event).toEqual([]);
  });
});
