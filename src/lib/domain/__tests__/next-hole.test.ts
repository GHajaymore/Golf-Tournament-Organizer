import { describe, it, expect } from "vitest";
import { nextHoleToPlay } from "../next-hole";

const card = (filled: number[], holes = 18) =>
  Array.from({ length: holes }, (_, i) => (filled.includes(i + 1) ? 4 : null));

describe("the hole Today tells a player to enter next", () => {
  it("is the first hole not yet written, from the 1st", () => {
    expect(nextHoleToPlay(card([1, 2, 3, 4, 5, 6, 7, 8, 9]), 1)).toBe(10);
  });

  it("follows a two-tee start round the course, not the first empty box", () => {
    // Off the 10th, four holes played: standing on the 14th. The first empty
    // box is hole 1, which is the answer this exists to NOT give.
    expect(nextHoleToPlay(card([10, 11, 12, 13]), 10)).toBe(14);
  });

  it("wraps from the 18th back to the 1st", () => {
    expect(nextHoleToPlay(card([10, 11, 12, 13, 14, 15, 16, 17, 18]), 10)).toBe(1);
  });

  it("finds a hole skipped earlier rather than claiming the card is done", () => {
    expect(nextHoleToPlay(card([1, 2, 4, 5]), 1)).toBe(3);
  });

  it("is null when every hole is in", () => {
    expect(nextHoleToPlay(card(Array.from({ length: 18 }, (_, i) => i + 1)), 1)).toBeNull();
  });

  it("reads a start outside the course as the 1st", () => {
    expect(nextHoleToPlay(card([], 9), 0)).toBe(1);
    expect(nextHoleToPlay(card([], 9), 12)).toBe(1);
  });

  it("works on a nine", () => {
    expect(nextHoleToPlay(card([1, 2, 3], 9), 1)).toBe(4);
  });
});
