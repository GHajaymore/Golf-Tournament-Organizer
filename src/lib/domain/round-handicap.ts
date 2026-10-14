/**
 * What a player plays off in ONE round, and why it cannot move afterwards.
 *
 * The app derives net scores rather than storing them, which is right and which
 * the codebase says repeatedly. But a handicap that changes over time breaks the
 * assumption underneath it: `aggregateStroke` reads `handicapFor(player, round)`
 * live every time a board is drawn, so an organizer editing a handicap in round
 * three silently re-scores round one — a finished round, possibly a settled cut,
 * possibly a pot already paid out in the bar.
 *
 * The resolution is to freeze the INPUT, not the output. Net stays derived; what
 * it derives FROM stops moving. That is the same answer `settingsForNewEvent`
 * already gives at a different scale — the club's defaults are copied onto an
 * event at creation so "a club that changes its house default next month must
 * not silently rewrite the rules of an event already being played."
 *
 * Three sources, most specific first:
 *
 *   frozen   — what this round was actually scored against. Written when the
 *              round's first card arrives and never rewritten. Wins over
 *              everything, including a later override, because it is not a
 *              preference: it is what happened.
 *   override — the committee's decision for this round, set before play.
 *   member   — the handicap on the roster. The default, per the requirement,
 *              unless a GHIN interface supplies one.
 *
 * `frozen` beating `override` is the point of the whole feature. An organizer
 * who changes an override after cards are in has changed their mind, and a
 * round already played is not a thing anyone gets to change their mind about.
 */

import { wholeStrokes } from "./handicap";

/** Where a round's handicap came from, most specific first. */
export type HandicapSource = "frozen" | "override" | "member";

export interface RoundHandicapInput {
  /** What this round was scored against, once its first card landed. */
  frozen?: number | null;
  /**
   * The same frozen fact before it was rounded, where the round kept one.
   *
   * An allowance is taken of the UNROUNDED Course Handicap (Rule 6.2a), so a
   * round that froze only the whole number could not be priced by the Rule once
   * the roster moved. Null on a round frozen before 2026-10-13, and on one frozen
   * off a committee's own figure: the whole number is then all there is, and
   * such a round keeps exactly the strokes it was played off.
   */
  frozenExact?: number | null;
  /** The committee's decision for this round, set before play. */
  override?: number | null;
  /** The roster's handicap for this player. The default. */
  member: number;
  /**
   * The roster's handicap before rounding — `CourseHandicaps.exact(id)`.
   *
   * Optional so that a caller with only a whole number still gets an answer,
   * and that answer is the whole number. Ignored unless it rounds to `member`:
   * the two must describe one handicap.
   */
  memberExact?: number | null;
}

export interface ResolvedRoundHandicap {
  handicap: number;
  /**
   * What an ALLOWANCE is taken of: the same handicap before it was rounded.
   *
   * Equal to `handicap` wherever a whole number is all there is — a committee's
   * figure, or a round frozen without its exact one. Always rounds to
   * `handicap`, so a screen showing one and a board scoring off the other
   * cannot be describing two different players.
   */
  exact: number;
  source: HandicapSource;
  /**
   * Whether this round's handicap can still be changed.
   *
   * False once frozen. The screen needs this to say why a control is not
   * offered — "cards are in" is an answer; a disabled box is not.
   */
  editable: boolean;
  /**
   * Set when a frozen round disagrees with what would be used today.
   *
   * Not an error and not a correction to make. It is the honest explanation
   * for "why is his net different in round one" — and without it, somebody
   * eventually decides the app is wrong and re-enters the round.
   */
  differsFromCurrent: number | null;
}

const clean = (v: number | null | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? wholeStrokes(v) : null;

/** The unrounded figure when it is one and it rounds to `whole`; otherwise `whole` itself. */
const exactFor = (whole: number, exact: number | null | undefined): number =>
  typeof exact === "number" && Number.isFinite(exact) && wholeStrokes(exact) === whole ? exact : whole;

/**
 * The handicap for one player in one round.
 *
 * Pure, so the rule can be tested against every combination without a database
 * — and so there is exactly one place that decides it. The read path, the
 * screen and the freeze all call this.
 */
export function resolveRoundHandicap(input: RoundHandicapInput): ResolvedRoundHandicap {
  const frozen = clean(input.frozen);
  const override = clean(input.override);
  const member = clean(input.member) ?? 0;

  // What this round WOULD use if nothing were frozen — the comparison a player
  // asking "why is my net different" is actually making.
  const current = override ?? member;

  if (frozen !== null) {
    return {
      handicap: frozen,
      exact: exactFor(frozen, input.frozenExact),
      source: "frozen",
      editable: false,
      differsFromCurrent: frozen === current ? null : current,
    };
  }

  if (override !== null) {
    // A committee's figure is a whole number by decree, and the Rule's own
    // exception covers it: the allowance is taken of what they said.
    return { handicap: override, exact: override, source: "override", editable: true, differsFromCurrent: null };
  }

  return {
    handicap: member,
    exact: exactFor(member, input.memberExact ?? input.member),
    source: "member",
    editable: true,
    differsFromCurrent: null,
  };
}

/**
 * One player's handicap for one round, given the round's row and today's roster
 * number.
 *
 * The shorthand every scoring path uses, so that honouring a round's handicap
 * is one call rather than four transcriptions of the same three-way choice. A
 * missing row means the roster number, untouched — which is what every one of
 * those paths did before this existed.
 */
export function roundHandicapOf(
  row: { frozen?: number | null; override?: number | null } | null | undefined,
  member: number,
): number {
  return resolveRoundHandicap({ frozen: row?.frozen, override: row?.override, member }).handicap;
}

/** A round's row as the scoring paths read it: the committee's figure and the frozen fact, both forms. */
export interface RoundHandicapRow {
  frozen?: number | null;
  frozenExact?: number | null;
  override?: number | null;
  /** The strokes for tees of a higher par, as they stood when the round froze. See `roundParStrokesOf`. */
  frozenParStrokes?: number | null;
}

/**
 * THE STROKES FOR PLAYING TEES OF A HIGHER PAR, for one player in one round
 * (Rules of Handicapping 6.2b — see `roundPlayingHandicap` in `handicap.ts`).
 *
 * `live` is the field's own answer today, `CourseHandicaps.parStrokes(id)`.
 *
 * A ROUND THAT HAS FROZEN KEEPS WHAT IT FROZE, for the reason it freezes a
 * handicap at all: a tee moved on the roster next month must not re-score a
 * medal played last week. And a round frozen before 2026-10-13 froze none —
 * it was played and published without these strokes — so it reads nought and
 * keeps exactly the nets it was given. The fault is corrected from the next
 * round on, not by moving finishing places after the prize-giving.
 */
export function roundParStrokesOf(row: RoundHandicapRow | null | undefined, live: number): number {
  if (row && typeof row.frozen === "number") {
    return typeof row.frozenParStrokes === "number" && Number.isFinite(row.frozenParStrokes) ? row.frozenParStrokes : 0;
  }
  return Number.isFinite(live) ? live : 0;
}

/**
 * The figure an ALLOWANCE is taken of, for one player in one round.
 *
 * `roundHandicapOf` for the paths that go on to take 95%, 85% or a share of it:
 * the same three-way choice, answered before rounding. `memberExact` is
 * `CourseHandicaps.exact(id)`; with none in hand the whole number stands.
 */
export function roundHandicapExactOf(
  row: RoundHandicapRow | null | undefined,
  member: number,
  memberExact?: number | null,
): number {
  return resolveRoundHandicap({
    frozen: row?.frozen,
    frozenExact: row?.frozenExact,
    override: row?.override,
    member,
    memberExact,
  }).exact;
}

/**
 * The value to freeze for a round that is about to receive its first card.
 *
 * Deliberately the same resolution the board was already using, so freezing
 * changes nothing about the round it freezes — it only stops it changing
 * later. A freeze that computed something different would silently re-score
 * the very card that triggered it.
 */
export function handicapToFreeze(input: Omit<RoundHandicapInput, "frozen" | "frozenExact">): number {
  return resolveRoundHandicap({ ...input, frozen: null, frozenExact: null }).handicap;
}

/**
 * The unrounded figure to freeze beside it, or null where there is none to keep.
 *
 * Null for a committee's figure — it IS a whole number — so a frozen row says
 * honestly which kind it is. The same resolution as `handicapToFreeze`, so the
 * pair always describe one handicap.
 */
export function exactHandicapToFreeze(input: Omit<RoundHandicapInput, "frozen" | "frozenExact">): number | null {
  const resolved = resolveRoundHandicap({ ...input, frozen: null, frozenExact: null });
  return resolved.exact === resolved.handicap ? null : resolved.exact;
}

/**
 * Whether a card counts as RETURNED — the event that freezes a round.
 *
 * A card row is not the same thing as a card. A cut writes an empty card for
 * every survivor so the round has a field, and score entry saves a partial one
 * hole by hole; neither is a score. Freezing on the row would freeze rounds
 * that have not been played, which is how an organizer fixing a handicap a
 * fortnight before the round is told they are too late.
 *
 * One stroke is enough. A player standing on the second tee has returned
 * nothing under the Rules, but the app has already put that hole on the board
 * and priced it off a handicap — and it is the pricing this protects.
 */
export function isReturnedCard(strokes: readonly (number | null)[]): boolean {
  return strokes.some((s) => typeof s === "number" && s > 0);
}

/**
 * The key for a (round, player) row, in the order the database's own unique
 * constraint uses.
 *
 * Exported so every screen and service that indexes these rows spells the key
 * the same way. Two maps keyed differently is how one reader ends up finding an
 * override the other misses.
 */
export function roundHandicapKey(stageId: string, playerId: string): string {
  return `${stageId}:${playerId}`;
}

/**
 * What an organizer is told when a round's handicaps have already been frozen.
 *
 * One sentence, in one place, so the screen and the action say the same thing —
 * and it says WHY rather than "not allowed". An organizer who reads "cards are
 * in" knows what to do next; one who reads a refusal tries again.
 */
export const FROZEN_HANDICAP_REFUSAL =
  "Cards are in for this round, so it keeps the handicaps it was scored against. Clear the round's scores to score it again.";

/**
 * Whether a round still accepts handicap changes.
 *
 * One reader, so the screen that hides the control and the action that refuses
 * the write cannot disagree — hiding a control stops nobody from calling the
 * action, and the two drifting apart is how an organizer gets a silent no.
 */
export function acceptsHandicapChange(hasReturnedCard: boolean): boolean {
  return !hasReturnedCard;
}
