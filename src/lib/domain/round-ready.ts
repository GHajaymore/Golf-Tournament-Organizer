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
}

export function roundReadyToClose(r: RoundReadyInput): boolean {
  if (r.closed || r.unit === "manual" || r.total <= 0) return false;
  if (r.certified < r.total) return false;
  if (r.unit === "cards" && r.needsApproval && r.approved < r.total) return false;
  return true;
}
