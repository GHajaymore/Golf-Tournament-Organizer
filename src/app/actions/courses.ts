"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { settingsOf } from "@/lib/services/tournament";
import { canEnterScores } from "@/lib/tournament-settings";
import { COURSES } from "@/lib/courses";
import { MIN_SLOPE, MAX_SLOPE } from "@/lib/domain/handicap";

/**
 * The club's course library, and which venue a round or match was played on.
 *
 * Courses belong to the organization so a venue survives the tournament it
 * was first entered for. Assigning one to a round or a match is how a
 * rotating or venue-less event says where play actually happened.
 */

export interface CourseResult {
  ok: boolean;
  error?: string;
  courseId?: string;
}

const NINES = ["full", "front", "back"] as const;
const cleanNine = (n: string) => (NINES.includes(n as (typeof NINES)[number]) ? n : "full");

function refresh() {
  revalidatePath("/", "layout");
}

/** Organizer of the open tournament, plus the club that owns it. */
async function requireOrganizerOrg(): Promise<{ organizationId: string; eventId: string }> {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  if (session.role !== "admin") throw new Error("Organizer access required");
  const event = await prisma.event.findUnique({
    where: { id: session.eventId },
    select: { organizationId: true },
  });
  if (!event) throw new Error("Event not found");
  return { organizationId: event.organizationId, eventId: session.eventId };
}

/** Eighteen numbers, as the schema stores them. */
function holeArray(values: number[], fallback: number): string {
  const out = Array.from({ length: 18 }, (_, i) => {
    const v = values[i];
    return Number.isFinite(v) && v > 0 ? Math.round(v) : fallback;
  });
  return JSON.stringify(out);
}

/**
 * Stroke index must be a permutation of 1–18.
 *
 * Handicap allocation walks the indexes in order to decide which holes a
 * player receives shots on, so a duplicate or a gap doesn't degrade the
 * result — it silently allocates the wrong shots on the wrong holes and
 * every net match on the course is quietly wrong. Worth rejecting rather
 * than papering over.
 */
function strokeIndexProblem(values: number[]): string | null {
  const filled = values.filter((v) => Number.isFinite(v) && v > 0);
  if (filled.length === 0) return null; // untouched — we'll default it

  if (filled.length < 18) return "Fill in all 18 stroke indexes, or leave them all blank.";
  const sorted = [...values].map((v) => Math.round(v)).sort((a, b) => a - b);
  const expected = Array.from({ length: 18 }, (_, i) => i + 1);
  if (sorted.some((v, i) => v !== expected[i])) {
    return "Stroke indexes must use each number 1–18 exactly once.";
  }
  return null;
}

export interface ClubCourseInput {
  id?: string;
  name: string;
  city?: string;
  pars: number[];
  yards: number[];
  strokeIndex: number[];
}

/**
 * Add or update a course in the club library.
 *
 * Always eighteen holes, even for a nine-hole venue — a nine is selected at
 * play time from a full card, so storing halves would make "back nine"
 * meaningless and force the same course to be entered twice.
 */
export async function saveClubCourse(input: ClubCourseInput): Promise<CourseResult> {
  const { organizationId } = await requireOrganizerOrg();
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Enter a course name." };

  const siProblem = strokeIndexProblem(input.strokeIndex);
  if (siProblem) return { ok: false, error: siProblem };

  const siGiven = input.strokeIndex.some((v) => Number.isFinite(v) && v > 0);
  const data = {
    name,
    city: (input.city ?? "").trim(),
    pars: holeArray(input.pars, 4),
    yards: holeArray(input.yards, 400),
    // Left blank entirely, default to 1–18 in hole order: a placeholder that
    // is at least a valid permutation, so net scoring stays coherent until
    // the organizer enters the real card.
    strokeIndex: siGiven
      ? holeArray(input.strokeIndex, 18)
      : JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
  };

  if (input.id) {
    const existing = await prisma.course.findFirst({ where: { id: input.id, organizationId } });
    if (!existing) return { ok: false, error: "Course not found." };
    await prisma.course.update({ where: { id: input.id }, data });
    refresh();
    return { ok: true, courseId: input.id };
  }

  const created = await prisma.course.create({ data: { ...data, organizationId } });
  refresh();
  return { ok: true, courseId: created.id };
}

/**
 * Remove a course from the library.
 *
 * Rounds and matches played on it keep their results and fall back to the
 * event's course — the foreign keys are SET NULL precisely so deleting a
 * venue can never delete a tournament's history.
 */
export async function deleteClubCourse(courseId: string): Promise<CourseResult> {
  const { organizationId } = await requireOrganizerOrg();
  const course = await prisma.course.findFirst({ where: { id: courseId, organizationId } });
  if (!course) return { ok: false, error: "Course not found." };
  await prisma.course.delete({ where: { id: courseId } });
  refresh();
  return { ok: true };
}

/** Copy a built-in preset into the club library so it can be assigned. */
export async function addPresetCourse(presetName: string): Promise<CourseResult> {
  const { organizationId } = await requireOrganizerOrg();
  const preset = COURSES.find((c) => c.name === presetName);
  if (!preset) return { ok: false, error: "Unknown course." };

  const already = await prisma.course.findFirst({ where: { organizationId, name: preset.name } });
  if (already) return { ok: true, courseId: already.id };

  const created = await prisma.course.create({
    data: {
      organizationId,
      name: preset.name,
      city: preset.city,
      pars: JSON.stringify(preset.pars),
      yards: JSON.stringify(preset.yards),
      strokeIndex: JSON.stringify(preset.strokeIndex),
    },
  });
  refresh();
  return { ok: true, courseId: created.id };
}

/**
 * Set the club's own course.
 *
 * Every tournament the club creates afterwards starts there, so the venue
 * question disappears for the case where it has one obvious answer. Existing
 * tournaments are deliberately untouched — same rule as the house play
 * settings: changing a default must never rewrite an event already running.
 */
export async function setHomeCourse(courseId: string | null): Promise<CourseResult> {
  const { organizationId } = await requireOrganizerOrg();

  if (courseId) {
    const owned = await prisma.course.findFirst({ where: { id: courseId, organizationId } });
    if (!owned) return { ok: false, error: "Course not found." };
  }

  await prisma.organization.update({
    where: { id: organizationId },
    data: { defaultCourseId: courseId },
  });
  refresh();
  return { ok: true };
}

/**
 * Set which courses this tournament may be played on.
 *
 * One is the ordinary case and turns every picker off. More than one turns
 * them on: a per-round venue for a rotating event, a per-match one where
 * opponents choose their own.
 */
export async function setEventCourses(courseIds: string[]): Promise<CourseResult> {
  const { organizationId, eventId } = await requireOrganizerOrg();

  const valid = await prisma.course.findMany({
    where: { id: { in: courseIds }, organizationId },
    select: { id: true },
  });
  const keep = new Set(valid.map((c) => c.id));

  await prisma.$transaction(async (tx) => {
    // Rounds and matches pointing at a course that's no longer on the event
    // fall back to inheriting rather than keeping a venue the organizer just
    // said isn't in use.
    await tx.stage.updateMany({
      where: { eventId, courseId: { notIn: [...keep] } },
      data: { courseId: null },
    });
    await tx.match.updateMany({
      where: { eventId, courseId: { notIn: [...keep] } },
      data: { courseId: null },
    });
    await tx.eventCourse.deleteMany({ where: { eventId, courseId: { notIn: [...keep] } } });
    for (const id of keep) {
      await tx.eventCourse.upsert({
        where: { eventId_courseId: { eventId, courseId: id } },
        update: {},
        create: { eventId, courseId: id },
      });
    }
  });

  refresh();
  return { ok: true };
}

/** Assign the venue for one round — the multi-day/multi-week case. */
export async function setStageCourse(
  stageId: string,
  courseId: string | null,
  nine = "full",
): Promise<CourseResult> {
  const { eventId } = await requireOrganizerOrg();
  const stage = await prisma.stage.findFirst({ where: { id: stageId, eventId } });
  if (!stage) return { ok: false, error: "Round not found." };

  if (courseId) {
    const allowed = await prisma.eventCourse.findFirst({ where: { eventId, courseId } });
    if (!allowed) return { ok: false, error: "That course isn't one of this tournament's venues." };
  }

  await prisma.stage.update({
    where: { id: stageId },
    data: { courseId, nine: cleanNine(nine) },
  });
  refresh();
  return { ok: true };
}

/**
 * Record where one match was played.
 *
 * Open to whoever may enter scores for this tournament, because in a league
 * with no fixed venue the player reporting the result is the only one who
 * knows — but staff can always set it too, including to correct a pairing
 * that moved at short notice.
 */
export async function setMatchCourse(
  matchId: string,
  courseId: string | null,
  nine = "full",
): Promise<CourseResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not authenticated" };

  const [event, match] = await Promise.all([
    prisma.event.findUnique({ where: { id: session.eventId } }),
    prisma.match.findUnique({ where: { id: matchId } }),
  ]);
  if (!event || !match || match.eventId !== session.eventId) {
    return { ok: false, error: "Match not found." };
  }
  if (!canEnterScores(settingsOf(event), session.role)) {
    return { ok: false, error: "Scores for this tournament are entered by the organizer." };
  }

  if (courseId) {
    const allowed = await prisma.eventCourse.findFirst({ where: { eventId: session.eventId, courseId } });
    if (!allowed) return { ok: false, error: "That course isn't one of this tournament's venues." };
  }

  await prisma.match.update({
    where: { id: matchId },
    data: { courseId, nine: cleanNine(nine) },
  });
  refresh();
  return { ok: true };
}

/* ── Tees, and the ratings that make a handicap mean something ──────────── */

export interface TeeInput {
  name: string;
  gender: string;
  courseRating: number;
  slopeRating: number;
  par: number;
}

const GENDERS = ["any", "men", "women"] as const;
const cleanGender = (g: string) => (GENDERS.includes(g as (typeof GENDERS)[number]) ? g : "any");

/**
 * Validate a set of tees.
 *
 * Slope and rating decide how many strokes every player in the field
 * receives, so a typo here is not cosmetic — it silently rewrites every net
 * result. Zero is allowed and means "not rated yet", which the conversion
 * reads as a signal to fall back to the raw index rather than as a slope of
 * zero.
 */
function teeProblem(input: TeeInput): string | null {
  if (!input.name.trim()) return "Give the tees a name — Blue, White, Red.";
  if (input.slopeRating !== 0 && (input.slopeRating < MIN_SLOPE || input.slopeRating > MAX_SLOPE)) {
    return `Slope Rating is between ${MIN_SLOPE} and ${MAX_SLOPE} (113 is standard). Leave it at 0 if you don't have it yet.`;
  }
  if (input.courseRating !== 0 && (input.courseRating < 55 || input.courseRating > 90)) {
    return "Course Rating is the strokes a scratch golfer is expected to take — usually within a few of par.";
  }
  if (input.par < 27 || input.par > 80) return "Par should be a real par for the holes played.";
  if (input.courseRating !== 0 && input.slopeRating === 0) {
    return "A Course Rating without a Slope Rating can't be used. Enter both, or neither.";
  }
  return null;
}

export async function saveTee(courseId: string, input: TeeInput, teeId?: string): Promise<CourseResult> {
  const { organizationId } = await requireOrganizerOrg();
  const course = await prisma.course.findFirst({ where: { id: courseId, organizationId } });
  if (!course) return { ok: false, error: "Course not found." };

  const problem = teeProblem(input);
  if (problem) return { ok: false, error: problem };

  const data = {
    name: input.name.trim(),
    gender: cleanGender(input.gender),
    courseRating: Number.isFinite(input.courseRating) ? input.courseRating : 0,
    slopeRating: Number.isFinite(input.slopeRating) ? Math.round(input.slopeRating) : 0,
    par: Math.round(input.par),
  };

  if (teeId) {
    const existing = await prisma.tee.findFirst({ where: { id: teeId, courseId } });
    if (!existing) return { ok: false, error: "Tees not found." };
    await prisma.tee.update({ where: { id: teeId }, data });
  } else {
    const max = await prisma.tee.aggregate({ where: { courseId }, _max: { position: true } });
    await prisma.tee.create({
      data: { ...data, courseId, position: (max._max.position ?? -1) + 1 },
    });
  }
  refresh();
  return { ok: true };
}

export async function deleteTee(teeId: string): Promise<CourseResult> {
  const { organizationId } = await requireOrganizerOrg();
  const tee = await prisma.tee.findFirst({
    where: { id: teeId, course: { organizationId } },
  });
  if (!tee) return { ok: false, error: "Tees not found." };
  // Players keep their entry; the foreign key nulls their teeId rather than
  // deleting anyone who played off these tees.
  await prisma.tee.delete({ where: { id: teeId } });
  refresh();
  return { ok: true };
}

/** Put a player on a set of tees, which decides the strokes they receive. */
export async function setPlayerTee(playerId: string, teeId: string | null): Promise<CourseResult> {
  const { eventId } = await requireOrganizerOrg();
  const player = await prisma.player.findFirst({ where: { id: playerId, eventId } });
  if (!player) return { ok: false, error: "Player not found." };
  if (teeId) {
    const tee = await prisma.tee.findFirst({
      where: { id: teeId, course: { events: { some: { eventId } } } },
    });
    if (!tee) return { ok: false, error: "Those tees aren't on this tournament's course." };
  }
  await prisma.player.update({ where: { id: playerId }, data: { teeId } });
  refresh();
  return { ok: true };
}
