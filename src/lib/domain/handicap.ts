/**
 * World Handicap System conversions.
 *
 * The distinction this file exists to enforce: a **Handicap Index** is a
 * portable measure of a golfer's ability, and a **Course Handicap** is how
 * many strokes that ability is worth *on one set of tees at one course*. They
 * are different numbers, and using the first where the second belongs is the
 * single most common way an otherwise correct scoring engine produces wrong
 * results.
 *
 *     Course Handicap = Index × (Slope ÷ 113) + (Course Rating − Par)
 *
 * The slope term scales for difficulty relative to a bogey golfer: 113 is the
 * standard, so a 140-slope course gives a 12.4 index 15 strokes rather than
 * 12. The rating term accounts for a course that plays harder or easier than
 * its par for a scratch golfer.
 *
 * Without both, players off different tees are scored as though the course
 * plays identically for everyone — which is exactly the problem slope and
 * rating were introduced to solve, and why a member-guest with mixed tees
 * cannot be settled fairly on raw indexes.
 */

/** The neutral slope. A course of this difficulty leaves an index unchanged. */
export const STANDARD_SLOPE = 113;

/** Bounds published for slope ratings; anything outside is a data-entry error. */
export const MIN_SLOPE = 55;
export const MAX_SLOPE = 155;

export interface TeeRating {
  /** Course Rating for these tees, in strokes (e.g. 71.5). */
  courseRating: number;
  /** Slope Rating, 55–155. */
  slopeRating: number;
  /** Par for the holes being played. */
  par: number;
}

/**
 * Course Handicap from a Handicap Index and a set of tees.
 *
 * Rounded to the nearest whole stroke, which is how the allocation onward
 * expects it — strokes are given per hole and there is no half stroke.
 *
 * Returns the index unchanged when the tees carry no rating data. That is a
 * deliberate fallback rather than a refusal: plenty of societies play courses
 * whose rating nobody has to hand, and scoring them on raw indexes is what
 * this app did for its whole life. Better to keep working and let the UI say
 * the number is unrated than to block the round.
 */
export function courseHandicap(index: number, tee: Partial<TeeRating> | null | undefined): number {
  if (!Number.isFinite(index)) return 0;
  if (!tee || !Number.isFinite(tee.slopeRating ?? NaN) || !(tee.slopeRating ?? 0)) {
    return Math.round(index);
  }
  const slope = clampSlope(tee.slopeRating!);
  const rating = Number.isFinite(tee.courseRating ?? NaN) ? tee.courseRating! : 0;
  const par = Number.isFinite(tee.par ?? NaN) ? tee.par! : 0;
  // The rating adjustment only applies when both numbers are real; a tee with
  // a slope but no rating still gets the slope scaling, which is the larger
  // and more important of the two terms.
  const ratingTerm = rating && par ? rating - par : 0;
  return Math.round(index * (slope / STANDARD_SLOPE) + ratingTerm);
}

/** Keep a slope inside the published range so one bad row can't distort a field. */
export function clampSlope(slope: number): number {
  if (!Number.isFinite(slope)) return STANDARD_SLOPE;
  return Math.min(MAX_SLOPE, Math.max(MIN_SLOPE, slope));
}

/**
 * Playing Handicap: the Course Handicap after the format's allowance.
 *
 * Two separate roundings on purpose. The Course Handicap is rounded first
 * because it is a real, quoted number a player is told on the first tee, and
 * the allowance is then applied to that. Collapsing them into one calculation
 * gives a different answer often enough to cause arguments.
 */
export function playingHandicapFrom(courseHcp: number, allowancePct: number): number {
  return Math.round((courseHcp * allowancePct) / 100);
}

/**
 * A nine-hole round.
 *
 * Nine-hole ratings are roughly half of eighteen, and a nine-hole index is
 * half an eighteen-hole one. Where a club has published proper nine-hole
 * ratings those should be used directly; this halves an eighteen-hole set as
 * the documented approximation when they haven't.
 */
export function nineHoleTee(tee: TeeRating): TeeRating {
  return {
    courseRating: tee.courseRating / 2,
    slopeRating: tee.slopeRating,
    par: tee.par / 2,
  };
}

/** True when a tee carries enough data to compute a real Course Handicap. */
export function isRated(tee: Partial<TeeRating> | null | undefined): boolean {
  return !!tee && Number.isFinite(tee.slopeRating ?? NaN) && (tee.slopeRating ?? 0) > 0;
}

export interface HandicapExplanation {
  index: number;
  courseHandicap: number;
  playingHandicap: number;
  rated: boolean;
  /** One line an organizer can read out when a player queries their strokes. */
  detail: string;
}

/**
 * The whole calculation, with its reasoning.
 *
 * Golfers query their stroke allocation, and "the computer said so" is not an
 * answer a committee can give. This returns the arithmetic in words so the
 * scorecard and the tee sheet can show exactly where a number came from.
 */
export function explainHandicap(
  index: number,
  tee: Partial<TeeRating> | null | undefined,
  allowancePct: number,
): HandicapExplanation {
  const ch = courseHandicap(index, tee);
  const ph = playingHandicapFrom(ch, allowancePct);
  const rated = isRated(tee);

  const detail = rated
    ? `Index ${index} × (${clampSlope(tee!.slopeRating!)} ÷ ${STANDARD_SLOPE})` +
      (tee!.courseRating && tee!.par ? ` + (${tee!.courseRating} − ${tee!.par})` : "") +
      ` = ${ch} course handicap` +
      (allowancePct === 100 ? "" : `, at ${allowancePct}% = ${ph} playing handicap`)
    : `No course rating for these tees, so the index of ${index} is used as-is` +
      (allowancePct === 100 ? "" : `, at ${allowancePct}% = ${ph}`);

  return { index, courseHandicap: ch, playingHandicap: ph, rated, detail };
}

export interface IndexHolder {
  id: string;
  /** The roster's Handicap Index. */
  handicap: number;
  /** "9" when the stored number is a nine-hole index. */
  handicapType?: string;
  /** Which tees this player is on, if they've been assigned a specific set. */
  teeId?: string | null;
}

/**
 * Course Handicaps for a whole field, in one place.
 *
 * Built as a map rather than converted at each call site on purpose. There are
 * half a dozen places that consume a handicap — stroke cards, net match play,
 * team allowances, standings — and converting at each one means a single
 * missed site silently reinstates the original bug with no visible symptom.
 * Resolving once, where the field is loaded, makes that impossible.
 *
 * `defaultTee` is the round's tees, used for anyone not assigned their own.
 * Null everywhere means unrated, and every index passes through unchanged —
 * which is exactly how the app behaved before ratings existed.
 */
export function courseHandicapMap(
  players: IndexHolder[],
  teesById: Map<string, TeeRating>,
  defaultTeeId: string | null,
  holes: number,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of players) {
    const raw = teesById.get(p.teeId ?? defaultTeeId ?? "") ?? null;
    // A nine-hole index is already half an eighteen-hole one. Halving the
    // rating as well would compound, so the index is doubled back to its
    // eighteen-hole equivalent whenever the round is not itself nine holes.
    const index = p.handicapType === "9" && holes !== 9 ? p.handicap * 2 : p.handicap;
    const tee = raw && holes === 9 ? nineHoleTee(raw) : raw;
    out.set(p.id, courseHandicap(index, tee));
  }
  return out;
}
