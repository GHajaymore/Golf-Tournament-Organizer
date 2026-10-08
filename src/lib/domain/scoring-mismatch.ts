/**
 * The tournament's SCORING and the rounds' TYPES, disagreeing.
 *
 * Two settings, in two places, and only one of them decides how a result is
 * worked out:
 *
 *   `Event.format`   "match" or "stroke". Set on Tournament details, under
 *                    Scoring. This is the ONLY thing `isStroke` reads.
 *   `Stage.type`     Round Robin, Stroke Play Round, Bracket… Set on Rounds &
 *                    formats. This decides whether anybody is playing anybody.
 *
 * They can be set to opposite answers, nothing stops it, and the result is a
 * leaderboard with nothing on it.
 *
 * MEASURED, not reasoned about. On 2026-09-09 a single-round tournament was
 * built through the ordinary flow — four players, two flights, one Stroke Play
 * Round, four cards returned at 71, 72, 74 and 76. `Event.format` was still
 * "match", because it is a column default and no part of adding a round
 * touches it. The leaderboard rendered its match-points table: P, W, ½, L,
 * HOLES ±, PTS, every cell zero, the field in seed order, and the player who
 * actually shot 71 in second place. Nothing anywhere said why.
 *
 * The codebase already knows this trap. `createMatch` sets `Event.format` from
 * the plan and says so at length — "a medal round created without this line
 * has no ranked standings at all … that trap was walked into once while
 * seeding a fixture on 2026-09-07". A casual round is safe. A TOURNAMENT was
 * not, and it is the same trap through the front door.
 *
 * SO WHY WARN RATHER THAN FIX IT AUTOMATICALLY. Scoring is a real control an
 * organizer sets on purpose, and a mixed tournament — a round robin that feeds
 * a stroke-play final — is a thing clubs run. Rewriting the column whenever a
 * round changed would flip it back and forth under somebody who meant it. The
 * app's job here is to stop a contradiction shipping SILENTLY, which is the
 * part that was missing.
 *
 * Pure, so the same sentence can be shown where the mismatch is created
 * (Rounds & formats) and where it does the damage (the leaderboard) without
 * the two coming to describe it differently.
 */

/** The rounds this cares about: the ones the field actually plays. */
export interface ScoredRound {
  /** `Stage.type` — Round Robin, Stroke Play Round, and so on. */
  type: string;
  /** Whether that type pits somebody against somebody. From `isHeadToHead`. */
  headToHead: boolean;
}

export interface ScoringMismatch {
  /** What the event is set to score by. */
  scoring: "match" | "stroke";
  /** The sentence to show, naming the disagreement and the remedy. */
  message: string;
}

/**
 * Whether the event's Scoring can rank anything the rounds produce.
 *
 * Null when it can, which is the ordinary case and the answer for anything
 * this cannot be sure about — no rounds yet, or a tournament holding both
 * kinds, where "match" and "stroke" are each defensible and the organizer is
 * the one who knows which.
 */
export function scoringMismatch(
  eventFormat: string,
  rounds: readonly ScoredRound[],
): ScoringMismatch | null {
  // Nothing to disagree with yet. A tournament with no rounds is mid-setup,
  // and the rail already says so.
  if (rounds.length === 0) return null;

  const scoring: "match" | "stroke" = eventFormat === "stroke" ? "stroke" : "match";
  const anyHeadToHead = rounds.some((r) => r.headToHead);
  const allHeadToHead = rounds.every((r) => r.headToHead);

  /**
   * A MIXED tournament is not a mismatch, and it FALLS OUT of the two tests
   * below rather than being excluded by a line of its own.
   *
   * A round robin that feeds a stroke-play final has rounds of both kinds, and
   * either Scoring setting leaves one of them unranked — a real limitation of
   * one column doing this job, and not something the organizer can fix by
   * pressing the other radio button. Telling them to would be advice that does
   * not work, on a tournament that is set up correctly.
   *
   * There WAS an `if (anyHeadToHead && !allHeadToHead) return null` here, and
   * the mutation test said it was decoration: deleting it left every case
   * green, because a mixed set satisfies neither `!anyHeadToHead` nor
   * `allHeadToHead`. It is gone rather than kept as belt and braces — a
   * redundant guard is a second place for this rule to live, and the two would
   * eventually disagree. The behaviour is still pinned by its own test.
   */
  /**
   * WHAT THE MISMATCH STILL BREAKS, said as that (2026-10-08).
   *
   * These messages were written when every board ranked by this setting, so a
   * mismatch really did empty the leaderboard. Boards rank each round by its
   * OWN format now (`boardIsStroke`), and walked as the tournament grid's
   * round robin the banner read "Nothing here can be ranked" above a table
   * ranking all four players correctly. What still reads the setting is
   * whatever is DECIDED from the standings — the players a knockout is seeded
   * from and a cut is made on (`liveQualifiers`, the cut candidates) — so that
   * is what the organizer is told.
   */
  if (scoring === "match" && !anyHeadToHead) {
    return {
      scoring,
      message:
        "This tournament is set to Match play, but no round in it draws opponents. The leaderboard ranks the cards, but a knockout draw or a cut made from these standings would be made on match points that nobody has earned. Set Scoring to Stroke play on Tournament details.",
    };
  }

  if (scoring === "stroke" && allHeadToHead) {
    return {
      scoring,
      message:
        "This tournament is set to Stroke play, but every round in it is played head to head. The leaderboard ranks the matches, but a knockout draw or a cut made from these standings would be made on stroke totals that match play does not produce. Set Scoring to Match play on Tournament details.",
    };
  }

  return null;
}
