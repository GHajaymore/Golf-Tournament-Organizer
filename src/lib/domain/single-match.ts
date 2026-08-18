/**
 * The Single Match Stage — one match, paired by a rule rather than by hand.
 *
 * The stage type has been in the picker since the beginning and has never
 * done anything: `generatesPairings: false`, and no code path creates its
 * match. An organizer could add it, save it, and find an empty round.
 *
 * It needs no new scoring engine. A single match IS a round robin of one —
 * the entry modes, the approval flow, forfeits, the Nassau and the standings
 * all work on a `Match` row and do not care how the pairing was arrived at.
 * What was missing is the pairing.
 *
 * So the stage stores HOW to pick the two players, not WHICH two:
 *
 *   - `seeds` — the 1st and 2nd of the standings so far. A play-off for the
 *     title, or a play-in for the last bracket place.
 *   - `stage-winners` — the winner of round X against the winner of round Y.
 *     A cross-flight final, which is the shape a club actually runs.
 *   - `named` — two players an organizer picked. An exhibition, or a decider
 *     between two people the standings cannot separate.
 *
 * **Resolved late, never stored early.** The pairing is worked out when the
 * round is opened, from the standings as they are then. A pair written down
 * when the stage was created goes stale the moment a score upstream is
 * corrected — which is exactly the published-tee-sheet drift of D12 wearing a
 * different hat, and would put two players in a final that the results no
 * longer support.
 */

export type SingleMatchRule =
  | { kind: "seeds"; a: number; b: number }
  | { kind: "stage-winners"; a: string; b: string }
  | { kind: "named"; a: string; b: string };

export const SINGLE_MATCH_KINDS: SingleMatchRule["kind"][] = ["seeds", "stage-winners", "named"];

/** The default a new Single Match Stage gets: first against second. */
export const DEFAULT_SINGLE_MATCH_RULE: SingleMatchRule = { kind: "seeds", a: 1, b: 2 };

/**
 * Read a stored rule.
 *
 * Anything unreadable resolves to null rather than to a default, and the
 * caller reports it. Falling back to "1 v 2" for a rule somebody wrote as
 * "winners of rounds 2 and 3" would quietly run a different match from the
 * one the committee announced.
 */
export function parseSingleMatchRule(json: string): SingleMatchRule | null {
  if (!json?.trim()) return null;
  try {
    const raw = JSON.parse(json) as Partial<SingleMatchRule> & { kind?: string };
    if (raw.kind === "seeds") {
      const a = Number((raw as { a?: unknown }).a);
      const b = Number((raw as { b?: unknown }).b);
      if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b < 1 || a === b) return null;
      return { kind: "seeds", a, b };
    }
    if (raw.kind === "stage-winners" || raw.kind === "named") {
      const a = String((raw as { a?: unknown }).a ?? "").trim();
      const b = String((raw as { b?: unknown }).b ?? "").trim();
      if (!a || !b || a === b) return null;
      return { kind: raw.kind, a, b };
    }
    return null;
  } catch {
    return null;
  }
}

export interface SingleMatchContext {
  /**
   * The standings, best first, as player ids — only players who have actually
   * posted something. A seed rule reads positions off this.
   */
  standingIds: string[];
  /** The winner of a given stage, or null when it has not produced one. */
  winnerOfStage: (stageId: string) => string | null;
  /** Everyone eligible to be in the match. */
  fieldIds: string[];
}

export interface SingleMatchPairing {
  playerAId: string;
  playerBId: string;
}

export interface SingleMatchResolution {
  pairing: SingleMatchPairing | null;
  /**
   * Why there is no pairing yet, in words an organizer can act on. Empty when
   * there is one.
   *
   * "Not ready" is the ordinary state for most of a tournament — the final
   * cannot know its players until the rounds before it are done — so this is
   * an explanation rather than an error.
   */
  problem: string;
}

/**
 * Work out who plays, from the rule and the tournament as it stands.
 *
 * Never guesses. A rule that cannot be satisfied yet produces no pairing and
 * says why, because a match invented from an incomplete standing is worse
 * than an empty round: the empty round is obviously not ready, and the
 * invented one looks finished.
 */
export function resolveSingleMatch(
  rule: SingleMatchRule | null,
  ctx: SingleMatchContext,
): SingleMatchResolution {
  const none = (problem: string): SingleMatchResolution => ({ pairing: null, problem });
  if (!rule) return none("This round has no pairing rule set — choose who plays it.");

  const inField = new Set(ctx.fieldIds);

  if (rule.kind === "seeds") {
    const needed = Math.max(rule.a, rule.b);
    if (ctx.standingIds.length < needed) {
      return none(
        `Waiting on the standings — this round is ${rule.a === 1 && rule.b === 2 ? "first against second" : `seed ${rule.a} against seed ${rule.b}`}, and only ${ctx.standingIds.length} ${ctx.standingIds.length === 1 ? "player has" : "players have"} a score so far.`,
      );
    }
    const a = ctx.standingIds[rule.a - 1];
    const b = ctx.standingIds[rule.b - 1];
    if (!a || !b || a === b) return none("The standings can't fill both places yet.");
    return { pairing: { playerAId: a, playerBId: b }, problem: "" };
  }

  if (rule.kind === "stage-winners") {
    const a = ctx.winnerOfStage(rule.a);
    const b = ctx.winnerOfStage(rule.b);
    if (!a || !b) {
      return none("Waiting on the earlier rounds — this round is played by their winners, and one hasn't finished.");
    }
    if (a === b) {
      // The same player won both. Real, and not something to paper over.
      return none("The same player won both of those rounds, so there is nobody for them to play.");
    }
    return { pairing: { playerAId: a, playerBId: b }, problem: "" };
  }

  // named
  if (!inField.has(rule.a) || !inField.has(rule.b)) {
    return none("One of the players chosen for this round is no longer in the field.");
  }
  return { pairing: { playerAId: rule.a, playerBId: rule.b }, problem: "" };
}

/** How the rule reads on screen, for the round header and the rules sheet. */
export function describeSingleMatchRule(
  rule: SingleMatchRule | null,
  nameOf: (id: string) => string,
  roundLabelOf: (stageId: string) => string,
): string {
  if (!rule) return "No pairing set";
  if (rule.kind === "seeds") {
    return rule.a === 1 && rule.b === 2
      ? "First against second in the standings"
      : `Seed ${rule.a} against seed ${rule.b}`;
  }
  if (rule.kind === "stage-winners") {
    return `Winner of ${roundLabelOf(rule.a)} against winner of ${roundLabelOf(rule.b)}`;
  }
  return `${nameOf(rule.a)} against ${nameOf(rule.b)}`;
}
