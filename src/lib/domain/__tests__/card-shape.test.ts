import { describe, it, expect } from "vitest";
import { implausibleCard, parseCard } from "../scorecard-parse";
import { cardFrom } from "../course-directory";

/**
 * One standard for every card, however it arrives.
 *
 * These two checks were written for the directory importer and lived there,
 * which meant they guarded imports and nothing else: Green Crest's scrambled
 * card, refused on import, was accepted without complaint when pasted in by
 * hand. A check that guards one entry path guards none of them.
 *
 * Both were learned from real rows in the catalogue rather than imagined.
 */

/** Green Crest, as the public directory really returns it. */
const SORTED = [5, 5, 5, 5, 5, 4, 4, 4, 4, 4, 4, 3, 3, 3, 3, 3, 3, 3];
/** Pebble Beach, in playing order. */
const REAL = [4, 5, 4, 4, 3, 5, 3, 4, 4, 4, 4, 3, 4, 5, 4, 4, 3, 5];
const SI = [6, 10, 12, 16, 14, 2, 18, 4, 8, 3, 9, 17, 7, 1, 13, 11, 15, 5];

describe("pars in sorted order rather than hole order", () => {
  it("is caught, even though every hole and the total are fine", () => {
    // Par 70, every hole between 3 and 6, and wrong on all eighteen.
    expect(SORTED.reduce((a, b) => a + b, 0)).toBe(70);
    expect(implausibleCard(SORTED)).toContain("sorted order");
  });

  it("catches ascending as well as descending", () => {
    expect(implausibleCard([...SORTED].reverse())).toContain("sorted order");
  });

  it("leaves a flat card alone", () => {
    // Every hole par 4 is technically both ascending and descending. It is a
    // placeholder, not a shuffled routing.
    expect(implausibleCard(new Array(18).fill(4))).toBeNull();
  });

  it("leaves a real routing alone", () => {
    expect(implausibleCard(REAL)).toBeNull();
  });
});

describe("a par total nobody plays", () => {
  it("catches 79, which is in the catalogue", () => {
    const p79 = [5, 4, 5, 4, 5, 4, 5, 4, 5, 4, 5, 4, 5, 4, 4, 4, 4, 4];
    expect(p79.reduce((a, b) => a + b, 0)).toBe(79);
    expect(implausibleCard(p79)).toContain("79");
  });

  it("accepts the pars real courses play", () => {
    for (const last of [3, 4, 5]) {
      expect(implausibleCard([...REAL.slice(0, 17), last])).toBeNull();
    }
  });

  it("scales for a nine-hole card instead of refusing every one", () => {
    // Half a card is not an implausible eighteen; it is a nine.
    expect(implausibleCard(REAL.slice(0, 9), 9)).toBeNull();
    expect(implausibleCard([6, 6, 6, 6, 6, 6, 6, 6, 6], 9)).toContain("54");
  });

  it("says nothing when the row is the wrong length", () => {
    // That is the length check's job, and two complaints about one row is
    // noise where one is a diagnosis.
    expect(implausibleCard([4, 4, 4])).toBeNull();
  });
});

describe("every path is held to the same standard", () => {
  const row = (n: number[]) => n.join(" ");

  it("refuses the scrambled card whether pasted or imported", () => {
    // The bug this file exists for. Both must refuse.
    const pasted = parseCard({ pars: row(SORTED), strokeIndex: row(SI) }, 18);
    expect(pasted.ok, "pasted").toBe(false);

    const imported = cardFrom(
      SORTED.map((par, i) => ({ number: i + 1, par, handicap_index: SI[i], yardages: {} })),
    );
    expect(imported.usable, "imported").toBe(false);
  });

  it("accepts a real card whether pasted or imported", () => {
    // A guard that refuses real cards is worse than no guard at all.
    expect(parseCard({ pars: row(REAL), strokeIndex: row(SI) }, 18).ok, "pasted").toBe(true);
    expect(
      cardFrom(REAL.map((par, i) => ({ number: i + 1, par, handicap_index: SI[i], yardages: {} }))).usable,
      "imported",
    ).toBe(true);
  });
});
