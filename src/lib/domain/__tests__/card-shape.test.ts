import { describe, it, expect } from "vitest";
import { implausibleCard, parseCard, cardRefusal } from "../scorecard-parse";
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


describe("courses that are real but do not look regulation", () => {
  /**
   * These were all refused until the checks were extended to hand-entered
   * cards and somebody tried to type one in. A guard that turns away a real
   * golf course is worse than no guard: it tells a club their course does not
   * exist, and there is nothing they can do about it.
   */
  const si9 = Array.from({ length: 9 }, (_, i) => i + 1);
  const si18 = Array.from({ length: 18 }, (_, i) => i + 1);

  it("accepts a nine-hole par-3 course", () => {
    // Par 27. Executive and short courses are everywhere.
    expect(implausibleCard(new Array(9).fill(3), 9)).toBeNull();
    expect(cardRefusal(new Array(9).fill(3), [], si9, 9)).toBeNull();
  });

  it("accepts an eighteen-hole par-3 course", () => {
    // Par 54, by construction rather than by a row slipping out of line.
    expect(implausibleCard(new Array(18).fill(3), 18)).toBeNull();
    expect(cardRefusal(new Array(18).fill(3), [], si18, 18)).toBeNull();
  });

  it("accepts an executive nine that happens to run short to long", () => {
    // 3,3,3,3,4,4,4,5,5 is monotonic, and at nine holes that is coincidence
    // rather than evidence — there are only nine values and three pars.
    expect(implausibleCard([3, 3, 3, 3, 4, 4, 4, 5, 5], 9)).toBeNull();
  });

  it("still refuses a sorted EIGHTEEN, which is where the evidence is strong", () => {
    // Green Crest. Five 5s, six 4s, seven 3s — no course is laid out this way.
    const sorted = [5, 5, 5, 5, 5, 4, 4, 4, 4, 4, 4, 3, 3, 3, 3, 3, 3, 3];
    expect(implausibleCard(sorted, 18)).toContain("sorted order");
  });

  it("still refuses a uniform card that is not pars at all", () => {
    // Only par 3 gets the exemption. Nine 6s is a row of something else.
    expect(implausibleCard(new Array(9).fill(6), 9)).toContain("54");
    expect(implausibleCard(new Array(18).fill(5), 18)).toContain("90");
  });
});