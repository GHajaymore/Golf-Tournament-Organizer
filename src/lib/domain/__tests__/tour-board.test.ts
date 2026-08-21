import { describe, it, expect } from "vitest";
import { tourPositions, thruText, parTone, cutLineAfter } from "../tour-board";

/**
 * The leaderboard conventions a club argues about.
 *
 * Field sizes start at ONE, per the matrix-suite rule: a one-player board and
 * a two-player tie are where the off-by-ones live.
 */

const row = (rank: number, hasScore = true) => ({ rank, hasScore });

describe("positions, with ties marked", () => {
  it("marks a shared position with T and leaves a solo one bare", () => {
    // Rule 3-3 of the ranking the app already does: two players level are both
    // second, and the next is fourth. Printing "2" twice invites a member to
    // ask which is really second, and the honest answer is neither.
    expect(tourPositions([row(1), row(2), row(2), row(4)])).toEqual(["1", "T2", "T2", "4"]);
  });

  it("marks a tie at the top", () => {
    expect(tourPositions([row(1), row(1), row(3)])).toEqual(["T1", "T1", "3"]);
  });

  it("handles a one-player board", () => {
    expect(tourPositions([row(1)])).toEqual(["1"]);
  });

  it("handles an empty board without inventing a row", () => {
    expect(tourPositions([])).toEqual([]);
  });

  it("shows no position for a player with no card yet", () => {
    // They have a rank in the data and no business showing one on the board.
    expect(tourPositions([row(1), row(2, false)])).toEqual(["1", "—"]);
  });

  it("does not let a scoreless player create a tie", () => {
    // Two players sharing rank 2 where only one has played is NOT a tie — the
    // other has not started. Counting them together would print T2 against a
    // player with no score.
    expect(tourPositions([row(1), row(2), row(2, false)])).toEqual(["1", "2", "—"]);
  });

  it("marks every member of a three-way tie", () => {
    expect(tourPositions([row(1), row(2), row(2), row(2), row(5)])).toEqual([
      "1", "T2", "T2", "T2", "5",
    ]);
  });
});

describe("thru", () => {
  it("says F once the round is complete", () => {
    expect(thruText(18, 18)).toBe("F");
  });

  it("says F on a nine-hole round at nine, not 'thru 9'", () => {
    // The whole point of F: right for either round length with no arithmetic.
    expect(thruText(9, 9)).toBe("F");
    expect(thruText(9, 18)).toBe("9");
  });

  it("counts holes while they are still out", () => {
    expect(thruText(1, 18)).toBe("1");
    expect(thruText(17, 18)).toBe("17");
  });

  it("says nothing before they start", () => {
    expect(thruText(0, 18)).toBe("—");
    expect(thruText(-1, 18)).toBe("—");
  });

  it("still says F for a card with more holes than the round", () => {
    // A nineteenth hole is a data problem, but claiming they are still playing
    // is not the way to surface it.
    expect(thruText(19, 18)).toBe("F");
  });
});

describe("which way a score is going", () => {
  it("separates under, level and over", () => {
    expect(parTone(-4)).toBe("under");
    expect(parTone(0)).toBe("level");
    expect(parTone(3)).toBe("over");
  });

  it("does not give level par the good colour", () => {
    // "E" is neither good nor bad and must not borrow the under-par colour.
    expect(parTone(0)).not.toBe("under");
  });
});

describe("the cut line", () => {
  it("goes under the last player who advances", () => {
    expect(cutLineAfter([{ advancing: true }, { advancing: true }, { advancing: false }])).toBe(1);
  });

  it("is not drawn when everybody advances", () => {
    expect(cutLineAfter([{ advancing: true }, { advancing: true }])).toBe(-1);
  });

  it("is not drawn when nobody advances", () => {
    expect(cutLineAfter([{ advancing: false }, { advancing: false }])).toBe(-1);
  });

  it("is not drawn on an empty board", () => {
    expect(cutLineAfter([])).toBe(-1);
  });

  it("refuses to draw one line through a field that is not cleanly split", () => {
    // Someone above the line missing it means the flags are not a prefix — a
    // single line would be a lie about who got through. Better no line than a
    // wrong one, which is this codebase's rule everywhere else.
    expect(cutLineAfter([{ advancing: true }, { advancing: false }, { advancing: true }])).toBe(-1);
  });

  it("handles a one-player field", () => {
    expect(cutLineAfter([{ advancing: true }])).toBe(-1);
    expect(cutLineAfter([{ advancing: false }])).toBe(-1);
  });

  it("never returns an index past the end", () => {
    for (const size of [1, 2, 3, 4, 5, 8, 16, 28]) {
      for (const advancing of [0, 1, Math.floor(size / 2), size]) {
        const rows = Array.from({ length: size }, (_, i) => ({ advancing: i < advancing }));
        const at = cutLineAfter(rows);
        expect(at).toBeLessThan(size);
        expect(at === -1 || at >= 0).toBe(true);
        // A line, when drawn, always has somebody below it.
        if (at >= 0) expect(at).toBeLessThan(size - 1);
      }
    }
  });
});
