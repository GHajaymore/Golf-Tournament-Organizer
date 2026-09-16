import { describe, it, expect } from "vitest";
import { placesByValue, placesWithin } from "@/lib/domain/flight-places";

/**
 * A PLACE IS EARNED BY A SCORE, NOT BY A ROW'S POSITION IN AN ARRAY.
 *
 * Three boards printed `i + 1` beside a score. What separated two rows level
 * on that score was then the sort's last fallback, which on the three of them
 * was a cuid, a name and a name — so the number in the `#` column was
 * alphabetical order, or database order, presented as a finishing position.
 *
 * Asserted against the results sheet a club actually prints: two players level
 * share a place and the next one skips (1, 2, 2, 4), which is also what tells
 * a committee it has a play-off to run.
 */

describe("two rows level on the score share a place", () => {
  const skins = (n: number) => ({ skins: n });

  it("shares, and skips the place after a tie", () => {
    const rows = [skins(4), skins(3), skins(3), skins(1)];
    expect(placesByValue(rows, (r) => r.skins, () => true)).toEqual([1, 2, 2, 4]);
  });

  it("does not share when the scores differ by one", () => {
    const rows = [skins(4), skins(3), skins(2)];
    expect(placesByValue(rows, (r) => r.skins, () => true)).toEqual([1, 2, 3]);
  });

  it("shares a three-way tie and skips to fourth", () => {
    const rows = [skins(3), skins(3), skins(3), skins(1)];
    expect(placesByValue(rows, (r) => r.skins, () => true)).toEqual([1, 1, 1, 4]);
  });

  it("shares the lead", () => {
    // The case that decides a prize: nobody won, and the sheet must say so.
    const rows = [skins(5), skins(5), skins(2)];
    expect(placesByValue(rows, (r) => r.skins, () => true)).toEqual([1, 1, 3]);
  });
});

describe("a row that holds no position", () => {
  const side = (net: number, played: number) => ({ net, played });
  const placed = (r: { played: number }) => r.played > 0;

  it("is null rather than a number", () => {
    const rows = [side(68, 18), side(0, 0)];
    expect(placesByValue(rows, (r) => r.net, placed)).toEqual([1, null]);
  });

  it("does not take a place off the side below it", () => {
    /**
     * An unplayed row that counted would push the next real one down a place.
     * The sort puts them last so this cannot happen in practice — but a guard
     * that depends on a sort somewhere else is the kind that gets forgotten.
     */
    const rows = [side(68, 18), side(0, 0), side(70, 18)];
    expect(placesByValue(rows, (r) => r.net, placed)).toEqual([1, null, 2]);
  });

  it("does not let two sides with nothing returned share a place with each other", () => {
    // Both are on zero, which is equal, and neither has played a hole. Sharing
    // "1st" between two sides that have not teed off is the wrong answer in
    // the most visible possible way.
    const rows = [side(0, 0), side(0, 0)];
    expect(placesByValue(rows, (r) => r.net, placed)).toEqual([null, null]);
  });

  it("does not let an unplayed row join two real ones into one run", () => {
    // The run must BREAK across the gap: the last row is level with the first
    // on score, but a place is a position in a list and it is two below.
    const rows = [side(68, 18), side(0, 0), side(68, 18)];
    expect(placesByValue(rows, (r) => r.net, placed)).toEqual([1, null, 2]);
  });
});

describe("the flight renumbering still behaves, through the same reader", () => {
  it("turns overall 5, 9, 9, 14 into 1, 2, 2, 4", () => {
    // `placesWithin` now delegates to `placesByValue`, so this is the older
    // rule asserted against the shared implementation rather than a second one.
    const rows = [{ rank: 5 }, { rank: 9 }, { rank: 9 }, { rank: 14 }];
    expect(placesWithin(rows).map((r) => r.rank)).toEqual([1, 2, 2, 4]);
  });

  it("keeps every other field on the row", () => {
    const rows = [{ rank: 3, name: "A" }, { rank: 3, name: "B" }];
    expect(placesWithin(rows)).toEqual([
      { rank: 1, name: "A" },
      { rank: 1, name: "B" },
    ]);
  });
});

describe("degenerate lists", () => {
  it("returns nothing for an empty list", () => {
    expect(placesByValue([], () => 0, () => true)).toEqual([]);
  });

  it("gives a single placed row first", () => {
    expect(placesByValue([{ v: 7 }], (r) => r.v, () => true)).toEqual([1]);
  });
});
