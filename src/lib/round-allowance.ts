import { findFormat } from "./formats";
import { isHeadToHead } from "./stage-types";

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
