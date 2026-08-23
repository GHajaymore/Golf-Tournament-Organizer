// Course presets for the scorecard generator. In production these would live in
// a Courses table; for the pilot they are a static catalog of realistic layouts.

import type { StoredCourse } from "./services/course-resolution";
import { lookupFormat } from "./formats";

export interface CoursePreset {
  name: string;
  city: string;
  address: string;
  /** Par per hole, 18 entries (front nine 0-8, back nine 9-17). */
  pars: number[];
  /** Yardage per hole, 18 entries. */
  yards: number[];
  /** Stroke index per hole, 18 entries — 1 = hardest hole, 18 = easiest. Drives the "toughest N holes" tiebreakers. */
  strokeIndex: number[];
}


/**
 * A course we know nothing about.
 *
 * Empty arrays rather than plausible ones, deliberately: every consumer of
 * pars or stroke index can tell "unknown" from "a par 72", and the ones that
 * need real data — net scoring, toughest-N tiebreaks — refuse instead of
 * inventing an answer.
 */
export const UNKNOWN_COURSE: CoursePreset = {
  name: "",
  city: "",
  address: "",
  pars: [],
  yards: [],
  strokeIndex: [],
};

/** The subset of Event fields needed to resolve real course data. */
export interface EventCourseFields {
  /**
   * The club course this tournament points at, when the caller loaded it.
   *
   * OPTIONAL on purpose. Adding it to a query is what switches that screen
   * from resolving by name to resolving by id, so the migration is one select
   * at a time rather than one commit that moves every card at once. A caller
   * that has not been changed passes nothing and behaves exactly as before.
   *
   * It wins over the name below because it is what the organizer actually
   * picked; the name is a label kept beside it. If its card will not parse,
   * resolution falls through to the old path rather than returning nothing —
   * a broken row must not take a working card away.
   */
  courseRef?: StoredCourse | null;
  course: string;
  city: string;
  customPars: string;
  customYards: string;
  customStrokeIndex: string;
}

export function parseHoleArray(json: string): number[] | null {
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) && arr.length === 18 && arr.every((n) => typeof n === "number") ? arr : null;
  } catch {
    return null;
  }
}

/**
 * True once real course data backs this event — either a known preset name,
 * or a custom course the organizer has saved (pars/yards/stroke index all
 * present). False for a blank or unrecognized course name, which is when
 * scoring math would otherwise silently run against fake demo-course data.
 */
export function hasCourseData(
  event: Pick<
    EventCourseFields,
    "course" | "customPars" | "customYards" | "customStrokeIndex" | "courseRef"
  >,
): boolean {
  /**
   * The picked course counts, and had to be added here deliberately.
   *
   * This gates score entry. Since saveEvent clears the event's own card when
   * the venue changes, a club that picks a course from their library has a
   * courseId and NO custom card — so without this line the answer is "no
   * course data" and the entry screen blocks a tournament whose venue is
   * perfectly well known.
   */
  if (event.courseRef && parseHoleArray(event.courseRef.pars)) return true;
  return !!(parseHoleArray(event.customPars) && parseHoleArray(event.customYards) && parseHoleArray(event.customStrokeIndex));
}

/** The parts of a round that decide whether course data is required. */
export interface ScoringShape {
  /** Golf format for the round — see src/lib/formats.ts. */
  format: string;
  /** gross | net | both | stableford */
  scoringBasis: string;
}

/**
 * Whether this tournament's scoring actually needs par and stroke index.
 *
 * Not every tournament is played somewhere. Community and society match-play
 * leagues run over a season with no fixed venue at all: opponents arrange
 * their own match, at whatever course suits them, any time before the
 * deadline. Demanding a course from those organizers is asking for something
 * that will never exist.
 *
 * What the maths genuinely requires:
 *   - **Gross match play** — nothing. "Who won this hole" needs no par,
 *     no yardage and no stroke index.
 *   - **Net match play** — stroke index, to allocate handicap strokes.
 *   - **Stroke play and Stableford** — par, for scores against it.
 *
 * So the requirement follows the scoring, not the calendar.
 */
export function needsCourseData(stages: ScoringShape[]): boolean {
  if (stages.length === 0) return false;
  return stages.some((s) => {
    const f = lookupFormat(s.format);
    // An unrecognized format is assumed to score against par. findFormat's
    // fallback would resolve it to Match Play and wrongly answer "no course
    // needed" — the unsafe direction for a format we know nothing about.
    if (!f) return true;
    // Match play is the only family that can be scored on nothing at all, and
    // only gross: "who won this hole" needs no par. Everything else — stroke,
    // Stableford, skins, and every team format, all of which aggregate real
    // scores — needs par. Read off the format's family rather than its name,
    // because "Four-Ball" is match play and says so nowhere in its title.
    if (f.family !== "match") return true;
    return s.scoringBasis !== "gross"; // net/both match play needs stroke index
  });
}

/**
 * Resolve the real course backing this event — a known preset, or the
 * organizer's saved custom course. Falls back to the default demo preset
 * only as a last resort so existing scoring math never crashes; callers
 * that need to know whether that fallback is fake data should check
 * `hasCourseData` first.
 */
export function resolveCourse(event: EventCourseFields): CoursePreset {
  // The id the organizer picked, before the name they picked it by.
  if (event.courseRef) {
    const pars = parseHoleArray(event.courseRef.pars);
    const yards = parseHoleArray(event.courseRef.yards);
    const strokeIndex = parseHoleArray(event.courseRef.strokeIndex);
    if (pars && yards && strokeIndex) {
      return {
        name: event.courseRef.name,
        city: event.courseRef.city,
        address: "",
        pars,
        yards,
        strokeIndex,
      };
    }
  }
  const pars = parseHoleArray(event.customPars);
  const yards = parseHoleArray(event.customYards);
  const strokeIndex = parseHoleArray(event.customStrokeIndex);
  if (pars && yards && strokeIndex) {
    return { name: event.course || "Custom course", city: event.city, address: "", pars, yards, strokeIndex };
  }
  // Unknown rather than a stand-in. Falling back to a bundled course meant
  // scoring a real tournament against a fictional card and never saying so.
  return { ...UNKNOWN_COURSE, name: event.course, city: event.city };
}
