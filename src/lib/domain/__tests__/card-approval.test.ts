import { describe, it, expect } from "vitest";
import {
  reviewCards,
  approvalSummary,
  filledHoles,
  type CardForReview,
} from "../card-approval";

/**
 * The blanket approval must never be a rubber stamp.
 *
 * Every test here is really the same test asked a different way: given a card
 * a committee would want to look at, does the one-tap action leave it alone?
 * If any of these ever pass a bad card into `ready`, the certification step
 * has become decoration.
 */

const card = (over: Partial<CardForReview> = {}): CardForReview => ({
  id: "c1",
  playerId: "p1",
  playerName: "A. Moore",
  status: "certified",
  strokes: new Array(18).fill(4),
  holes: 18,
  ...over,
});

describe("filledHoles", () => {
  it("counts only within the round's length", () => {
    // An 18-length array on a 9-hole round must not report 18 played.
    const s = new Array(18).fill(4);
    expect(filledHoles(s, 9)).toBe(9);
  });

  it("ignores gaps", () => {
    const s: (number | null)[] = new Array(18).fill(4);
    s[3] = null;
    s[11] = null;
    expect(filledHoles(s, 18)).toBe(16);
  });
});

describe("what a blanket approval may take", () => {
  it("takes a complete, certified card", () => {
    const { ready, exceptions } = reviewCards([card()]);
    expect(ready).toHaveLength(1);
    expect(exceptions).toHaveLength(0);
  });

  it("refuses a card with a hole missing", () => {
    const s: (number | null)[] = new Array(18).fill(4);
    s[7] = null;
    const { ready, exceptions } = reviewCards([card({ strokes: s })]);
    expect(ready).toHaveLength(0);
    expect(exceptions[0].reason).toBe("incomplete");
    // The count is reported so the committee can see how short it is.
    expect(exceptions[0].filled).toBe(17);
    expect(exceptions[0].holes).toBe(18);
  });

  it("refuses a card nobody has certified", () => {
    const { ready, exceptions } = reviewCards([card({ status: "entered" })]);
    expect(ready).toHaveLength(0);
    expect(exceptions[0].reason).toBe("not-certified");
  });

  it("refuses a disputed card", () => {
    const { ready, exceptions } = reviewCards([card({ status: "disputed" })]);
    expect(ready).toHaveLength(0);
    expect(exceptions[0].reason).toBe("disputed");
  });

  it("reports a disputed card as disputed even when it is also short", () => {
    // The dispute is the thing to resolve; calling it "incomplete" would send
    // the committee to fix the wrong problem.
    const s: (number | null)[] = new Array(18).fill(4);
    s[0] = null;
    const { exceptions } = reviewCards([card({ status: "disputed", strokes: s })]);
    expect(exceptions[0].reason).toBe("disputed");
  });

  it("does not re-approve an approved card", () => {
    const { ready, exceptions } = reviewCards([card({ status: "approved" })]);
    expect(ready).toHaveLength(0);
    expect(exceptions[0].reason).toBe("already-approved");
  });

  it("judges a 9-hole round against nine holes, not eighteen", () => {
    const s: (number | null)[] = new Array(18).fill(null);
    for (let i = 0; i < 9; i += 1) s[i] = 4;
    const { ready } = reviewCards([card({ strokes: s, holes: 9 })]);
    expect(ready, "a complete nine must be approvable").toHaveLength(1);
  });

  it("separates a mixed field without losing anyone", () => {
    const short: (number | null)[] = new Array(18).fill(4);
    short[2] = null;
    const cards = [
      card({ id: "a", playerId: "1", playerName: "One" }),
      card({ id: "b", playerId: "2", playerName: "Two", status: "entered" }),
      card({ id: "c", playerId: "3", playerName: "Three", strokes: short }),
      card({ id: "d", playerId: "4", playerName: "Four", status: "disputed" }),
      card({ id: "e", playerId: "5", playerName: "Five" }),
    ];
    const { ready, exceptions } = reviewCards(cards);
    expect(ready.map((c) => c.id)).toEqual(["a", "e"]);
    expect(exceptions.map((e) => e.reason)).toEqual(["not-certified", "incomplete", "disputed"]);
    // Nobody may be dropped: every card is in exactly one bucket.
    expect(ready.length + exceptions.length).toBe(cards.length);
  });
});

describe("the summary states both halves", () => {
  it("names what is left behind, so approving is a decision", () => {
    const short: (number | null)[] = new Array(18).fill(4);
    short[0] = null;
    const review = reviewCards([card({ id: "a" }), card({ id: "b", strokes: short })]);
    expect(approvalSummary(review)).toBe("Approve 1 card, leaving 1 that needs attention.");
  });

  it("does not offer to approve when nothing is ready", () => {
    const review = reviewCards([card({ status: "entered" })]);
    expect(approvalSummary(review)).toContain("Nothing ready to approve");
  });

  it("says so plainly when the round is clean", () => {
    const review = reviewCards([card({ id: "a" }), card({ id: "b" })]);
    expect(approvalSummary(review)).toBe("Approve 2 cards.");
  });

  it("handles an empty round", () => {
    expect(approvalSummary(reviewCards([]))).toBe("No cards returned yet.");
  });
});
