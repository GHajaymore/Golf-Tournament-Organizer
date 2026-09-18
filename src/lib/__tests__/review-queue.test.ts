import { describe, it, expect } from "vitest";
import { reviewQueue, reviewQueueDetail, cardAwaitsReview } from "../domain/review-queue";

/**
 * THE ORGANIZER'S QUEUE COUNTS BOTH KINDS OF RESULT, AND SAYS WHICH.
 *
 * Read off the demo tournament on 2026-09-12: the dashboard printed
 *
 *     Cards in         7/33   21% submitted
 *     Awaiting review  36     scores to confirm
 *
 * Every number is right and the pair is misleading. The 36 are match RESULTS
 * from the round robin; the 7 are scorecards from a stroke round. They are
 * different rounds, counted by different rules, sitting side by side under
 * words that make the second read as twenty-nine lost scorecards.
 *
 * THE COUNTS ARE DELIBERATELY UNEQUAL IN EVERY FIXTURE BELOW. Three matches
 * and five cards, never three and three — a queue that swapped its two halves,
 * or counted one of them twice, is a change that passes any fixture where the
 * two numbers happen to match.
 */

/** A finished match nobody has signed off. */
const pendingMatch = { complete: true, status: "pending" };

describe("what is waiting for a sign-off", () => {
  it("counts finished matches and certified cards together", () => {
    const q = reviewQueue({
      matches: [pendingMatch, pendingMatch, pendingMatch],
      cards: [
        { status: "certified" },
        { status: "certified" },
        { status: "certified" },
        { status: "certified" },
        { status: "certified" },
      ],
      staffApproves: true,
    });
    // Both halves named, so a swap is visible — 3 and 5, not 8 and a shrug.
    expect(q.matches).toBe(3);
    expect(q.cards).toBe(5);
    expect(q.total).toBe(8);
  });

  it("was blind to the cards, which is the bug", () => {
    /**
     * A PURE STROKE-PLAY TOURNAMENT. No `Match` rows exist at all, so the old
     * rule — filter the active stage's matches — could only ever return zero,
     * however many certified cards were waiting. Thirty organizers' review
     * queues reported as empty while thirty cards sat in them.
     */
    const q = reviewQueue({
      matches: [],
      cards: Array.from({ length: 30 }, () => ({ status: "certified" })),
      staffApproves: true,
    });
    expect(q.total, "a stroke tournament's queue read as empty").toBe(30);
  });

  it("leaves a match alone until it is finished", () => {
    /**
     * A match one hole old is not a result anybody can confirm. This codebase
     * already carries the scar on the money side, where `matchSettled` is
     * satisfied by a single hole and was far too loose to release money by.
     */
    const q = reviewQueue({
      matches: [
        { complete: false, status: "pending" },
        { complete: false, status: "pending" },
        pendingMatch,
      ],
      cards: [],
      staffApproves: true,
    });
    expect(q.matches).toBe(1);
  });

  it("leaves a match alone once somebody has signed it off", () => {
    // The control for the test above: finished is necessary and not sufficient.
    const q = reviewQueue({
      matches: [
        { complete: true, status: "confirmed" },
        { complete: true, status: "auto-confirmed" },
        { complete: true, status: "disputed" },
        pendingMatch,
      ],
      cards: [],
      staffApproves: true,
    });
    expect(q.matches).toBe(1);
  });
});

describe("which cards belong to the committee", () => {
  it("takes a certified card and nothing else", () => {
    /**
     * An `entered` card is waiting on the MARKER — the player who has not
     * signed it. Putting it in an organizer's queue points them at work only
     * somebody else can do, and a queue with permanently unclearable rows in
     * it is a queue nobody reads.
     *
     * An `approved` card is finished. A `disputed` one is a problem to resolve
     * on the card, and approving it is the one thing that must not happen.
     */
    expect(cardAwaitsReview("certified", true)).toBe(true);
    expect(cardAwaitsReview("entered", true)).toBe(false);
    expect(cardAwaitsReview("approved", true)).toBe(false);
    expect(cardAwaitsReview("disputed", true)).toBe(false);
  });

  it("counts none of them where no committee exists", () => {
    /**
     * `card-approval.ts` states it outright: in a round on player confirmation
     * "a card really does STOP at certified", because `allowsAutoConfirm`
     * governs MATCH confirmation and nothing ever moves a scorecard on. So
     * those certified cards are not a backlog — they are finished, and putting
     * a number on them would be the dashboard asking for work that cannot be
     * done and will never go away.
     */
    expect(cardAwaitsReview("certified", false)).toBe(false);
    const q = reviewQueue({
      matches: [pendingMatch, pendingMatch, pendingMatch],
      cards: [{ status: "certified" }, { status: "certified" }, { status: "certified" }, { status: "certified" }, { status: "certified" }],
      staffApproves: false,
    });
    expect(q.cards).toBe(0);
    // And the matches are untouched by it — the flag governs cards only, which
    // is what stops this becoming "turn the whole queue off".
    expect(q.matches).toBe(3);
    expect(q.total).toBe(3);
  });
});

describe("disputes are counted, and kept out of the sign-off queue", () => {
  /**
   * The look-at-screens fixture, as it stood on 2026-09-18: one card on the
   * course, one certified, one approved, one DISPUTED after eighteen holes.
   * The dashboard said a single card stood between the organizer and
   * finishing, and the finish gate agreed — because it read `total`, and the
   * disputed card is deliberately not in `total`.
   */
  const FIXTURE = {
    cards: [{ status: "entered" }, { status: "certified" }, { status: "approved" }, { status: "disputed" }],
    matches: [],
    staffApproves: true,
  };

  it("counts the disputed card, separately from the queue", () => {
    const q = reviewQueue(FIXTURE);
    expect(q.total, "a dispute is not something to approve from a list").toBe(1);
    expect(q.disputed).toBe(1);
  });

  it("counts a disputed match result too", () => {
    const q = reviewQueue({
      cards: [],
      matches: [
        { complete: true, status: "disputed" },
        { complete: true, status: "pending" },
        { complete: true, status: "confirmed" },
      ],
      staffApproves: true,
    });
    expect(q.disputed).toBe(1);
    expect(q.total).toBe(1);
  });

  it("counts disputes even where nobody reviews results", () => {
    // `staffApproves` false empties the QUEUE, because nobody is there to
    // work it. It does not make a claim that a score is wrong go away.
    expect(reviewQueue({ ...FIXTURE, staffApproves: false }).disputed).toBe(1);
  });

  it("does not count a row it could not read as a dispute", () => {
    // Unreadable holes come back from the service as "disputed" so no queue
    // clears them. Nobody disputed them, and counting them would let one
    // corrupt row block finishing for ever.
    const q = reviewQueue({
      cards: [],
      matches: [{ complete: false, status: "disputed", unreadable: true }],
      staffApproves: true,
    });
    expect(q.disputed).toBe(0);
  });
});

describe("the line under the number", () => {
  it("names both sources rather than calling everything a score", () => {
    // The actual defect: "scores to confirm" over thirty-six match results.
    const detail = reviewQueueDetail({ matches: 36, cards: 5, total: 41, disputed: 0 });
    expect(detail).toContain("36 match results");
    expect(detail).toContain("5 cards");
    expect(detail, "a match result is not a score").not.toMatch(/\bscores\b/);
  });

  it("says only the half that exists", () => {
    // A round robin has no cards and a medal has no matches; "0 cards · 36
    // match results" is a queue reporting its own empty half.
    expect(reviewQueueDetail({ matches: 36, cards: 0, total: 36, disputed: 0 })).toBe("36 match results to confirm");
    expect(reviewQueueDetail({ matches: 0, cards: 5, total: 5, disputed: 0 })).toBe("5 cards to confirm");
  });

  it("counts one of each in the singular", () => {
    expect(reviewQueueDetail({ matches: 1, cards: 1, total: 2, disputed: 0 })).toBe("1 card · 1 match result to confirm");
  });

  it("says nothing is waiting rather than repeating a zero", () => {
    // The number above already reads 0. "0 to confirm" underneath it reads as
    // an error state rather than an empty one.
    expect(reviewQueueDetail({ matches: 0, cards: 0, total: 0, disputed: 0 })).toBe("nothing waiting");
  });
});
