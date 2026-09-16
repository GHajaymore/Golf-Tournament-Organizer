import { describe, it, expect } from "vitest";
import { compareOnBasis, levelOnBasis, scoreOnBasis } from "@/lib/domain/stroke-countback";

/**
 * A COMPETITION IS DECIDED BY ONE NUMBER, AND A TIE ON IT IS A TIE.
 *
 * `stroke-countback.ts` opens by saying the countback runs on the basis the
 * competition was played on, because "a net comp separated on gross would hand
 * the prize to the low handicapper the countback exists to stop" — and that
 * "the countback is only ever a tiebreak. It never reorders players who are
 * not level on the score itself."
 *
 * Both were true inside the countback and false in the sort that fed it, which
 * compared `gross || net` on a gross competition and `net || gross` on a net
 * one. So two players level on the competition's own score were separated by a
 * number it does not use, before the countback was reached.
 *
 * These assert the RULE — a scratch competition is decided on gross, full
 * stop — rather than what the code did. See Rules of Golf Committee
 * Procedures 5A: the recommendation is a countback, not a second scoring
 * basis.
 */

const p = (gross: number, net: number, points = 0) => ({ gross, net, points });

describe("a gross competition is decided on gross", () => {
  it("treats two players level on gross as level, whatever their nets", () => {
    /**
     * THE MEASURED DEFECT. Read off the seeded Demo Cup on 2026-09-15, a
     * gross competition: Elena 70/64 was given 3rd, Sang-woo 70/65 4th and AJ
     * 70/68 5th. Three players level on the only score that competition uses,
     * placed by handicap — in the format whose whole point is to exclude it.
     */
    expect(levelOnBasis(p(70, 64), p(70, 65), "gross")).toBe(true);
    expect(levelOnBasis(p(70, 64), p(70, 68), "gross")).toBe(true);
    expect(compareOnBasis(p(70, 64), p(70, 68), "gross")).toBe(0);
  });

  it("still separates two players who are not level on gross", () => {
    // The countback is only ever a tiebreak; it must not be reached here.
    expect(compareOnBasis(p(69, 68), p(70, 60), "gross")).toBeLessThan(0);
    expect(levelOnBasis(p(69, 68), p(70, 60), "gross")).toBe(false);
  });

  it("does not let a better net beat a better gross", () => {
    // The direction that would actually change a winner: 70/60 must finish
    // behind 69/68 on a scratch sheet.
    expect(compareOnBasis(p(70, 60), p(69, 68), "gross")).toBeGreaterThan(0);
  });
});

describe("a net competition is decided on net", () => {
  it("treats two players level on net as level, whatever their grosses", () => {
    /**
     * The same fault running the other way, and the worse of the two. Two
     * players on 68 net separated by gross hands the place to the lower
     * handicapper — the exact outcome `stroke-countback.ts` opens by refusing.
     */
    expect(levelOnBasis(p(72, 68), p(80, 68), "net")).toBe(true);
    expect(compareOnBasis(p(72, 68), p(80, 68), "net")).toBe(0);
  });

  it("does not let a better gross beat a better net", () => {
    expect(compareOnBasis(p(72, 69), p(80, 68), "net")).toBeGreaterThan(0);
  });
});

describe("a Stableford competition is decided on points", () => {
  it("runs the other way — most points wins", () => {
    expect(compareOnBasis(p(80, 70, 38), p(72, 68, 36), "stableford")).toBeLessThan(0);
  });

  it("treats two players level on points as level, whatever their strokes", () => {
    // Points are capped, so two cards level on points can be several strokes
    // apart. The player who blobbed the last two is level, which is the format.
    expect(levelOnBasis(p(72, 68, 36), p(84, 79, 36), "stableford")).toBe(true);
  });
});

describe("which number each basis reads", () => {
  it("reads exactly one of the three", () => {
    const row = p(70, 64, 38);
    expect(scoreOnBasis(row, "gross")).toBe(70);
    expect(scoreOnBasis(row, "net")).toBe(64);
    expect(scoreOnBasis(row, "stableford")).toBe(38);
  });
});
