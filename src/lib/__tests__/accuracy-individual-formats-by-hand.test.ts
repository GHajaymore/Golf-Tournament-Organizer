import { describe, it, expect } from "vitest";
import {
  computeStrokeCard,
  modifiedStablefordForHole,
  stablefordPointsForHole,
} from "../domain/stroke";
import { deriveNetHoles, matchStrokesGiven, resolveMatch } from "../domain/match";
import { playNassau } from "../domain/nassau";
import { playSkins } from "../domain/skins";
import type { HoleResult } from "../domain/types";

/**
 * THE ACCURACY SWEEP, PART 2: THE INDIVIDUAL FORMATS (2026-11-09).
 *
 * Stroke play gross and net, Stableford, Modified Stableford, singles match
 * play, a Nassau and skins, each scored off one hand-worked card. The expected
 * figures are literals worked hole by hole in the comments, from the Rules of
 * Golf (Rules 3.1, 3.2, 3.3, 21.1) and the Rules of Handicapping (6.2), never
 * from the functions under test.
 *
 * Every block has at least one ABSOLUTE row — a total, a point on a named
 * hole, a margin — so a constant offset or a stroke on the wrong hole cannot
 * pass (`docs/claude/combination-sweep.md`, point 7).
 */

/** Par 72: front 4 4 3 5 4 4 3 4 5 = 36, back 4 3 5 4 4 4 3 5 4 = 36. */
const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 3, 5, 4, 4, 4, 3, 5, 4];
/** Odd indexes on the front, even on the back. SI 1 is hole 4; SI 18 is hole 16. */
const SI = [7, 3, 15, 1, 11, 5, 17, 13, 9, 8, 16, 2, 12, 4, 10, 18, 6, 14];

/**
 * One player's card: a bogey on the 3rd and the 11th, a birdie on the 2nd and
 * 13th, a 9 on the par-5 12th, and a bogey everywhere else on a hole where a
 * 14 receives a stroke.
 *
 *     hole  1  2  3  4  5  6  7  8  9 | 10 11 12 13 14 15 16 17 18
 *     par   4  4  3  5  4  4  3  4  5 |  4  3  5  4  4  4  3  5  4
 *     SI    7  3 15  1 11  5 17 13  9 |  8 16  2 12  4 10 18  6 14
 *     gross 5  4  4  6  5  5  3  5  6 |  5  4  9  4  5  5  3  6  5
 *
 * Front 43, back 46, gross 89, +17 to par.
 */
const CARD = [5, 4, 4, 6, 5, 5, 3, 5, 6, 5, 4, 9, 4, 5, 5, 3, 6, 5];

describe("Stroke play, gross and net (Rule 3.3; Rules of Handicapping 6.2)", () => {
  it("off a playing handicap of 14: gross 89, net 75, +17", () => {
    // 14 strokes on SI 1-14; none on SI 15 (hole 3), 16 (11), 17 (7), 18 (16).
    const c = computeStrokeCard(CARD, PARS, 14, SI);
    expect(c.gross).toBe(89);
    expect(c.front).toBe(43);
    expect(c.back).toBe(46);
    expect(c.net).toBe(75);
    expect(c.toPar).toBe(17);
    expect(c.played).toBe(18);
  });

  it("off plus 2: two strokes are ADDED, so net is 91", () => {
    const c = computeStrokeCard(CARD, PARS, -2, SI);
    expect(c.net).toBe(91);
  });

  it("part-way round, net is the gross so far less the strokes on THOSE holes", () => {
    // Through 5: gross 5+4+4+6+5 = 24; a 14 receives on holes 1, 2, 4, 5 (SI 7, 3, 1, 11), not 3 (SI 15).
    const c = computeStrokeCard([...CARD.slice(0, 5), ...Array(13).fill(null)], PARS, 14, SI);
    expect(c.gross).toBe(24);
    expect(c.net).toBe(20);
    expect(c.toPar).toBe(4); // par through 5 is 20
  });
});

describe("Stableford (Rule 21.1b): 0, 1, 2, 3, 4, 5 points for net 2-over-or-worse to 3-under", () => {
  it("each step of the table", () => {
    // par 4, no strokes: 7 -> 0, 6 -> 0, 5 -> 1, 4 -> 2, 3 -> 3, 2 -> 4, 1 -> 5
    expect([7, 6, 5, 4, 3, 2, 1].map((g) => stablefordPointsForHole(g, 4, 0))).toEqual([0, 0, 1, 2, 3, 4, 5]);
    // a par 5 holed in one (a condor) is four under: 6 points
    expect(stablefordPointsForHole(1, 5, 0)).toBe(6);
    // a stroke received turns a gross bogey into a net par: 2 points
    expect(stablefordPointsForHole(5, 4, 1)).toBe(2);
    // a stroke GIVEN back (plus handicap) turns a gross par into a net bogey: 1 point
    expect(stablefordPointsForHole(4, 4, -1)).toBe(1);
  });

  it("the card off 14 scores 34, not 36: the 9 on the 12th floors at nought", () => {
    // Front: 2 3 1 2 2 2 2 2 2 = 18 (birdie net on 2, gross bogey on SI 15 hole 3).
    // Back:  2 1 0 3 2 2 2 2 2 = 16 (bogey on SI 16 hole 11, net 8 on a par 5 is 0, net birdie on 13).
    // Net 75 is three over par, yet the card is only two points short of 36:
    // the third shot lost on the 12th costs nothing (Rule 21.1b, a hole scored no worse than 0).
    expect(computeStrokeCard(CARD, PARS, 14, SI).points).toBe(34);
  });

  it("the same card off plus 2 scores 19", () => {
    // Front: 1 2 1 1 1 1 1 1 1 = 10 (hole 7, SI 17, gives a stroke back: 3 + 1 = net bogey, 1)
    // Back:  1 1 0 2 1 1 1 1 1 = 9  (hole 16, SI 18, gives a stroke back: 1)
    expect(computeStrokeCard(CARD, PARS, -2, SI).points).toBe(19);
  });
});

describe("Modified Stableford (Rule 21.1b's committee option; the scale the app states: 8/5/2/0/-1/-3)", () => {
  it("each step of the table, with no floor", () => {
    expect([1, 2, 3, 4, 5, 6, 9].map((g) => modifiedStablefordForHole(g, 4, 0))).toEqual([8, 5, 2, 0, -1, -3, -3]);
  });

  it("the card off 14 scores -1", () => {
    // Front: 0 +2 -1 0 0 0 0 0 0 = +1. Back: 0 -1 -3 +2 0 0 0 0 0 = -2.
    expect(computeStrokeCard(CARD, PARS, 14, SI, { pointsForHole: modifiedStablefordForHole }).points).toBe(-1);
  });
});

/**
 * A singles match, net, 100% of the difference (Appendix C: the lower plays
 * off scratch and the other receives the full difference, by stroke index).
 *
 * A plays off 5 and B off 13: B receives 8, on SI 1-8 — holes 4, 12, 2, 14,
 * 6, 17, 1 and 10. A shoots level par.
 *
 *     hole   1  2  3  4  5  6  7  8  9 | 10 11 12 13 14 15 16 17 18
 *     A      4  4  3  5  4  4  3  4  5 |  4  3  5  4  4  4  3  5  4
 *     B      5  5  3  6  5  5  4  4  4 |  5  3  6  5  5  4  3  5  4
 *     B net  4  4  3  5  5  4  4  4  4 |  4  3  5  5  4  4  3  4  4
 *     hole   H  H  H  H  A  H  A  H  B |  H  H  H  A  H  H  H  B  H
 *
 * A wins 5, 7, 13; B wins 9 (no stroke on SI 9) and 17 (a stroke on SI 6).
 * A is 1 up after the 18th: "1 UP" (Rule 3.2a(3)).
 */
const A_CARD = [...PARS];
const B_CARD = [5, 5, 3, 6, 5, 5, 4, 4, 4, 5, 3, 6, 5, 5, 4, 3, 5, 4];
const MATCH: HoleResult[] = ["H", "H", "H", "H", "A", "H", "A", "H", "B", "H", "H", "H", "A", "H", "H", "H", "B", "H"];

describe("Singles match play, net (Rules 3.2; Appendix C, 100% off the low)", () => {
  it("B receives 8 strokes, on stroke index 1 to 8, and A none", () => {
    const { toA, toB } = matchStrokesGiven(5, 13, SI);
    expect(toA.every((s) => s === 0)).toBe(true);
    expect(toB).toEqual([1, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0]);
  });

  it("hole by hole as worked above, and A wins 1 UP", () => {
    const holes = deriveNetHoles(A_CARD, B_CARD, 5, 13, SI, 18);
    expect(holes).toEqual(MATCH);
    const r = resolveMatch(holes);
    expect(r.winner).toBe("A");
    expect(r.resultText).toBe("1 UP");
    expect([r.holesWonA, r.holesWonB]).toEqual([3, 2]);
  });

  it("a plus 2 against a 7: the 7 receives the whole difference, 9, on SI 1-9", () => {
    const { toA, toB } = matchStrokesGiven(-2, 7, SI);
    expect(toA.every((s) => s === 0)).toBe(true);
    expect(toB.reduce((a, b) => a + b, 0)).toBe(9);
    expect(toB[8], "SI 9 (hole 9) is the ninth stroke").toBe(1);
    expect(toB[14], "SI 10 (hole 15) receives nothing").toBe(0);
  });

  it("a match is over the moment one side is more holes up than are left (Rule 3.2a(3))", () => {
    // A wins the first five and halves the rest: 5 up with 4 to play after the 14th -> 5&4.
    const holes: HoleResult[] = [...Array(5).fill("A"), ...Array(13).fill("H")];
    const r = resolveMatch(holes);
    expect(r.resultText).toBe("5&4");
    expect(r.played).toBe(14);
    // Halved to the 14th; A wins the 15th, the 16th (dormie 2) and the 17th: 3 up with 1 to play, 3&1.
    const late: HoleResult[] = [...Array(14).fill("H"), "A", "A", "A", null];
    expect(resolveMatch(late).resultText).toBe("3&1");
  });
});

describe("Nassau: three matches on one card — front nine, back nine, the eighteen", () => {
  it("the card above: front A 2&1, back halved, overall A 1 UP — A two units up", () => {
    const n = playNassau(MATCH);
    const [front, back, overall] = n.segments;
    // A won 5 and 7 and halved 8: 2 up with 1 to play, so the front nine is over at the 8th.
    // B's win on the 9th counts in the eighteen-hole match only.
    expect(front.result?.resultText).toBe("2&1");
    expect(back.result?.resultText).toBe("AS"); // A won 13, B won 17
    expect(back.result?.winner).toBe("H");
    expect(overall.result?.resultText).toBe("1 UP");
    expect(n.balance).toBe(2);
    expect(n.decided).toBe(3);
  });

  it("a front nine closed out early counts as closed: A wins the first five, halves the rest", () => {
    const holes: HoleResult[] = [...Array(5).fill("A"), ...Array(13).fill("H")];
    const n = playNassau(holes);
    // Front: 5 up with 4 to play after the 5th -> 5&4. Back: all halved. Overall: 5&4 on the 14th.
    expect(n.segments.map((s) => s.result?.resultText)).toEqual(["5&4", "AS", "5&4"]);
    expect(n.balance).toBe(2);
  });
});

describe("Skins: each hole is a skin, a tie carries it to the next", () => {
  // Six holes, three players, gross.
  //   hole 1: 4 4 5  tie -> carry 1
  //   hole 2: 3 4 4  P1 wins 2 skins
  //   hole 3: 5 5 5  tie -> carry 1
  //   hole 4: 4 4 5  tie -> carry 2
  //   hole 5: 5 4 5  P2 wins 3 skins
  //   hole 6: 4 4 4  tie -> 1 left unclaimed
  const players = [
    { playerId: "zz-p1", strokes: [4, 3, 5, 4, 5, 4], courseHandicap: 0 },
    { playerId: "zz-p2", strokes: [4, 4, 5, 4, 4, 4], courseHandicap: 0 },
    { playerId: "zz-p3", strokes: [5, 4, 5, 5, 5, 4], courseHandicap: 4 },
  ];

  it("gross: P2 3 skins, P1 2, one unclaimed", () => {
    const out = playSkins(players, 6, { net: false });
    const by = new Map(out.standings.map((s) => [s.playerId, s.skins]));
    expect([by.get("zz-p1"), by.get("zz-p2"), by.get("zz-p3")]).toEqual([2, 3, 0]);
    expect(out.unclaimed).toBe(1);
    expect(out.holes.find((h) => h.hole === 5)?.value).toBe(3);
  });

  it("net, P3 off 4 (strokes on SI 1-4, which on these holes are the 2nd and 4th): P2 takes 5 skins on the 5th", () => {
    // SI of holes 1-6 on the eighteen: 7, 3, 15, 1, 11, 5. P3 receives on hole 2 (SI 3) and hole 4 (SI 1).
    //   hole 2: 3 4 3  P1 and P3 tie -> carry
    //   hole 4: 4 4 4  tie -> carry
    // Every hole to the 5th carries; P2 wins the 5th worth 5; the 6th is left.
    const out = playSkins(players, 6, { net: true, strokeIndex: SI });
    const by = new Map(out.standings.map((s) => [s.playerId, s.skins]));
    expect([by.get("zz-p1"), by.get("zz-p2"), by.get("zz-p3")]).toEqual([0, 5, 0]);
    expect(out.unclaimed).toBe(1);
  });
});
