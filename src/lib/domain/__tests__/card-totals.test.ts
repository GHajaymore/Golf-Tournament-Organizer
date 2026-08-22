import { describe, it, expect } from "vitest";
import { cardTotals, TOTAL_LABEL, type CardTotal } from "../card-totals";

/**
 * A card shows the figures its round is scored on.
 *
 * Asserted against how the competitions are actually decided rather than
 * against what the component used to render — every card showed all four
 * figures, and two of them were noise on any given round.
 */

describe("which totals a card shows", () => {
  it("shows strokes and to-par for a gross medal", () => {
    // Rule 3.3a: stroke play is won on the fewest total strokes. No handicap
    // is involved, so a net column would repeat the gross one.
    expect(cardTotals("gross")).toEqual(["gross", "toPar"]);
  });

  it("shows gross beside net for a handicap competition", () => {
    // The gross stays because it is what the player wrote in the boxes and
    // what a query is settled against — Rule 3.3b(2) makes the player
    // responsible for the hole scores, not the arithmetic.
    expect(cardTotals("net")).toEqual(["gross", "net"]);
  });

  it("shows all three when both prizes are given", () => {
    expect(cardTotals("both")).toEqual(["gross", "net", "toPar"]);
  });

  it("puts points first for a Stableford", () => {
    // Rule 21.1: Stableford is won on the HIGHEST points. Leading with
    // strokes invites reading the wrong number as the result — and the two
    // move in opposite directions, which is exactly how that misreads.
    expect(cardTotals("stableford")).toEqual(["points", "gross"]);
    expect(cardTotals("stableford")[0]).toBe("points");
  });

  it("never hides the gross", () => {
    // It is what was entered, every other figure is derived from it, and a
    // card that will not show you the number you just wrote is not a card.
    for (const basis of ["gross", "net", "both", "stableford"]) {
      expect(cardTotals(basis), basis).toContain("gross");
    }
  });

  it("falls back to gross rather than to everything", () => {
    // A card should not start claiming a net figure for a round whose scoring
    // nobody here recognises.
    for (const junk of ["", "quota points", "MODIFIED", "  "]) {
      expect(cardTotals(junk), junk).toEqual(["gross", "toPar"]);
    }
  });

  it("is case- and whitespace-insensitive, because stored values drift", () => {
    expect(cardTotals(" Stableford ")).toEqual(["points", "gross"]);
    expect(cardTotals("NET")).toEqual(["gross", "net"]);
  });

  it("has a heading for every figure it can return", () => {
    const every: CardTotal[] = ["gross", "net", "toPar", "points"];
    for (const t of every) expect(TOTAL_LABEL[t], t).toBeTruthy();
  });
});

describe("the format wins where the two settings contradict each other", () => {
  it("shows points for a Stableford whose basis still says gross", () => {
    // The ordinary way this happens: the basis is chosen, then the format is
    // changed, and nothing reconciles the two. Rule 21.1 — a Stableford is
    // won by the player with the MOST points — so strokes-first would put the
    // losing number where the result goes.
    expect(cardTotals("gross", "Stableford")).toEqual(["points", "gross"]);
    expect(cardTotals("net", "Modified Stableford")).toEqual(["points", "gross"]);
    expect(cardTotals("both", "Stableford")[0]).toBe("points");
  });

  it("lets the basis decide everything the format leaves open", () => {
    // The custom setting is not overruled generally — only where it
    // contradicts what the format IS. Stroke play is won on strokes (Rule
    // 3.3a) and says nothing about gross versus net, so the committee's
    // choice stands.
    expect(cardTotals("net", "Stroke Play")).toEqual(["gross", "net"]);
    expect(cardTotals("gross", "Stroke Play")).toEqual(["gross", "toPar"]);
    expect(cardTotals("both", "Stroke Play")).toEqual(["gross", "net", "toPar"]);
  });

  it("ignores a format it doesn't know rather than guessing at one", () => {
    expect(cardTotals("net", "Committee's Own Thing")).toEqual(["gross", "net"]);
    expect(cardTotals("net", "")).toEqual(["gross", "net"]);
  });
});
