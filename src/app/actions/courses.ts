"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { settingsOf } from "@/lib/services/tournament";
import { canEnterScores } from "@/lib/tournament-settings";
import { playsInMatch } from "@/lib/services/match-access";
import { COURSES, parseHoleArray } from "@/lib/courses";
import { parseCard } from "@/lib/domain/scorecard-parse";
import { searchDirectory, fetchDirectoryCourse } from "@/lib/services/course-directory";
import {
  cardDifferences,
  directorySourceUrl,
  directoryIdFrom,
  type CardDifference,
  type DirectoryHit,
} from "@/lib/domain/course-directory";
import { MIN_SLOPE, MAX_SLOPE } from "@/lib/domain/handicap";
import { cardProblems, matchCourse, teeProblems } from "@/lib/domain/venue";

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
  // S5. This writes the same fields as nameMatchVenue and had none of its
  // checks: any signed-in player could repoint ANYBODY's match at another
  // course, which silently rescores it against a different par and stroke
  // index. The venue decides where the shots fall, so this is a score edit
  // wearing a dropdown.
  if (session.role === "player" && !(await playsInMatch(session.eventId, session.email, match))) {
    return { ok: false, error: "That isn't your match." };
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

/**
 * Confirm that a course card is right.
 *
 * Only meaningful for an imported card. A wrong par is obvious the first time
 * someone plays the hole; a wrong stroke index is invisible and quietly
 * allocates handicap shots to the wrong holes for the life of the course. So
 * an imported card is usable but flagged, and this is a person at the club
 * saying they have looked at it.
 */
export async function verifyCourseCard(courseId: string): Promise<CourseResult> {
  const { organizationId } = await requireOrganizerOrg();
  const course = await prisma.course.findFirst({ where: { id: courseId, organizationId } });
  if (!course) return { ok: false, error: "Course not found." };

  const session = await getSession();
  await prisma.course.update({
    where: { id: courseId },
    data: { verifiedAt: new Date(), verifiedBy: session?.name ?? "" },
  });
  refresh();
  return { ok: true };
}

/** Withdraw a confirmation — the card turned out to be wrong after all. */
export async function unverifyCourseCard(courseId: string): Promise<CourseResult> {
  const { organizationId } = await requireOrganizerOrg();
  const course = await prisma.course.findFirst({ where: { id: courseId, organizationId } });
  if (!course) return { ok: false, error: "Course not found." };
  await prisma.course.update({
    where: { id: courseId },
    data: { verifiedAt: null, verifiedBy: "" },
  });
  refresh();
  return { ok: true };
}

export interface CardImportResult extends CourseResult {
  /** What's wrong with the pasted card, so the screen can point at the holes. */
  problems?: Array<{ row: string; message: string; holes: number[] }>;
}

/**
 * Add a course from a pasted card.
 *
 * A club's own website almost always has the card as a table, and pasting the
 * three rows takes about twenty seconds — far less than typing fifty-four
 * numbers, and with no third-party data source to depend on.
 *
 * Refuses rather than saving a card that fails validation. That is the whole
 * point: a wrong par is obvious the first time someone plays the hole, but a
 * wrong stroke index is invisible and quietly allocates handicap shots to the
 * wrong holes for the life of the course. The stroke index is checkable — 1 to
 * 18, once each — so a shifted or misread row is caught here rather than
 * discovered in a protest.
 *
 * Saved as `imported` and unverified: usable, and flagged until someone at the
 * club confirms it against the real card.
 */
export async function importClubCourseCard(input: {
  name: string;
  city?: string;
  pars: string;
  yards?: string;
  strokeIndex: string;
  holes?: number;
  sourceUrl?: string;
}): Promise<CardImportResult> {
  const { organizationId } = await requireOrganizerOrg();
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Enter a course name." };

  const holes = input.holes === 9 ? 9 : 18;
  const card = parseCard(
    { pars: input.pars, yards: input.yards, strokeIndex: input.strokeIndex },
    holes,
  );

  if (!card.ok) {
    return {
      ok: false,
      error: "That card doesn't look right yet — check the rows below.",
      problems: card.problems,
    };
  }

  // A nine-hole card is stored as eighteen with the nine repeated, matching
  // how the rest of the app treats a nine-hole round: it slices the front or
  // back out of a full card rather than carrying a separate shape.
  const toEighteen = (v: number[]) => (holes === 9 ? [...v, ...v] : v);

  const created = await prisma.course.create({
    data: {
      organizationId,
      name,
      city: (input.city ?? "").trim(),
      pars: JSON.stringify(toEighteen(card.pars)),
      yards: JSON.stringify(card.yards.length ? toEighteen(card.yards) : new Array(18).fill(0)),
      strokeIndex: JSON.stringify(
        holes === 9 ? [...card.strokeIndex, ...card.strokeIndex.map((n) => n + 9)] : card.strokeIndex,
      ),
      source: "imported",
      sourceUrl: (input.sourceUrl ?? "").trim().slice(0, 500),
    },
  });

  refresh();
  return { ok: true, courseId: created.id };
}

/* ── Importing a course from the public directory ─────────────────────────── */

export interface DirectorySearchResult {
  ok: boolean;
  error?: string;
  hits?: DirectoryHit[];
}

/**
 * Search the public course directory.
 *
 * Read-only and organization-scoped only because everything on this screen is
 * — there is no row here to own. Coverage is US-only, so no results is an
 * ordinary answer rather than a failure, and the screen says which it was.
 */
export async function searchCourseDirectory(query: string): Promise<DirectorySearchResult> {
  await requireOrganizerOrg();
  const hits = await searchDirectory(query);
  return { ok: true, hits };
}

export interface DirectoryImportResult extends CourseResult {
  /** What came in, so the screen can say what still needs doing. */
  cardImported?: boolean;
  teeCount?: number;
  /** Why the card was refused, when it was. Not an error: the course is still
   *  worth having, and this is the club's next job rather than a failure. */
  cardProblem?: string;
}

/**
 * Add a course from the directory.
 *
 * The card is imported ONLY if it survives `cardFrom` — a directory assembled
 * from community mapping is right most of the time and confidently wrong the
 * rest, and the two look identical in JSON. Green Crest comes back with its
 * pars sorted longest-to-shortest: a valid stroke index, a par total matching
 * the course's own, and a hole order that is pure database artefact. Writing
 * that card would mis-score every hole on the course, invisibly.
 *
 * When the card is refused the course is still created, with its name, city
 * and rated tee sets — that is the tedious part, and the tees are the field
 * free sources usually drop entirely. The card is left at the app's
 * placeholder and the refusal is returned so the screen can say what is
 * missing and point at the paste box.
 *
 * Either way the row lands as `imported` and unverified. That state already
 * exists and already renders as untrusted; this adds no second flag.
 */
export async function importCourseFromDirectory(directoryId: string): Promise<DirectoryImportResult> {
  const { organizationId } = await requireOrganizerOrg();

  const course = await fetchDirectoryCourse(directoryId);
  if (!course) {
    return {
      ok: false,
      error: "The course directory didn't answer. Try again, or paste the card in below.",
    };
  }

  // Adding the same course twice would leave the club choosing between two
  // identical venues with no way to tell them apart.
  const already = await prisma.course.findFirst({
    where: { organizationId, name: course.name },
    select: { id: true },
  });
  if (already) {
    return { ok: false, error: `${course.name} is already in your course library.`, courseId: already.id };
  }

  const created = await prisma.course.create({
    data: {
      organizationId,
      name: course.name,
      city: [course.city, course.state].filter(Boolean).join(", "),
      address: course.address,
      pars: course.card.usable
        ? JSON.stringify(course.card.pars)
        : JSON.stringify(new Array(18).fill(4)),
      yards: course.card.usable
        ? JSON.stringify(course.card.yards)
        : JSON.stringify(new Array(18).fill(0)),
      // A placeholder that is at least a valid permutation, so net scoring
      // stays coherent until the club enters the real card — the same fallback
      // `saveClubCourse` uses when the stroke index is left blank.
      strokeIndex: course.card.usable
        ? JSON.stringify(course.card.strokeIndex)
        : JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      source: "imported",
      sourceUrl: directorySourceUrl(course.id),
      tees: {
        create: course.tees.map((t, i) => ({
          name: t.name,
          gender: t.gender,
          courseRating: t.courseRating,
          slopeRating: t.slopeRating,
          par: t.par,
          position: i,
        })),
      },
    },
  });

  refresh();
  return {
    ok: true,
    courseId: created.id,
    cardImported: course.card.usable,
    teeCount: course.tees.length,
    cardProblem: course.card.usable ? undefined : course.card.reason,
  };
}

export interface SourceCheckResult {
  ok: boolean;
  error?: string;
  /** Whether a person at the club has confirmed the stored card. */
  confirmed?: boolean;
  /** Holes where the source and the club's card disagree. Empty means agree. */
  differences?: CardDifference[];
  /** Why there is nothing to compare against, when the source has no usable
   *  card any more. */
  sourceProblem?: string;
}

/**
 * Ask the source whether anything about this course has changed.
 *
 * This NEVER writes. A confirmed card is a person at the club stating a fact
 * about a real course; the source is a community database that this app has
 * already watched be wrong. So the source can report a difference and it can
 * explain it, but it cannot overrule the human — the same refuse-and-explain
 * shape as `drawReadiness` and `resolveThirdPlace`.
 *
 * Silence would be wrong too. Clubs do re-index their holes and rebuild tees,
 * and a club that has done so wants to hear about it. So the difference is
 * offered, and `applySourceCard` is the separate, deliberate act of taking it.
 */
export async function checkCourseAgainstSource(courseId: string): Promise<SourceCheckResult> {
  const { organizationId } = await requireOrganizerOrg();
  const course = await prisma.course.findFirst({ where: { id: courseId, organizationId } });
  if (!course) return { ok: false, error: "Course not found." };

  const directoryId = directoryIdFrom(course.sourceUrl);
  if (!directoryId) {
    return { ok: false, error: "This course wasn't imported from the directory, so there's nothing to check it against." };
  }

  const fresh = await fetchDirectoryCourse(directoryId);
  if (!fresh) return { ok: false, error: "The course directory didn't answer. Try again in a moment." };

  const confirmed = course.verifiedAt !== null;
  if (!fresh.card.usable) {
    return { ok: true, confirmed, differences: [], sourceProblem: fresh.card.reason };
  }

  return {
    ok: true,
    confirmed,
    differences: cardDifferences(
      {
        pars: parseHoleArray(course.pars) ?? [],
        strokeIndex: parseHoleArray(course.strokeIndex) ?? [],
      },
      { pars: fresh.card.pars, strokeIndex: fresh.card.strokeIndex },
    ),
  };
}

/**
 * Take the source's card, because somebody at the club looked at the
 * differences and decided the source is right.
 *
 * Separate from checking on purpose: this is the only path by which a
 * directory can overwrite a club's card, and it exists only behind a human who
 * has seen exactly what it will change. Taking it counts as confirming the
 * card — they have just read it hole by hole — so it lands verified, by them.
 */
export async function applySourceCard(courseId: string): Promise<CourseResult> {
  const { organizationId } = await requireOrganizerOrg();
  const course = await prisma.course.findFirst({ where: { id: courseId, organizationId } });
  if (!course) return { ok: false, error: "Course not found." };

  const directoryId = directoryIdFrom(course.sourceUrl);
  if (!directoryId) return { ok: false, error: "This course wasn't imported from the directory." };

  const fresh = await fetchDirectoryCourse(directoryId);
  if (!fresh) return { ok: false, error: "The course directory didn't answer. Try again in a moment." };
  if (!fresh.card.usable) return { ok: false, error: fresh.card.reason };

  const session = await getSession();
  await prisma.course.update({
    where: { id: courseId },
    data: {
      pars: JSON.stringify(fresh.card.pars),
      strokeIndex: JSON.stringify(fresh.card.strokeIndex),
      yards: JSON.stringify(fresh.card.yards),
      verifiedAt: new Date(),
      verifiedBy: session?.name ?? "",
    },
  });
  refresh();
  return { ok: true, courseId };
}

/* ── Naming the venue for one match, in an open-course tournament ────────── */

export interface NameVenueInput {
  /** An existing club course, when the player picked one from the list. */
  courseId?: string;
  /** Otherwise a course the club has not played before. */
  newCourse?: {
    name: string;
    city: string;
    address: string;
    pars: number[];
    yards: number[];
    strokeIndex: number[];
  };
  /** The tees played, rated — without these there is no course handicap. */
  tee?: { name: string; courseRating: number; slopeRating: number; par: number };
  /** full | front | back, for a nine-hole round. */
  nine?: string;
}

/**
 * Say where a match was played, creating the course if the club is new to it.
 *
 * The flow a league actually needs: two members play somewhere neither the
 * organizer nor the app has heard of, and one of them enters the card that
 * evening. Whoever is entering the score may do this — the same permission
 * that lets them enter the score at all — because they are the one who knows
 * where they played, and a Saturday round should not wait for an organizer.
 *
 * A course entered this way joins the club's library, so the next pairing to
 * play there gets the card instantly. That is what makes the second season of
 * a league quick, and it is the only "lookup" this app performs: a real card
 * a real member typed, rather than a guess.
 */
export async function nameMatchVenue(matchId: string, input: NameVenueInput): Promise<CourseResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not authenticated" };

  const [event, match] = await Promise.all([
    prisma.event.findUnique({ where: { id: session.eventId } }),
    prisma.match.findUnique({ where: { id: matchId } }),
  ]);
  if (!event || !match || match.eventId !== session.eventId) {
    return { ok: false, error: "Match not found." };
  }
  // Same gate as entering the score itself. An organizer-scored tournament
  // does not let a player name the venue either.
  if (!canEnterScores(settingsOf(event), session.role)) {
    return { ok: false, error: "Scores for this tournament are entered by the organizer." };
  }
  // A player may only speak for a match they are actually in. Without this,
  // any signed-in player could repoint anyone's match at another course and
  // silently rescore it against a different stroke index.
  // The same rule as setMatchCourse above, from the same function. This copy
  // read only the two PLAYER columns, which a team round leaves empty — so it
  // refused every four-ball partner the venue of their own match.
  if (session.role === "player" && !(await playsInMatch(session.eventId, session.email, match))) {
    return { ok: false, error: "That isn't your match." };
  }

  let courseId = input.courseId ?? "";

  // A course id off the wire is an arbitrary row until this narrows it. The
  // prompt only ever offers this club's library, but that is a fact about the
  // component, not about the endpoint — and unscoped this did three things at
  // once with another organization's course: pinned the match to it (so the
  // round scored against a stranger's par and stroke index), added it to this
  // tournament's venue list, and — via the tee block below — wrote a Tee row
  // onto a course this club does not own. Scoped to the organization rather
  // than to `eventCourse`, because adding a venue to the event is precisely
  // what this action is for; the club boundary is the one that matters.
  if (courseId) {
    const owned = await prisma.course.findFirst({
      where: { id: courseId, organizationId: event.organizationId },
      select: { id: true },
    });
    if (!owned) return { ok: false, error: "That course isn't in this club's library." };
  }

  if (!courseId) {
    const c = input.newCourse;
    if (!c || !c.name.trim()) return { ok: false, error: "Give the course a name." };

    // The card is checked before it is stored, not after it has scored a
    // round. A stroke index that isn't a full 1..18 puts handicap strokes on
    // the wrong holes, and every total still looks perfectly ordinary.
    const problems = cardProblems({ pars: c.pars, strokeIndex: c.strokeIndex }, 18);
    if (problems.length) return { ok: false, error: problems[0] };

    // Don't create a second row for a course the club already has — that is
    // how a library becomes three Maketewahs with one usable card between them.
    const existing = await prisma.course.findMany({
      where: { organizationId: event.organizationId },
      select: { id: true, name: true, city: true },
    });
    const m = matchCourse(c.name, existing);
    if (m.kind === "exact") {
      courseId = m.course.id;
    } else if (m.kind === "suggest") {
      return {
        ok: false,
        error: `This club already has ${m.candidates.map((x) => `"${x.name}"`).join(" and ")}. Pick one of those instead, or give this course its full name.`,
      };
    } else {
      const created = await prisma.course.create({
        data: {
          organizationId: event.organizationId,
          name: c.name.trim(),
          city: c.city.trim(),
          address: c.address.trim(),
          pars: holeArray(c.pars, 4),
          yards: holeArray(c.yards, 0),
          strokeIndex: holeArray(c.strokeIndex, 1),
          source: "entered-at-scoring",
        },
      });
      courseId = created.id;
    }
  }

  // The tees, and with them the rating and slope a course handicap needs.
  if (input.tee) {
    const problems = teeProblems(input.tee);
    if (problems.length) return { ok: false, error: problems[0] };
    const already = await prisma.tee.findFirst({
      where: { courseId, name: { equals: input.tee.name.trim(), mode: "insensitive" } },
    });
    if (!already) {
      await prisma.tee.create({
        data: {
          courseId,
          name: input.tee.name.trim(),
          courseRating: input.tee.courseRating,
          slopeRating: input.tee.slopeRating,
          par: input.tee.par,
        },
      });
    }
  }

  // Make it one of this tournament's venues, so the existing per-match course
  // picker and every downstream resolver accept it.
  await prisma.eventCourse.upsert({
    where: { eventId_courseId: { eventId: session.eventId, courseId } },
    update: {},
    create: { eventId: session.eventId, courseId },
  });

  await prisma.match.update({
    where: { id: matchId },
    data: { courseId, nine: cleanNine(input.nine ?? "full") },
  });
  refresh();
  return { ok: true };
}
