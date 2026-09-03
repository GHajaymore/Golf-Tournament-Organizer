import { parseHoleArray } from "../courses";

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

/**
 * The join that switches a query from resolving by name to resolving by id.
 *
 * One definition, because this is the migration: a screen still resolving by
 * name is a screen whose query has not had this added yet, and `include:
 * COURSE_REF` is the whole change. Written out at each site it would drift —
 * a select missing `strokeIndex` would parse to null and fall silently back
 * to the old path, which is the one failure here nothing would report.
 */
export const COURSE_REF = {
  courseRef: {
    select: { id: true, name: true, city: true, pars: true, yards: true, strokeIndex: true },
  },
} as const;

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
  if (event.courseRef) {
    const resolved = fromStored(event.courseRef, "event");
    if (resolved) return resolved;
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
 * A stored `Stage.nine` narrowed to the three values that mean anything.
 *
 * Anything unrecognised reads as "full" — the whole card — because the safe
 * failure for an unknown value is to narrow nothing, not to guess a half.
 */
export function cleanNine(value: string | null | undefined): Nine {
  return value === "front" || value === "back" ? value : "full";
}

/**
 * Re-rank nine stroke-index values to 1..9, keeping their relative difficulty.
 *
 * An 18-hole card's stroke indexes are ranked across eighteen holes, so one
 * nine of it holds nine values scattered through 1..18 — the odds on one half,
 * the evens on the other, at most clubs. Handicap strokes are allocated by
 * comparing the index against the strokes to give (see holeStrokesReceived),
 * which assumes the indexes run 1..n over the holes being played.
 *
 * Slicing without re-ranking is what made a nine-hole round hand out roughly
 * half the strokes owed. A back nine of [2,4,6,8,10,12,14,16,18] gives a
 * five-stroke player strokes only where the index is <= 5 — two holes, not
 * five. Ranked to [1..9] he gets the five he is due, on the five hardest of
 * the nine he is actually playing, which is what the Rules of Handicapping
 * require.
 *
 * Ties keep their original order, so a card with duplicate indexes still
 * produces a stable 1..9.
 */
function rerankNine(strokeIndex: number[]): number[] {
  const byDifficulty = strokeIndex
    .map((value, hole) => ({ value, hole }))
    .sort((a, b) => a.value - b.value || a.hole - b.hole);
  const ranked = new Array<number>(strokeIndex.length);
  byDifficulty.forEach((entry, i) => {
    ranked[entry.hole] = i + 1;
  });
  return ranked;
}

/**
 * Narrow an 18-hole card to the nine actually played.
 *
 * A 9-hole round is played on one half of a real course, and which half
 * decides both the pars and the stroke indexes — so a net match on the back
 * nine allocates strokes completely differently from the front. Returning the
 * first nine regardless would quietly mis-score half of them.
 *
 * The stroke indexes are re-ranked, not merely sliced — see rerankNine. Every
 * consumer of this card allocates strokes on a base of nine, and nine holes
 * carrying eighteen-hole index numbers is a card no handicap system describes.
 */
export function applyNine<
  // Generic over the card shape: the same narrowing is needed for a
  // ResolvedCourse (which carries where it came from) and for the plain
  // CoursePreset the server actions resolve. Requiring one of them meant the
  // match-scoring path could not call this at all, which is how it came to
  // score a back nine off the front.
  T extends { name: string; pars: number[]; yards: number[]; strokeIndex: number[] },
>(course: T, nine: Nine, holes: number): T {
  if (holes !== 9) return course;
  if (course.pars.length < 18) return course;

  /**
   * A nine-hole round that does not say WHICH nine still gets narrowed.
   *
   * `Stage.nine` defaults to "full", and "full" is a real choice in the picker
   * ("Not fixed — shotgun or mixed"), so it is the state of every nine-hole
   * round nobody has touched the dropdown on. Returning the whole eighteen for
   * it left a nine-hole card being allocated against eighteen-hole indexes on
   * an eighteen-hole base — a player owed five strokes over nine received
   * three. The re-ranking below only ever fired for organizers who had picked
   * a side, which is the minority of nine-hole rounds.
   *
   * The front nine is the assumption, and it is the one the rest of the app
   * already makes — the leaderboard slices `0..holeCount`, and a nine-hole
   * card is stored at indexes 0-8. Stating it here makes every surface agree,
   * and makes the assumption visible in the course name rather than silent.
   */
  const half: Nine = nine === "back" ? "back" : "front";
  const slice = <T,>(arr: T[]) => (half === "back" ? arr.slice(9, 18) : arr.slice(0, 9));
  const si = slice(course.strokeIndex);
  return {
    ...course,
    name: `${course.name} (${nine === "back" ? "back" : "front"} nine)`,
    pars: slice(course.pars),
    yards: slice(course.yards),
    // Only re-rank a full nine; a partial or empty index array is left alone
    // rather than being given invented ranks.
    strokeIndex: si.length === 9 ? rerankNine(si) : si,
  };
}

/**
 * The card a round is actually played on.
 *
 * `applyNine` has always been correct; the problem was that calling it was
 * optional. Thirteen scoring and money call sites instead did the obvious
 * thing — `course.strokeIndex.slice(0, holes)` — which takes the right NUMBER
 * of holes and the wrong VALUES.
 *
 * An eighteen-hole card's stroke indexes are ranked across eighteen holes, so
 * the front nine of an ordinary card carries 1,3,5,...,17. Allocation compares
 * the index against the strokes to give, so a player owed seven strokes over
 * nine received four — and a round set to the BACK nine was scored off the
 * FRONT nine's indexes and pars entirely, counting a 4 on a par-5 11th as
 * nothing and a 4 on a par-3 13th as a birdie.
 *
 * It never showed up as an obvious fault because the individual stroke board
 * went through `applyNine` and was right, so a club saw two boards for the
 * same round, three strokes apart, with no clue which to believe.
 *
 * Takes the stage rather than a hole count so the caller cannot supply one
 * without the other: which nine and how many holes are one decision, and
 * splitting them is what let every one of those thirteen sites get it wrong.
 */
export function cardForStage<
  T extends { name: string; pars: number[]; yards: number[]; strokeIndex: number[] },
>(course: T, stage: { holes?: number | null; nine?: string | null } | null | undefined): T {
  return applyNine(course, cleanNine(stage?.nine), stage?.holes === 9 ? 9 : 18);
}

/**
 * Which half a MATCH is played over: its own answer, then the round's.
 *
 * `Match.nine` exists because a pairing can arrange its own tee time on the
 * other nine, and two actions write it. It was read in exactly one place, and
 * only when the match ALSO named its own course — the reasoning being that a
 * pairing choosing a venue also chose which half of it.
 *
 * That is true and it is not the only case. A match playing the round's course
 * on the other nine sets `nine` and nothing else, and every such match was
 * scored on the round's half: a back-nine match counted a 4 on the par-5 11th
 * as nothing and a 4 on the par-3 13th as a birdie, and allocated its strokes
 * off the front nine's indexes.
 *
 * "full" is not a choice of half — it is the absence of one, and the default on
 * every match nobody has touched — so it defers to the round rather than
 * overriding it with the whole card.
 */
export function nineForMatch(
  match: { nine?: string | null } | null | undefined,
  stage: { nine?: string | null } | null | undefined,
): Nine {
  const own = cleanNine(match?.nine);
  return own !== "full" ? own : cleanNine(stage?.nine);
}

/**
 * The card one match is played on, narrowed to the holes it is played over.
 *
 * The match-level twin of `cardForStage`, and it exists for the same reason:
 * which nine and how many holes are one decision, and every site that split
 * them got it wrong.
 */
export function cardForMatch<
  T extends { name: string; pars: number[]; yards: number[]; strokeIndex: number[] },
>(
  course: T,
  match: { nine?: string | null } | null | undefined,
  stage: { holes?: number | null; nine?: string | null } | null | undefined,
): T {
  return applyNine(course, nineForMatch(match, stage), stage?.holes === 9 ? 9 : 18);
}
