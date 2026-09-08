import { describe, it, expect } from "vitest";
import { splitLabel } from "../expense-split-label";

// A plain formatter, so the assertions read as money rather than as cents.
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const even = (n: number) => Array.from({ length: n }, () => ({ weight: 1, exactCents: null }));

describe("how a bill divided", () => {
  it("shows the division, not the count", () => {
    // "6 shares" is not checkable. "$1,986.00 ÷ 6" is arithmetic somebody can
    // do in their head, which is the whole point of showing it.
    expect(splitLabel(19_86_00, even(6), money)).toBe("$1986.00 ÷ 6");
  });

  it("carries NO leading separator", () => {
    /**
     * The bug this was extracted for. It returned its own " · " while the
     * caller printed one too, so every row on the money screen read
     * "Paid by Priya Nair · · $30.00 ÷ 2".
     *
     * Asserted as "does not start with a separator" rather than by comparing
     * the whole string, so it keeps holding if the wording changes.
     */
    for (const shares of [even(1), even(4), []]) {
      const out = splitLabel(5000, shares, money);
      expect(out.startsWith("·"), `"${out}" carries its own separator`).toBe(false);
      expect(out.trimStart()).toBe(out);
    }
  });
});

describe("÷ only when the split really is even", () => {
  it("says ÷ for equal weights", () => {
    expect(splitLabel(10000, even(4), money)).toBe("$100.00 ÷ 4");
  });

  it("says ACROSS for a weighted split", () => {
    // The room-night case: 2:2:2:1. Printing "÷ 4" here would be a tidy lie —
    // the numbers do not come out, and the one person who checks stops
    // believing the rest of the screen.
    const rooms = [
      { weight: 2, exactCents: null },
      { weight: 2, exactCents: null },
      { weight: 2, exactCents: null },
      { weight: 1, exactCents: null },
    ];
    const out = splitLabel(70000, rooms, money);
    expect(out).toBe("$700.00 across 4");
    expect(out).not.toContain("÷");
  });

  it("says ACROSS when exact amounts were typed", () => {
    // Two rooms at rates that do not reduce to a ratio.
    const exact = [
      { weight: 1, exactCents: 18000 },
      { weight: 1, exactCents: 22000 },
    ];
    const out = splitLabel(40000, exact, money);
    expect(out).toBe("$400.00 across 2");
    expect(out).not.toContain("÷");
  });

  it("still says ÷ when weights are equal and above one", () => {
    // 2:2:2 IS even — the test that stops "any weight other than 1 means
    // uneven", which would print "across" over a genuinely equal split.
    const out = splitLabel(30000, [
      { weight: 2, exactCents: null },
      { weight: 2, exactCents: null },
      { weight: 2, exactCents: null },
    ], money);
    expect(out).toBe("$300.00 ÷ 3");
  });
});

describe("who counts as on the bill", () => {
  it("leaves out a zero weight, and says so when that empties the line", () => {
    // Weight zero is present and owing nothing — a different fact from never
    // having been on it, and the reason the row is not simply dropped.
    expect(splitLabel(5000, [{ weight: 0, exactCents: null }], money)).toBe("no shares");
    expect(splitLabel(5000, [], money)).toBe("no shares");
  });

  it("counts somebody carried by an exact amount at zero weight", () => {
    // An exact split sets amounts, not weights. Filtering on weight alone
    // would report "no shares" over a bill that divides perfectly well.
    const out = splitLabel(9000, [
      { weight: 0, exactCents: 4000 },
      { weight: 0, exactCents: 5000 },
    ], money);
    expect(out).toBe("$90.00 across 2");
    expect(out).not.toBe("no shares");
  });

  it("does not count a zero-weight, zero-amount person", () => {
    const out = splitLabel(9000, [
      { weight: 1, exactCents: null },
      { weight: 0, exactCents: 0 },
    ], money);
    expect(out).toBe("$90.00 ÷ 1");
  });
});
