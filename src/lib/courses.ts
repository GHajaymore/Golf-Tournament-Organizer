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

export const COURSES: CoursePreset[] = [
  {
    name: "Ridgeline National",
    city: "Aspen Falls",
    address: "1 Ridgeline Drive, Aspen Falls",
    pars: [4, 5, 4, 3, 4, 4, 5, 3, 4, 4, 3, 5, 4, 4, 3, 4, 5, 4],
    yards: [412, 538, 401, 178, 445, 420, 561, 165, 398, 430, 189, 552, 408, 436, 205, 415, 545, 389],
    strokeIndex: [5, 15, 3, 17, 1, 7, 9, 13, 11, 6, 18, 2, 8, 4, 16, 10, 12, 14],
  },
  {
    name: "Cedar Hollow Links",
    city: "Millbrook",
    address: "88 Cedar Hollow Road, Millbrook",
    pars: [4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 4, 3, 4, 5, 4, 3, 4, 5],
    yards: [398, 421, 168, 512, 434, 405, 182, 528, 411, 388, 419, 155, 442, 505, 428, 191, 401, 534],
    strokeIndex: [3, 9, 17, 1, 11, 5, 15, 7, 13, 4, 14, 2, 18, 6, 10, 16, 8, 12],
  },
  {
    name: "Blackpine Dunes",
    city: "Harbor Point",
    address: "500 Dunes Parkway, Harbor Point",
    pars: [4, 3, 5, 4, 4, 4, 3, 4, 5, 4, 5, 4, 3, 4, 4, 5, 3, 4],
    yards: [421, 175, 545, 402, 438, 410, 162, 425, 520, 399, 551, 431, 198, 415, 407, 538, 171, 412],
    strokeIndex: [7, 1, 13, 5, 15, 3, 17, 9, 11, 2, 16, 8, 18, 4, 12, 6, 14, 10],
  },
  {
    name: "Willow Creek CC",
    city: "Fairhaven",
    address: "22 Willow Creek Lane, Fairhaven",
    pars: [4, 4, 4, 3, 5, 4, 4, 3, 5, 4, 3, 4, 5, 4, 4, 3, 4, 5],
    yards: [405, 418, 396, 185, 522, 428, 412, 168, 508, 401, 178, 435, 531, 409, 421, 192, 398, 519],
    strokeIndex: [9, 5, 15, 3, 1, 11, 7, 17, 13, 8, 12, 4, 2, 14, 18, 10, 16, 6],
  },
];

export function findCourse(name: string): CoursePreset {
  return COURSES.find((c) => c.name === name) ?? COURSES[0];
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
  return COURSES[0];
}
