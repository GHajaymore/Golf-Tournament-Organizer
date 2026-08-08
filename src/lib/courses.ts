// Course presets for the scorecard generator. In production these would live in
// a Courses table; for the pilot they are a static catalog of realistic layouts.

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
 * No bundled courses.
 *
 * This held four invented layouts — Ridgeline National, Cedar Hollow Links,
 * Blackpine Dunes, Willow Creek CC — with invented pars and stroke indexes,
 * and the design handoff was explicit that they were placeholder: "Copy
 * text/sample data (player names, course names) is illustrative demo content
 * — replace with real data."
 *
 * They were worse than unfinished. An organizer picked one from a dropdown
 * believing it was real, and every net score and every toughest-N tiebreak
 * was then computed against a card that does not exist. Nothing on screen
 * said so.
 *
 * A club enters its own course once, with tees and ratings, in the course
 * library. That is real data, and it is the only kind this app should score
 * against.
 */
export const COURSES: CoursePreset[] = [];

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

export function findCourse(name: string): CoursePreset {
  return COURSES.find((c) => c.name === name) ?? UNKNOWN_COURSE;
}

/** The subset of Event fields needed to resolve real course data. */
export interface EventCourseFields {
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
export function hasCourseData(event: Pick<EventCourseFields, "course" | "customPars" | "customYards" | "customStrokeIndex">): boolean {
  if (COURSES.some((c) => c.name === event.course)) return true;
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
  const known = COURSES.find((c) => c.name === event.course);
  if (known) return known;
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
