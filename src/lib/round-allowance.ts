import { findFormat, isManualFormat, needsTeams } from "./formats";
import { isHeadToHead, isIndividualStrokeRound } from "./stage-types";

/** Appendix C: four-ball stroke play. The format's own figure, 90, is four-ball match play. */
export const FOUR_BALL_STROKE_PLAY = 85;

/**
 * THE ALLOWANCE A ROUND PLAYS AT, WHICH DEPENDS ON THE ROUND AND NOT ONLY ON
 * ITS FORMAT.
 *
 * The Rules of Handicapping, Appendix C, give a four-ball two figures:
 *
 *     Four-ball stroke play   85%
 *     Four-ball match play    90%
 *
 * The format table holds one number per format, and for Four-Ball it held the
 * match-play one. So a four-ball MEDAL — a stroke-play round, every side
 * returning a card against the field — was offered 90% as "the recommended
 * allowance for this format", and played at it unless a committee knew better.
 * The seeded club's own four-ball round carries 85% "set by your committee, in
 * place of the usual 90%": whoever wrote the fixture knew the right figure and
 * had to type it over the app's.
 *
 * Found 2026-10-13 by reading the table while writing a test that works each
 * board out from the Rules. It is the same kind of fault as taking an allowance
 * of the rounded handicap (see `domain/handicap.ts`): a figure that looks
 * settled, defended by nothing, and one stroke in ten wrong on the day.
 *
 * `stageType` is REQUIRED, and that is the point. With it optional, a caller
 * that left it out would price a stroke four-ball at 90% while the board beside
 * it used 85% — two screens, one side, different handicaps. The compiler finds
 * every caller instead.
 *
 * NOT DONE HERE, and written down in `docs/deferred-register.md`: Appendix C
 * also gives best 1 of 4 at 75% and best 3 of 4 at 100%, where Best Ball plays
 * at 85% whatever the size of the side or the number of balls that count. That
 * needs the allowance worked per SIDE, which is a larger change than this one.
 */
export function recommendedAllowance(format: string, stageType: string | null | undefined): number {
  const f = findFormat(format);
  if (f.name === "Four-Ball" && !isHeadToHead(stageType ?? "")) return FOUR_BALL_STROKE_PLAY;
  return f.allowance;
}

/** The allowance actually in force for a round: the committee's, or the
 *  recommendation for that format in that kind of round when they have set none. */
export function effectiveAllowance(format: string, override: number, stageType: string | null | undefined): number {
  return override > 0 ? override : recommendedAllowance(format, stageType);
}

/**
 * WHETHER A ROUND IN THIS FORMAT GIVES THE STROKES FOR TEES OF A HIGHER PAR
 * (Rules of Handicapping 6.2b — see `roundPlayingHandicap` in `domain/handicap.ts`).
 *
 * The Rule covers stroke play and match play counted in gross or net STROKES,
 * and names what it leaves out: where the result is counted against par —
 * Stableford, par/bogey — each player is already measured against the par of
 * their own tees, and nothing is added.
 *
 *   yes   stroke play, match play, a Nassau, skins, and the formats where
 *         every player plays their own ball and one or more count
 *         (four-ball, best ball, a shamble)
 *   no    Stableford and Modified Stableford, by the Rule
 *   no    a side that shares one ball (foursomes, greensomes, a scramble).
 *         Its handicap is a share of its players' and Appendix C says how the
 *         shares are taken; what a difference in pars adds to a side is a
 *         committee's procedure this app does not have. Written down in
 *         `docs/deferred-register.md`, and nought until it is decided.
 *   no    a round scored by hand, which this app does not price.
 */
export function parStrokesApply(format: string, scoringBasis: string | null | undefined): boolean {
  if (isManualFormat(format)) return false;
  const f = findFormat(format);
  if (f.engine === "stableford" || f.engine === "modified-stableford") return false;
  // A round can also be SET to points whatever its format is — a four-ball
  // Stableford, or a stroke round stored the older way. It is counted against
  // par all the same, so the basis is asked as well as the format, and it is
  // not optional: a caller with only the format in hand would give a points
  // round a stroke the Rule withholds.
  const basis = (scoringBasis ?? "").trim().toLowerCase();
  if (basis === "stableford" || basis === "modified-stableford") return false;
  if (f.ball === "single") return false;
  return true;
}

/**
 * Whether a round takes a share of a handicap at all: a team round, by its
 * format's own panel, or an individual net round, by the line on its card. What
 * the action asks before it stores a figure, so that what a screen OFFERS and
 * what the server ACCEPTS are one list.
 */
export function roundTakesAllowance(s: { format: string; type: string; scoringBasis: string; handicapAllowance: number }): boolean {
  return needsTeams(s.format) || individualAllowanceFor(s) !== null;
}

/** What an individual net round's card says about its allowance. */
export interface RoundAllowanceInfo {
  /** The allowance in force — the committee's, or the recommendation. */
  allowance: number;
  recommended: number;
  /** The committee has set a figure of its own. */
  overridden: boolean;
}

/**
 * THE ALLOWANCE LINE OF AN INDIVIDUAL NET ROUND, or null where a round has none.
 *
 * Null for a team round, which has its own panel; for a match, played at the
 * full difference between the two; for a gross round, which gives no strokes;
 * for skins and a Nassau, which are bets laid over a round; and for a round
 * scored by hand. Stableford is always off handicap, so it has the line
 * whatever its "result calculation" says.
 *
 * Here and not on the screen so that the rule has a test: a line offered on a
 * round that ignores it is a control with nothing behind it, and one missing
 * from a round that honours it is the gap this closed (2026-10-13 — a medal's
 * allowance could not be changed from any screen, and Appendix C lets a field
 * under thirty play at 100%).
 */
export function individualAllowanceFor(s: {
  format: string;
  type: string;
  scoringBasis: string;
  handicapAllowance: number;
}): RoundAllowanceInfo | null {
  if (needsTeams(s.format) || isManualFormat(s.format)) return null;
  if (!isIndividualStrokeRound(s)) return null;
  const engine = findFormat(s.format).engine;
  if (engine !== "stroke" && engine !== "stableford" && engine !== "modified-stableford") return null;
  if (engine === "stroke" && s.scoringBasis.trim().toLowerCase() === "gross") return null;
  return {
    allowance: effectiveAllowance(s.format, s.handicapAllowance, s.type),
    recommended: recommendedAllowance(s.format, s.type),
    overridden: s.handicapAllowance > 0,
  };
}
