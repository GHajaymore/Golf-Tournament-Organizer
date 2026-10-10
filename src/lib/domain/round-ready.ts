/**
 * IS THIS ROUND READY FOR THE COMMITTEE TO CLOSE? (2026-10-08)
 *
 * A stroke-play result becomes official when the committee closes the round
 * (decided 2026-10-08): every card in reads "All in · unofficial" on the
 * public board, and only closing it says Final. That made closing the act
 * that finishes a round — and the only door to it was a checkbox on Rounds &
 * formats, a setup screen nobody opens on the day. So the dashboard asks, the
 * moment there is nothing left to wait for.
 *
 * Ready means everything the round is owed has come back in its own unit
 * (cards, sides, matches or ties — `boardProgress`), and, where the club has
 * the committee accept cards, every card has been accepted: closing over a
 * card still waiting for review would declare a result nobody has checked. A
 * round scored by hand, or one already closed, is never "ready" here.
 */
export interface RoundReadyInput {
  unit: "cards" | "matches" | "sides" | "ties" | "manual";
  total: number;
  /** Returned: certified or approved cards, sides complete, matches over. */
  certified: number;
  approved: number;
  /** The club has staff accept cards (`reviewsScores`). Cards only. */
  needsApproval: boolean;
  closed: boolean;
  /** Somebody is out on the course: cards begun. Absent from older callers. */
  started?: number;
  /**
   * The committee has prepared the NEXT round — its sheet published or cards
   * in. See `missingFromRound`.
   */
  nextRoundReady?: boolean;
}

/**
 * WHO NEVER STARTED A CARD, when that is all the round is waiting for
 * (2026-10-10).
 *
 * A league night has no-shows. Twenty members away in week 2 meant the week
 * was never "all in", so it never asked to be closed — and an open week 2 kept
 * every absentee's My card on it, so the first of them to score week 3 typed
 * it into the week they had missed. Walked on a three-week, 120-member league.
 *
 * Absent cards alone are not enough to call a round over: at noon on a medal
 * day the morning wave is all in and the afternoon has not teed off. What is
 * enough is the committee having moved on — the next round's draw out or its
 * cards coming in — while every card that WAS begun has come back (and been
 * accepted, where the club accepts cards). Then the ones with no card did not
 * play, and the prompt says how many. Zero when that is not the state.
 */
export function missingFromRound(r: RoundReadyInput): number {
  const started = r.started ?? 0;
  if (!r.nextRoundReady || r.unit !== "cards" || started <= 0 || started >= r.total) return 0;
  if (r.certified < started) return 0;
  if (r.needsApproval && r.approved < started) return 0;
  return r.total - started;
}

export function roundReadyToClose(r: RoundReadyInput): boolean {
  // Not a knockout either: its results are the draw, and a decided final is
  // the end of the TOURNAMENT — the dashboard's Complete, not a round's close.
  if (r.closed || r.unit === "manual" || r.unit === "ties" || r.total <= 0) return false;
  if (missingFromRound(r) > 0) return true;
  if (r.certified < r.total) return false;
  if (r.unit === "cards" && r.needsApproval && r.approved < r.total) return false;
  return true;
}

/** What "everything is in" is called for this round — a card, a side's card or a match. */
export function roundReadyWord(unit: RoundReadyInput["unit"]): string {
  return unit === "matches" ? "Every match is finished" : unit === "sides" ? "Every side's card is in" : "Every card is in";
}
