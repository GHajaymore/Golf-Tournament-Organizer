import "server-only";
import { prisma } from "../db";
import { parseHoleArray } from "../courses";

/** A course as the UI needs it — hole arrays already decoded. */
export interface ClubCourse {
  id: string;
  name: string;
  city: string;
  pars: number[];
  yards: number[];
  strokeIndex: number[];
  /** Whether this tournament is allowed to be played on it. */
  inEvent: boolean;
  /** manual | imported | preset — how the card got here. */
  source: string;
  /** Whether someone at the club has confirmed the card against the real one.
   *  An unconfirmed stroke index allocates shots to the wrong holes silently. */
  verified: boolean;
  /** Who confirmed it, for the organizer who asks "says who?". */
  verifiedBy: string;
  /** Where an imported card came from, so it can be re-checked. */
  sourceUrl: string;
  /** The sets of tees it is played from, with their ratings. */
  tees: ClubTee[];
}

/**
 * A set of tees as the library screen shows them.
 *
 * `rated` is carried rather than derived in the component so the two places
 * that decide what "rated" means — this and the scoring conversion — cannot
 * drift apart into showing one thing and scoring another.
 */
export interface ClubTee {
  id: string;
  name: string;
  gender: string;
  courseRating: number;
  slopeRating: number;
  par: number;
  rated: boolean;
}

const DEFAULT_PARS = new Array(18).fill(4);
const DEFAULT_YARDS = new Array(18).fill(400);
const DEFAULT_SI = Array.from({ length: 18 }, (_, i) => i + 1);

/**
 * The club's whole course library, flagged with which ones this tournament
 * uses.
 *
 * One list rather than two, because the setup screen shows the library and
 * the selection together — an organizer picking venues wants to see what else
 * the club has on file, not just what's already chosen.
 */
export async function clubCourses(organizationId: string, eventId: string): Promise<ClubCourse[]> {
  const [courses, links] = await Promise.all([
    prisma.course.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      include: { tees: { orderBy: [{ position: "asc" }, { name: "asc" }] } },
    }),
    prisma.eventCourse.findMany({ where: { eventId }, select: { courseId: true } }),
  ]);
  const selected = new Set(links.map((l) => l.courseId));

  return courses.map((c) => ({
    id: c.id,
    name: c.name,
    city: c.city,
    // Fall back rather than drop the row: a course with a corrupt card should
    // still be visible and editable, not vanish from the library.
    pars: parseHoleArray(c.pars) ?? DEFAULT_PARS,
    yards: parseHoleArray(c.yards) ?? DEFAULT_YARDS,
    strokeIndex: parseHoleArray(c.strokeIndex) ?? DEFAULT_SI,
    inEvent: selected.has(c.id),
    source: c.source,
    verified: c.verifiedAt !== null,
    verifiedBy: c.verifiedBy,
    sourceUrl: c.sourceUrl,
    // Ratings are what turn a Handicap Index into the strokes a player
    // actually receives here, so they travel with the course rather than
    // living on a separate screen nobody finds.
    tees: c.tees.map((t) => ({
      id: t.id,
      name: t.name,
      gender: t.gender,
      courseRating: t.courseRating,
      slopeRating: t.slopeRating,
      par: t.par,
      rated: t.slopeRating > 0,
    })),
  }));
}

/** Just the venues this tournament may be played on, in name order. */
export async function eventCourses(eventId: string): Promise<ClubCourse[]> {
  const links = await prisma.eventCourse.findMany({
    where: { eventId },
    include: { course: { include: { tees: { orderBy: [{ position: "asc" }, { name: "asc" }] } } } },
  });
  return links
    .map((l) => ({
      id: l.course.id,
      name: l.course.name,
      city: l.course.city,
      source: l.course.source,
      verified: l.course.verifiedAt !== null,
      verifiedBy: l.course.verifiedBy,
      sourceUrl: l.course.sourceUrl,
      pars: parseHoleArray(l.course.pars) ?? DEFAULT_PARS,
      tees: l.course.tees.map((t) => ({
        id: t.id,
        name: t.name,
        gender: t.gender,
        courseRating: t.courseRating,
        slopeRating: t.slopeRating,
        par: t.par,
        rated: t.slopeRating > 0,
      })),
      yards: parseHoleArray(l.course.yards) ?? DEFAULT_YARDS,
      strokeIndex: parseHoleArray(l.course.strokeIndex) ?? DEFAULT_SI,
      inEvent: true,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Whether this tournament rotates venues.
 *
 * The single-course case must stay invisible: one venue means every picker
 * stays hidden and nobody is asked a question with one possible answer.
 */
export async function isMultiCourse(eventId: string): Promise<boolean> {
  return (await prisma.eventCourse.count({ where: { eventId } })) > 1;
}
