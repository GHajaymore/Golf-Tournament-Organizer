import { describe, it, expect } from "vitest";
import { cardIsFinal, cutBlockers, cutBlockedSentence, roundReadyForCut, cutRuleWords, cutRuleOf } from "@/lib/domain/cut-ready";

/**
 * A CUT IS MADE ON RESULTS, AND THE ORGANIZER APPROVES IT.
 *
 * Ajay, 2026-10-05: "Cut can't be final unless organizer approve all cards and
 * approve the Cut." A card is a result once the committee has APPROVED it —
 * or, where the tournament has no committee step (`scoreApproval: "players"`),
 * once it is signed. A cut on anything less is one the committee may have to
 * unpick after somebody has been sent home.
 */

const STROKE = { type: "Stroke Play Round", format: "Individual Stroke Play" };
const round = (id: string, over: Partial<{ cutEnabled: boolean; closedAt: Date | null; format: string }> = {}) => ({
  id,
  ...STROKE,
  cutEnabled: false,
  closedAt: null as Date | null,
  ...over,
});
const played = JSON.stringify([4, 4, 4]);
const blank = JSON.stringify([null, null, null]);

describe("what a cut may be made on", () => {
  it("is an approved card wherever a committee reviews", () => {
    expect(cardIsFinal("approved", true)).toBe(true);
    expect(cardIsFinal("certified", true)).toBe(false);
    expect(cardIsFinal("entered", true)).toBe(false);
    expect(cardIsFinal("disputed", true)).toBe(false);
  });

  it("is a signed card where nobody reviews it", () => {
    expect(cardIsFinal("certified", false)).toBe(true);
    expect(cardIsFinal("approved", false)).toBe(true);
    expect(cardIsFinal("entered", false)).toBe(false);
    expect(cardIsFinal("disputed", false)).toBe(false);
  });
});

describe("what stands in the way of the cut", () => {
  const cards = [
    { status: "approved", strokes: played },
    { status: "certified", strokes: played },
    { status: "entered", strokes: played },
    { status: "disputed", strokes: played },
    // An empty card is nobody's round yet — not a card to wait on.
    { status: "entered", strokes: blank },
  ];

  it("counts each card that is not yet a result, by why", () => {
    // Where a committee reviews, signed or not, an unapproved card is waiting
    // on the committee — the organizer may have typed it in from paper.
    expect(cutBlockers(cards, true)).toEqual({ awaitingApproval: 2, notReturned: 0, disputed: 1, total: 3 });
  });

  it("does not wait for an approval nobody gives where players confirm", () => {
    expect(cutBlockers(cards, false)).toEqual({ awaitingApproval: 0, notReturned: 1, disputed: 1, total: 2 });
  });

  it("is nothing once every card is approved — the control", () => {
    expect(cutBlockers([{ status: "approved", strokes: played }], true).total).toBe(0);
  });

  it("says which cards and why, and that closing makes the cut", () => {
    const s = cutBlockedSentence(cutBlockers(cards, true), "Round 1");
    expect(s).toContain("2 cards need your approval");
    expect(s).toContain("1 card is disputed");
    expect(s).toContain("Closing Round 1 makes the cut");
    expect(cutBlockedSentence(cutBlockers(cards, false), "Round 1")).toContain("1 card hasn't been signed by the player");
  });
});

describe("when the dashboard asks for the cut", () => {
  const rounds = [round("r1"), round("r2", { cutEnabled: true })];

  it("asks once every card in the cut round is final", () => {
    expect(roundReadyForCut(rounds, () => ({ final: 16, total: 16 }))?.feeder.id).toBe("r1");
  });

  it("waits while one is not", () => {
    expect(roundReadyForCut(rounds, () => ({ final: 15, total: 16 }))).toBeNull();
  });

  it("never asks over an empty field", () => {
    expect(roundReadyForCut(rounds, () => ({ final: 0, total: 0 }))).toBeNull();
  });

  it("stops asking once the round is closed — the cut is made", () => {
    const closed = [round("r1", { closedAt: new Date() }), round("r2", { cutEnabled: true })];
    expect(roundReadyForCut(closed, () => ({ final: 16, total: 16 }))).toBeNull();
  });

  it("asks nothing where the next round has no cut", () => {
    expect(roundReadyForCut([round("r1"), round("r2")], () => ({ final: 16, total: 16 }))).toBeNull();
  });

  it("asks about the second cut once the first is made", () => {
    const three = [round("r1", { closedAt: new Date() }), round("r2", { cutEnabled: true }), round("r3", { cutEnabled: true })];
    expect(roundReadyForCut(three, () => ({ final: 8, total: 8 }))?.feeder.id).toBe("r2");
  });
});

describe("the rule, in the committee's words", () => {
  it("names the number, the flights and the ties", () => {
    expect(cutRuleWords(cutRuleOf({ cutScope: "overall", cutMode: "count", cutCount: 16, cutPercent: 0 }))).toBe("Top 16 and ties");
    expect(cutRuleWords(cutRuleOf({ cutScope: "perFlight", cutMode: "percent", cutCount: 0, cutPercent: 25 }))).toBe(
      "Top 25% in each flight and ties",
    );
  });
});
