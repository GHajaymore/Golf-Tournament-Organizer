import { describe, expect, it } from "vitest";
import { cardLine, cardLineText } from "@/lib/domain/card-line";

/**
 * A ball's gross and net, worked by hand from the allocation rule (Rule 6.2,
 * strokes received on the holes of lowest stroke index first) rather than by
 * the function under test.
 */
const SI9 = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const fives = (n: number) => Array.from({ length: 9 }, (_, h) => (h < n ? 5 : null));

describe("one ball's gross and net", () => {
  it("a full nine off 4: four strokes, on the four hardest holes", () => {
    expect(cardLine({ name: "Ann", strokes: fives(9), playing: 4, strokeIndex: SI9, holeCount: 9 })).toEqual({
      name: "Ann",
      gross: 45,
      net: 41,
      thru: 9,
    });
  });

  it("part-way round: only the strokes on the holes played come off", () => {
    // Holes 1-3 are SI 1-3, and she receives on all three.
    expect(cardLine({ name: "Ann", strokes: fives(3), playing: 4, strokeIndex: SI9, holeCount: 9 })).toEqual({
      name: "Ann",
      gross: 15,
      net: 12,
      thru: 3,
    });
    // The same three holes at the EASY end of the card receive nothing.
    const easyFirst = [9, 8, 7, 6, 5, 4, 3, 2, 1];
    expect(cardLine({ name: "Ann", strokes: fives(3), playing: 4, strokeIndex: easyFirst, holeCount: 9 })?.net).toBe(15);
  });

  it("a plus handicap gives a stroke back, on the easiest hole", () => {
    expect(cardLine({ name: "Bo", strokes: fives(9), playing: -1, strokeIndex: SI9, holeCount: 9 })?.net).toBe(46);
  });

  it("a hole with no score counts toward neither figure", () => {
    const card = [5, null, 5, 5, 5, 5, 5, 5, 5];
    expect(cardLine({ name: "Ann", strokes: card, playing: 4, strokeIndex: SI9, holeCount: 9 })).toEqual({
      name: "Ann",
      gross: 40,
      // SI 2 was not played, so three of the four strokes fall: on SI 1, 3, 4.
      net: 37,
      thru: 8,
    });
  });

  it("no score at all is no line", () => {
    expect(cardLine({ name: "Ann", strokes: [], playing: 4, strokeIndex: SI9, holeCount: 9 })).toBeNull();
  });

  it("is written gross first, net beside it, and says thru while the card is going", () => {
    expect(cardLineText({ name: "Ann", gross: 45, net: 41, thru: 9 }, 9)).toBe("45 · net 41");
    expect(cardLineText({ name: "Ann", gross: 15, net: 12, thru: 3 }, 9)).toBe("15 · net 12 · thru 3");
  });
});
