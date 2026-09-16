import { describe, it, expect } from "vitest";
import { cutLineIndex } from "@/lib/domain/cut";

/**
 * A HORIZONTAL RULE IS A CLAIM ABOUT EVERY ROW AT ONCE.
 *
 * "Everything above this is through" is only true when the advancing set is a
 * contiguous prefix of the board. The reader used to take the LAST advancing
 * row and draw under it, which is the same answer on a well-ordered board and
 * a badly wrong one otherwise.
 *
 * The case that made it wrong is real and is asserted below: a bracket takes
 * its field from the ranking that qualified it, the board ranks the round
 * being played now, and the two orders have nothing to do with each other.
 */

const row = (advancing: boolean) => ({ advancing });
const board = (...flags: boolean[]) => flags.map(row);

describe("a line the board can support", () => {
  it("falls under the last of a contiguous prefix", () => {
    expect(cutLineIndex(board(true, true, true, false, false))).toBe(2);
  });

  it("is drawn for a single qualifier at the top", () => {
    expect(cutLineIndex(board(true, false, false))).toBe(0);
  });

  it("is drawn with one player left out at the bottom", () => {
    expect(cutLineIndex(board(true, true, true, false))).toBe(2);
  });
});

describe("a line the board cannot support", () => {
  it("refuses a board where a qualifier sits below a non-qualifier", () => {
    /**
     * The whole defect in five rows. The old reader returned 3 here and drew
     * under it, telling rows 2 and 3 they were through.
     */
    expect(cutLineIndex(board(true, false, false, true, false))).toBeNull();
  });

  it("refuses the measured Demo Cup board", () => {
    /**
     * READ OFF THE SEEDED DEMO ON 2026-09-15, from `/me/board` and therefore
     * from the public share link. Thirty-three rows ranked on the medal round
     * in progress; four advancing, at positions 2, 7, 8 and 17 (1-indexed),
     * because the bracket was qualified on the earlier round's match points.
     *
     * The old reader drew the rule under row 17. That put THIRTEEN players who
     * are not through above the line, and the leader of the round — top of the
     * board, four shots clear — above it without being one of the four.
     */
    const advancingAt = new Set([2, 7, 8, 17]);
    const rows = Array.from({ length: 33 }, (_, i) => row(advancingAt.has(i + 1)));

    const lastAdvancing = rows.reduce((last, r, i) => (r.advancing ? i : last), -1);
    expect(lastAdvancing, "the old reader's answer, kept so this cannot pass by accident").toBe(16);
    expect(rows.slice(0, 17).filter((r) => !r.advancing).length).toBe(13);

    expect(cutLineIndex(rows), "drew a line through thirteen players it could not speak for").toBeNull();
  });

  it("refuses a board where everybody is through", () => {
    // Not a lie, just not a line: there is nothing on the other side of it.
    expect(cutLineIndex(board(true, true, true))).toBeNull();
  });

  it("refuses a board where nobody is through", () => {
    expect(cutLineIndex(board(false, false, false))).toBeNull();
  });

  it("refuses an empty board", () => {
    expect(cutLineIndex([])).toBeNull();
  });

  it("refuses a single row, through or not", () => {
    expect(cutLineIndex(board(true))).toBeNull();
    expect(cutLineIndex(board(false))).toBeNull();
  });
});
