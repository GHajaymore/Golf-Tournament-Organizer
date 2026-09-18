/**
 * WHAT IS SITTING IN THE COMMITTEE'S LAP, counted once for the whole
 * tournament.
 *
 * The dashboard has had a stat for this since matches were the only thing the
 * app scored, and it was still measuring only matches — `pendingConfirmations`
 * filtered the ACTIVE STAGE's `Match` rows and nothing else. Three things
 * followed from that, and all three were visible on the demo tournament:
 *
 *   IT WAS MISLABELLED. "36 scores to confirm" is thirty-six match RESULTS.
 *   An organizer reads it beside "Cards in 7/33" and reasonably concludes the
 *   app has lost twenty-nine scorecards.
 *
 *   IT WAS BLIND TO HALF THE TOURNAMENT. Stroke play grew a review step when
 *   `card-approval.ts` was written — Rule 3.3b, the marker certifies and the
 *   committee accepts — and this never learned about it. A pure stroke-play
 *   tournament with thirty certified cards waiting reported a queue of zero.
 *
 *   IT WAS ABOUT A DIFFERENT ROUND THAN THE CARD BESIDE IT. "Cards in" reads
 *   `boardStage`, the newest round with results on it; this read `activeStage`,
 *   the match-points chain position. Two numbers, side by side, silently about
 *   two different rounds.
 *
 * So it is counted for the WHOLE TOURNAMENT here. That is not tidiness: a
 * queue scoped to one round empties itself by the organizer moving on, and
 * `/entry`'s approval panel is per-round too, so nothing anywhere would then
 * say that week 2 still has eleven results nobody signed off. A number that
 * can silently drop work is worse than no number.
 *
 * Pure. The caller supplies the rows and whether this tournament has a
 * reviewer at all.
 */

export interface ReviewQueue {
  /** Completed matches whose result nobody has confirmed. */
  matches: number;
  /** Certified scorecards the committee has not accepted. */
  cards: number;
  total: number;
  /**
   * Cards and match results somebody has said are WRONG. Not in `total`.
   *
   * Kept out of the queue on purpose — see `cardAwaitsReview`: approving a
   * disputed result is exactly what must not happen, and the place to settle
   * one is the card or the match, not a sign-off list. But being out of the
   * queue made them invisible to the one other thing that read it:
   * `finishRefusal` gated completing a tournament on `total` alone, so a
   * tournament could be marked FINISHED — standings published as final — with
   * a card still in dispute. Found on the look-at-screens fixture, 2026-09-18,
   * where Sang-woo Kim's 18-hole card is disputed and the dashboard's own
   * sentence said only one card stood between the organizer and finishing.
   *
   * Rule 20.2c: a question about a result is decided by the Committee, and the
   * result is final only when it has been. So this is counted separately and
   * handed to the finish gate by name.
   */
  disputed: number;
}

/**
 * Whether one scorecard is waiting for a COMMITTEE, as opposed to a player.
 *
 * Two conditions, and the first is the one that is easy to miss.
 *
 * `staffApproves` false means this round has no reviewer — `card-approval.ts`
 * records what that costs at length: "a card really does STOP at certified
 * there", because `allowsAutoConfirm` governs MATCH confirmation and nothing
 * ever moves a scorecard on. Counting those would put a permanent number on
 * an organizer's dashboard for work that does not exist and cannot be done,
 * which is how a queue stops being read.
 *
 * And `certified`, not merely un-approved. An `entered` card is waiting on the
 * MARKER — the player who has not signed it yet — and telling an organizer to
 * act on it points them at something only somebody else can move. It still
 * appears on the round's own approval panel, correctly, as an exception; it is
 * just not the committee's queue.
 *
 * A `disputed` card is deliberately out. It is a real problem and it is not a
 * sign-off: approving it is exactly what must not happen, and the screen that
 * resolves it is the card, not the queue.
 */
export function cardAwaitsReview(status: string, staffApproves: boolean): boolean {
  return staffApproves && status === "certified";
}

/**
 * Everything waiting, from both sources.
 *
 * Matches arrive already reduced to "is it finished" and "what does its status
 * effectively say" — `resolveMatch` and `effectiveScoreStatus` both live in
 * layers this module must not reach into, and re-deriving either here is how
 * two answers to one question start to differ.
 */
export function reviewQueue(input: {
  /**
   * `status` is the EFFECTIVE one — what `effectiveScoreStatus` made of the
   * stored value and the clock — as a plain string, because the union it
   * belongs to lives in the service layer and a domain module reaching up into
   * that is the inversion this directory exists to avoid.
   */
  matches: ReadonlyArray<{
    complete: boolean;
    status: string;
    /**
     * True when the stored holes could not be read at all. The service
     * reports those as "disputed" so no queue can clear them — but nobody
     * DISPUTED them, and counting them as disputes would let one corrupt row
     * block finishing a tournament for ever, with a remedy no organizer has.
     */
    unreadable?: boolean;
  }>;
  cards: ReadonlyArray<{ status: string }>;
  /** Whether a committee signs things off in this tournament at all. */
  staffApproves: boolean;
}): ReviewQueue {
  /**
   * A match counts when it is FINISHED and still pending.
   *
   * Both halves matter and the first is the older rule: a match one hole old
   * is not a result anybody can confirm, and `matchSettled` being satisfied by
   * a single hole is a trap this codebase already records against the money
   * screens.
   */
  const matches = input.matches.filter((m) => m.complete && m.status === "pending").length;
  const cards = input.cards.filter((c) => cardAwaitsReview(c.status, input.staffApproves)).length;
  // Whether or not this tournament has a reviewer: a dispute is a claim that a
  // result is wrong, and that is true with or without a committee queue.
  const disputed =
    input.cards.filter((c) => c.status === "disputed").length +
    input.matches.filter((m) => m.status === "disputed" && !m.unreadable).length;
  return { matches, cards, total: matches + cards, disputed };
}

/**
 * What the queue is made of, for the line under the number.
 *
 * Said in the right words for each source rather than collapsed into one:
 * "scores" was the word that made thirty-six match results read as thirty-six
 * scorecards, and the fix is not a better single noun — it is naming both.
 */
export function reviewQueueDetail(q: ReviewQueue): string {
  const parts: string[] = [];
  if (q.cards > 0) parts.push(`${q.cards} ${q.cards === 1 ? "card" : "cards"}`);
  if (q.matches > 0) {
    parts.push(`${q.matches} match ${q.matches === 1 ? "result" : "results"}`);
  }
  // Not "0 to confirm": the number above already says none, and a stat card
  // that repeats its own zero in words reads as an error state.
  return parts.length === 0 ? "nothing waiting" : `${parts.join(" · ")} to confirm`;
}
