import { COURSES, parseHoleArray, type CoursePreset } from "../courses";

/**
 * Which course a round or a match was actually played on.
 *
 * Three levels, most specific first:
 *
 *   match  — a community league where opponents arrange their own venue, or
 *            an organizer correcting a pairing that had to move at short
 *            notice.
 *   round  — a multi-day or multi-week tournament rotating courses the
 *            organizer booked in advance.
 *   event  — the ordinary single-venue tournament, set once at setup and
 *            never asked about again.
 *
 * Inheriting is the default, never a restriction: a level left unset simply
 * takes the one above it, and staff can always set any level explicitly.
 *
 * Returns null rather than a fallback when nothing is set, so callers decide
 * whether that matters. It is fatal for net or stroke scoring, which need par
 * and stroke index; it is fine for gross match play, which needs neither.
 */

/** A saved club course, as stored (JSON hole arrays). */
export interface StoredCourse {
  id: string;
  name: string;
  city: string;
  pars: string;
  yards: string;
  strokeIndex: string;
}

/** The event's own course fields — a preset name or a saved custom card. */
export interface EventCourseFields {
  course: string;
  city: string;
  customPars: string;
  customYards: string;
  customStrokeIndex: string;
}

export type Nine = "full" | "front" | "back";

export interface ResolvedCourse {
  name: string;
  city: string;
  pars: number[];
  yards: number[];
  strokeIndex: number[];
  /** Where the answer came from — shown in the UI so an organizer can see
   *  whether a value is inherited or set on this row. */
  source: "match" | "round" | "event";
}

function fromStored(c: StoredCourse, source: ResolvedCourse["source"]): ResolvedCourse | null {
  const pars = parseHoleArray(c.pars);
  const yards = parseHoleArray(c.yards);
  const strokeIndex = parseHoleArray(c.strokeIndex);
  if (!pars || !yards || !strokeIndex) return null;
  return { name: c.name, city: c.city, pars, yards, strokeIndex, source };
}

function fromEvent(event: EventCourseFields): ResolvedCourse | null {
  const preset = COURSES.find((c: CoursePreset) => c.name === event.course);
  if (preset) {
    return {
      name: preset.name,
      city: preset.city,
      pars: preset.pars,
      yards: preset.yards,
      strokeIndex: preset.strokeIndex,
      source: "event",
    };
  }
  const pars = parseHoleArray(event.customPars);
  const yards = parseHoleArray(event.customYards);
  const strokeIndex = parseHoleArray(event.customStrokeIndex);
  if (!pars || !yards || !strokeIndex) return null;
  return {
    name: event.course || "Course",
    city: event.city,
    pars,
    yards,
    strokeIndex,
    source: "event",
  };
}

/** The course for one match, walking match → round → event. */
export function courseForMatch(
  matchCourse: StoredCourse | null,
  roundCourse: StoredCourse | null,
  event: EventCourseFields,
): ResolvedCourse | null {
  if (matchCourse) {
    const resolved = fromStored(matchCourse, "match");
    if (resolved) return resolved;
  }
  if (roundCourse) {
    const resolved = fromStored(roundCourse, "round");
    if (resolved) return resolved;
  }
  return fromEvent(event);
}

/** The course for a whole round, walking round → event. */
export function courseForRound(
  roundCourse: StoredCourse | null,
  event: EventCourseFields,
): ResolvedCourse | null {
  if (roundCourse) {
    const resolved = fromStored(roundCourse, "round");
    if (resolved) return resolved;
  }
  return fromEvent(event);
}

/**
 * Narrow an 18-hole card to the nine actually played.
 *
 * A 9-hole round is played on one half of a real course, and which half
 * decides both the pars and the stroke indexes — so a net match on the back
 * nine allocates strokes completely differently from the front. Returning the
 * first nine regardless would quietly mis-score half of them.
 */
export function applyNine(course: ResolvedCourse, nine: Nine, holes: number): ResolvedCourse {
  if (holes !== 9 || nine === "full") return course;
  if (course.pars.length < 18) return course;

  const slice = <T,>(arr: T[]) => (nine === "back" ? arr.slice(9, 18) : arr.slice(0, 9));
  return {
    ...course,
    name: `${course.name} (${nine === "back" ? "back" : "front"} nine)`,
    pars: slice(course.pars),
    yards: slice(course.yards),
    strokeIndex: slice(course.strokeIndex),
  };
}
