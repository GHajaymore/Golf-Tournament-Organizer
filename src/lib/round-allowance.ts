import { findFormat, isManualFormat, needsTeams } from "./formats";
import { isHeadToHead, isIndividualStrokeRound } from "./stage-types";
import { NO_PAR_STROKES, roundPlayingHandicap } from "./domain/handicap";
import { resolveRoundHandicap, roundParStrokesOf, type ResolvedRoundHandicap, type RoundHandicapRow } from "./domain/round-handicap";

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
 * ONE PLAYER'S PLAYING HANDICAP IN ONE ROUND, where they play their own ball:
 * the round's figure for them (frozen, then the committee's, then the roster's
 * — `resolveRoundHandicap`), its allowance taken of the unrounded figure
 * (Rule 6.2a), and then the strokes for tees of a higher par where the round
 * gives them (Rule 6.2b). In that order, and here only.
 *
 * It was written out three times. The board and the screens that show a match
 * (`handicapFor`, `matchHandicapFor`) had all three steps; the stored result of
 * a singles match decided from its two cards had the first alone, so a woman
 * off the par-72 reds was shown a stroke against a man off the par-71 whites
 * and had her win stored as a half
 * (`stored-results-give-the-strokes-for-the-pars.audit.test.ts`).
 *
 * `member` is that player's figures off the tees this round is played from:
 * `CourseHandicaps.get`, `.exact` and `.parStrokes`. `round` is null only when
 * the round cannot be found, and is then priced at 100% with nothing for pars.
 * `handicapAllowance` is the committee's figure, nought for none — a caller
 * holding an override of its own passes that.
 *
 * `roundPlayingHandicap` is called here and in `domain/team.ts` only
 * (`a-round-is-priced-one-way.test.ts`).
 */
export function playingHandicapInRound(
  round: RoundPricing | null | undefined,
  row: RoundHandicapRow | null | undefined,
  member: { whole: number; exact: number; parStrokes: number },
): number {
  return playingHandicapPartsInRound(round, row, member).playing;
}

/** What `playingHandicapInRound` prices a round off. */
export interface RoundPricing {
  format: string;
  type: string | null | undefined;
  scoringBasis: string | null | undefined;
  handicapAllowance: number;
}

/**
 * The same figure with its parts, for a screen that lists them beside it (the
 * round's handicap list, a side's members): so the parts shown and the figure
 * they add up to are one calculation.
 */
export function playingHandicapPartsInRound(
  round: RoundPricing | null | undefined,
  row: RoundHandicapRow | null | undefined,
  member: { whole: number; exact: number; parStrokes: number },
): { resolved: ResolvedRoundHandicap; allowance: number; parStrokes: number; playing: number } {
  const allowance = round ? effectiveAllowance(round.format, round.handicapAllowance, round.type) : 100;
  const resolved = resolveRoundHandicap({
    frozen: row?.frozen,
    frozenExact: row?.frozenExact,
    override: row?.override,
    member: member.whole,
    memberExact: member.exact,
  });
  const parStrokes =
    round && parStrokesApply(round.format, round.scoringBasis) ? roundParStrokesOf(row, member.parStrokes) : NO_PAR_STROKES;
  return { resolved, allowance, parStrokes, playing: roundPlayingHandicap(resolved.exact, allowance, parStrokes) };
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

/**
 * WHAT A COMMITTEE'S ALLOWANCE IS A PERCENTAGE OF, in a round of this format.
 *
 *   "player"       each player's own handicap — an individual net round
 *   "side:<name>"  the side's handicaps, the way THIS format combines them:
 *                  foursomes takes a share of the combined figure, a four-ball
 *                  a share of each partner's, a scramble a table of shares
 *   "none"         nothing — a gross round's strokes, a match's difference, a
 *                  bet, a round scored by hand
 *
 * Basis-free on purpose: a medal flipped from net to gross and back is the same
 * round, and the committee's 100% (Appendix C lets a field under thirty play
 * at it) still means what it meant.
 */
export function allowanceMeans(s: { format: string; type: string }): string {
  if (needsTeams(s.format)) return `side:${findFormat(s.format).name}`;
  if (isManualFormat(s.format) || !isIndividualStrokeRound(s)) return "none";
  const engine = findFormat(s.format).engine;
  return engine === "stroke" || engine === "stableford" || engine === "modified-stableford" ? "player" : "none";
}

/**
 * THE COMMITTEE'S FIGURES A ROUND KEEPS WHEN ITS FORMAT CHANGES.
 *
 * Found by the panel on 2026-10-17: `setStageFormat` kept `handicapAllowance`
 * and `allowanceWeights` whatever the new format was. A committee's 95 on a
 * medal, switched to Foursomes, then played at 95% of the pair's COMBINED
 * handicaps — the side given nearly twice the strokes Appendix C gives it
 * (50%) — and a greensomes 55/45 switched to foursomes overrode foursomes'
 * flat half with a split foursomes does not use (`sidePlayingHandicap` lets a
 * committee's split win over anything). Nothing said so; the screen showed
 * the committee's figure as if it had been chosen for the round in front of it.
 *
 * The rule: a figure is kept only where it still means the same thing.
 *   - the allowance, when `allowanceMeans` is the same before and after;
 *   - the per-player split, only when the format itself is unchanged — a split
 *     is a statement about one format's table.
 * Otherwise the round goes back to the recommendation (0 and []), which the
 * screen shows as such, for the committee to set again if it means to.
 */
export function overridesAfterFormatChange(
  before: { format: string; type: string; handicapAllowance: number; allowanceWeights: number[] },
  nextFormat: string,
): { handicapAllowance: number; allowanceWeights: number[] } {
  const after = { format: nextFormat, type: before.type };
  const sameFormat = findFormat(before.format).name === findFormat(nextFormat).name;
  return {
    handicapAllowance: allowanceMeans(before) === allowanceMeans(after) ? before.handicapAllowance : 0,
    allowanceWeights: sameFormat ? before.allowanceWeights : [],
  };
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
