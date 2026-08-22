/**
 * A club handicap, worked out from the cards a club already holds.
 *
 * **This is not a Handicap Index and must never be presented as one.** A WHS
 * Index is issued by a national association from a golfer's full record across
 * every club they play, and it is licensed, association-held data — see
 * `docs/requirement-course-import.md`, which establishes that nobody can hand
 * one out for free and that this does not change. What this computes is a club
 * handicap: the same published arithmetic, applied to the scores THIS club has,
 * which is a smaller and different thing.
 *
 * Two consequences that have to stay true wherever the number is shown:
 *
 *   - it is labelled as the club's own figure, never "Index" and never "WHS";
 *   - it never overwrites a GHIN or association figure where one exists. The
 *     association is the authority; this is the fallback, which is exactly the
 *     order `docs/requirement-per-round-handicap.md` sets out.
 *
 * The METHOD is public — the Rules of Handicapping publish it, and Appendix E
 * gives the table below. It is the DATA that is licensed. Implementing the
 * published method over your own members' cards is the ordinary thing a club
 * did by hand for a century.
 *
 * What this deliberately does NOT do:
 *
 *   - **PCC.** The Playing Conditions Calculation adjusts a day's scores for
 *     weather and setup, and it is computed by the association from the whole
 *     field across every club that played. A club cannot compute it from its
 *     own cards, so it is zero here and the screen says so rather than
 *     implying an accuracy this does not have.
 *   - **Soft cap and hard cap.** They limit upward movement against a player's
 *     Low Handicap Index over the last 365 days. Worth adding, and it needs a
 *     stored low-index history that does not exist yet.
 */

import { holeStrokesReceived, allocationHoles } from "./stroke";
import { clampSlope, STANDARD_SLOPE, type TeeRating } from "./handicap";

/** The most recent scores a record considers, per the Rules of Handicapping. */
export const RECORD_WINDOW = 20;

/** Fewer than this and no handicap is issued at all. */
export const MINIMUM_SCORES = 3;

/** The ceiling on a handicap, men and women alike, under WHS. */
export const MAX_HANDICAP = 54;

/**
 * How many of the lowest differentials count, and what is taken off the
 * average, by how many scores the record holds.
 *
 * Rules of Handicapping, Appendix E. The adjustments at three and four scores
 * exist because an average of one score is a poor estimate and the Rules push
 * it down rather than let a single good round set a handicap.
 */
const TABLE: Array<{ upTo: number; lowest: number; adjustment: number }> = [
  { upTo: 3, lowest: 1, adjustment: -2.0 },
  { upTo: 4, lowest: 1, adjustment: -1.0 },
  { upTo: 5, lowest: 1, adjustment: 0 },
  { upTo: 6, lowest: 2, adjustment: -1.0 },
  { upTo: 8, lowest: 2, adjustment: 0 },
  { upTo: 11, lowest: 3, adjustment: 0 },
  { upTo: 14, lowest: 4, adjustment: 0 },
  { upTo: 16, lowest: 5, adjustment: 0 },
  { upTo: 18, lowest: 6, adjustment: 0 },
  { upTo: 19, lowest: 7, adjustment: 0 },
  { upTo: 20, lowest: 8, adjustment: 0 },
];

/**
 * The most a hole can count for, however many strokes were actually taken.
 *
 * Rule 3.1: for handicap purposes a hole is capped at net double bogey — par,
 * plus two, plus the strokes that player receives on it. The cap is the whole
 * reason one catastrophic hole does not wreck a handicap, and leaving it out
 * would make every record computed here worse than the player is.
 */
export function netDoubleBogey(par: number, strokesReceived: number): number {
  return par + 2 + Math.max(0, Math.round(strokesReceived));
}

export interface AdjustedRound {
  /** Adjusted Gross Score — the card with every hole capped at net double bogey. */
  adjusted: number;
  /** Holes whose gross was reduced, for the explanation a player will ask for. */
  cappedHoles: number[];
  /** True when the card is complete enough to count at all. */
  usable: boolean;
}

/**
 * The card as handicapping reads it, rather than as it was played.
 *
 * A hole not played is not a zero and not an omission: the Rules score it as
 * net par, so a card with a hole missing still produces an honest differential
 * rather than an absurdly good one. A card missing more than a few holes is
 * refused instead — at some point it stops being a round.
 */
export function adjustedGrossScore(input: {
  strokes: readonly (number | null)[];
  pars: readonly number[];
  /** This player's course handicap on the tee actually played. */
  courseHandicap: number;
  strokeIndex: readonly number[];
  holes: 9 | 18;
}): AdjustedRound {
  const { strokes, pars, courseHandicap, strokeIndex, holes } = input;
  const alloc = allocationHoles(holes);

  let adjusted = 0;
  let missing = 0;
  const cappedHoles: number[] = [];

  for (let i = 0; i < holes; i += 1) {
    const par = pars[i] ?? 4;
    const received = holeStrokesReceived(courseHandicap, strokeIndex[i] ?? 18, alloc);
    const cap = netDoubleBogey(par, received);
    const played = strokes[i];

    if (typeof played !== "number" || played <= 0) {
      // Net par for a hole not played — Rule 3.2. Not a zero, which would
      // hand the player the best round of their life for not finishing.
      adjusted += par + Math.max(0, Math.round(received));
      missing += 1;
      continue;
    }

    if (played > cap) cappedHoles.push(i + 1);
    adjusted += Math.min(played, cap);
  }

  // More than a third of the card absent and it is not a round any more. The
  // Rules allow a hole or two; a card with six holes blank is somebody who
  // walked in, and counting it would quietly lower their handicap.
  return { adjusted, cappedHoles, usable: missing <= Math.floor(holes / 3) };
}

/**
 * One round's Score Differential.
 *
 * `(113 / Slope) x (Adjusted Gross - Course Rating - PCC)`, with PCC zero for
 * the reason given at the top of this file. Rounded to one decimal, as the
 * Rules state the differential.
 *
 * An unrated tee returns null rather than a number. Without a Course Rating
 * and Slope there is no differential to compute, and inventing one from par
 * would produce a handicap that looks authoritative and is not.
 */
export function scoreDifferential(adjustedGross: number, tee: TeeRating | null): number | null {
  if (!tee || !tee.slopeRating || !tee.courseRating) return null;
  const raw = (STANDARD_SLOPE / clampSlope(tee.slopeRating)) * (adjustedGross - tee.courseRating);
  return Math.round(raw * 10) / 10;
}

export interface ClubHandicap {
  /** The handicap itself, to one decimal. */
  handicap: number;
  /** How many scores it was computed from, after the 20-score window. */
  scoresUsed: number;
  /** How many of the lowest differentials counted. */
  lowestCounted: number;
  /** The adjustment the table applied, for the working shown on screen. */
  adjustment: number;
}

/**
 * The club handicap from a player's differentials, most recent LAST.
 *
 * Null below three scores. The Rules issue no handicap on fewer, and returning
 * a number anyway would be the app asserting something the method does not
 * support — the same refusal `scoreDifferential` makes for an unrated tee.
 */
export function clubHandicapFrom(differentials: readonly number[]): ClubHandicap | null {
  const recent = differentials.slice(-RECORD_WINDOW);
  if (recent.length < MINIMUM_SCORES) return null;

  const row = TABLE.find((r) => recent.length <= r.upTo) ?? TABLE[TABLE.length - 1];
  const lowest = [...recent].sort((a, b) => a - b).slice(0, row.lowest);
  const average = lowest.reduce((sum, d) => sum + d, 0) / lowest.length;

  // One decimal, and capped. A 54 ceiling is the Rules'; the floor is open
  // because a plus handicap is a real thing and clamping it to scratch would
  // hand the best golfer in the club strokes they are not entitled to.
  const handicap = Math.min(MAX_HANDICAP, Math.round((average + row.adjustment) * 10) / 10);

  return {
    handicap,
    scoresUsed: recent.length,
    lowestCounted: row.lowest,
    adjustment: row.adjustment,
  };
}
