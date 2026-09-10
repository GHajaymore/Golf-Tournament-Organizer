import { describe, it, expect } from "vitest";
import {
  weekBasis,
  compareOnBasis,
  levelOnBasis,
  valueOnBasis,
  directionOnBasis,
  WEEK_BASIS_LABEL,
  WEEK_BASIS_COLUMN,
} from "../week-basis";

/**
 * What a league night is decided on.
 *
 * The sheet asked one question — "is this Stableford?" — so a GROSS round was
 * ranked by net and labelled "net strokes" while the ordinary leaderboard
 * ranked the same round by gross. Every case here is about the third answer
 * that did not exist.
 */

/** Four cards chosen so gross and net order REVERSE — the fixture that made
 *  the defect visible, kept here because a fixture where the two agree cannot
 *  express a wrong answer. */
const FIELD = [
  { name: "low handicap", gross: 76, net: 66, points: 30 },
  { name: "middle", gross: 77, net: 66, points: 31 },
  { name: "higher", gross: 78, net: 65, points: 33 },
  { name: "highest", gross: 79, net: 64, points: 36 },
];

const orderOn = (basis: Parameters<typeof compareOnBasis>[0]) =>
  [...FIELD].sort((a, b) => compareOnBasis(basis, a, b)).map((r) => r.name);

describe("which figure a night is decided on", () => {
  it("reads the round's own basis", () => {
    expect(weekBasis("gross")).toBe("gross");
    expect(weekBasis("net")).toBe("net");
    expect(weekBasis("stableford")).toBe("stableford");
    // Modified Stableford is still points — a different table, not a
    // different kind of answer.
    expect(weekBasis("modified-stableford")).toBe("stableford");
  });

  it("leaves 'both' and anything unrecognised on net", () => {
    /**
     * DELIBERATE, and the assertion that keeps this change to the case that
     * was provably wrong. "Both" means both prizes are given, and net is the
     * figure a league table has always carried; anything unrecognised lands
     * there too, which is what every round got before this existed.
     */
    expect(weekBasis("both")).toBe("net");
    expect(weekBasis("")).toBe("net");
    expect(weekBasis(null)).toBe("net");
    expect(weekBasis("something else")).toBe("net");
  });
});

describe("ranking the night", () => {
  it("puts the lowest gross first on a gross round", () => {
    expect(orderOn("gross")).toEqual(["low handicap", "middle", "higher", "highest"]);
  });

  it("and the lowest net first on a net one — which turns the night over", () => {
    /**
     * THE ASSERTION THAT PROVES THE FIXTURE CAN EXPRESS A WRONG ANSWER. If
     * gross and net gave the same order, the test above would pass on a rule
     * that ignored the basis entirely — which is the rule that shipped.
     *
     * Not a perfect reversal, and the reason is the countback: the two players
     * level on 66 are split by their gross, so the 76 finishes above the 77 in
     * both orders. What matters is that the winner and the last player swap.
     */
    expect(orderOn("net")).toEqual(["highest", "higher", "low handicap", "middle"]);
    expect(orderOn("net")[0]).not.toBe(orderOn("gross")[0]);
    expect(orderOn("net")[0]).toBe(orderOn("gross")[3]);
  });

  it("and the most points first on a Stableford", () => {
    expect(orderOn("stableford")).toEqual(["highest", "higher", "middle", "low handicap"]);
  });

  it("breaks a net tie on gross, and does not invent one on gross", () => {
    const a = { gross: 76, net: 66, points: 30 };
    const b = { gross: 77, net: 66, points: 30 };
    // Level on net, so the better gross takes it — the countback a committee
    // reaches for first.
    expect(compareOnBasis("net", a, b)).toBeLessThan(0);
    expect(levelOnBasis("net", a, b), "not level: the gross differs").toBe(false);
    // On a gross round two different grosses are simply two positions.
    expect(levelOnBasis("gross", a, b)).toBe(false);
    expect(levelOnBasis("gross", a, { ...b, gross: 76 }), "same gross is level").toBe(true);
  });
});

describe("the season total under the sheet", () => {
  it("totals the same figure the night was decided on", () => {
    const row = { gross: 76, net: 66, points: 30 };
    expect(valueOnBasis("gross", row)).toBe(76);
    expect(valueOnBasis("net", row)).toBe(66);
    expect(valueOnBasis("stableford", row)).toBe(30);
  });

  it("and knows which way is winning", () => {
    // Points high, strokes low. One function, because the sheet, the table and
    // the movement column all have to agree about it.
    expect(directionOnBasis("stableford")).toBe("desc");
    expect(directionOnBasis("gross")).toBe("asc");
    expect(directionOnBasis("net")).toBe("asc");
  });
});

describe("what the sheet calls it", () => {
  it("names all three, and never calls a gross round net", () => {
    expect(WEEK_BASIS_LABEL.gross).toBe("gross strokes");
    expect(WEEK_BASIS_LABEL.net).toBe("net strokes");
    expect(WEEK_BASIS_LABEL.stableford).toBe("Stableford points");
    // The defect, as an absence: the label for a gross round must not be the
    // net one, which is exactly what it was.
    expect(WEEK_BASIS_LABEL.gross).not.toBe(WEEK_BASIS_LABEL.net);
  });

  it("gives each a column heading of its own", () => {
    expect(new Set(Object.values(WEEK_BASIS_COLUMN)).size).toBe(3);
  });
});
