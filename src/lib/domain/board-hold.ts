/**
 * A DISPUTED RESULT IS HELD OFF THE BOARD (2026-11-04).
 *
 * Proved on real rows before it was written
 * (`a-disputed-result-stays-off-the-board.audit.test.ts`): the final result
 * (`roundOutcomesFor`) skipped a card whose status was "disputed", and the live
 * board — `loadEventStateUncached`, read by the console's leaderboard and the
 * public share link alike — ranked every card the event held. One stroke round,
 * Ann's accepted 72 and Bea's disputed 70: the result said Ann, both boards
 * said Bea.
 *
 * A dispute is somebody saying the numbers are wrong, and under Rule 20.2c the
 * Committee decides it. Until it has, the result is not one anybody can rank:
 * not on the live board, not in the day's result, not in a cup's points. The
 * card or match is still THERE — it is listed, counted as disputed by the
 * review queue, and blocks finishing the tournament (`finishRefusal`) — it
 * just does not score.
 *
 * ONE rule for both tables a dispute is filed in: `Scorecard.status` and
 * `Match.scoreStatus` both say "disputed". Every standings reader asks this —
 * never `!== "disputed"` spelled out (`board-hold-is-one-rule.test.ts` sweeps
 * for that shape) — so a reader written later holds a dispute without knowing
 * this file exists only if it reads through `onBoard` / `cardsOnBoard`.
 *
 * Counters that REPORT a dispute (the review queue's `disputed`, the round's
 * progress) must NOT ask this: their job is to see it.
 *
 * Pure.
 */

/** Whether a card or a match result in this state is kept off every board. */
export function heldFromBoard(status: string | null | undefined): boolean {
  return (status ?? "").trim() === "disputed";
}

/**
 * A MATCH AS THE BOARD MAY READ IT: a held result is read as not yet played.
 *
 * Blanked rather than dropped, so a board that lists the round's matches still
 * lists this one (as level, not started) and a reader counting the draw counts
 * it — "count what there SHOULD be, not the rows that exist". A forfeit is a
 * result too, and is held with the holes.
 */
export function onBoard<M extends { scoreStatus: string; holes: string; forfeitedBy?: string }>(match: M): M {
  if (!heldFromBoard(match.scoreStatus)) return match;
  return { ...match, holes: "[]", ...(match.forfeitedBy !== undefined ? { forfeitedBy: "" } : {}) };
}

/** The cards a board may rank: everything but a card held in dispute. */
export function cardsOnBoard<C extends { status: string }>(cards: readonly C[]): C[] {
  return cards.filter((c) => !heldFromBoard(c.status));
}
