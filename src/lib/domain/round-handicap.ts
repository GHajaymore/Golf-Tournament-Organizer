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

/** Where a round's handicap came from, most specific first. */
export type HandicapSource = "frozen" | "override" | "member";

export interface RoundHandicapInput {
  /** What this round was scored against, once its first card landed. */
  frozen?: number | null;
  /** The committee's decision for this round, set before play. */
  override?: number | null;
  /** The roster's handicap for this player. The default. */
  member: number;
}

export interface ResolvedRoundHandicap {
  handicap: number;
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
  typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;

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
      source: "frozen",
      editable: false,
      differsFromCurrent: frozen === current ? null : current,
    };
  }

  if (override !== null) {
    return { handicap: override, source: "override", editable: true, differsFromCurrent: null };
  }

  return { handicap: member, source: "member", editable: true, differsFromCurrent: null };
}

/**
 * The value to freeze for a round that is about to receive its first card.
 *
 * Deliberately the same resolution the board was already using, so freezing
 * changes nothing about the round it freezes — it only stops it changing
 * later. A freeze that computed something different would silently re-score
 * the very card that triggered it.
 */
export function handicapToFreeze(input: Omit<RoundHandicapInput, "frozen">): number {
  return resolveRoundHandicap({ ...input, frozen: null }).handicap;
}

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
