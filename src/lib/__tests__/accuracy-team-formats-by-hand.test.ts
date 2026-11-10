import { describe, it, expect } from "vitest";
import {
  aggregateTeamCard,
  matchHolesOffTheLow,
  sideHandicap,
  singleBallTeamCard,
  SCRAMBLE_WEIGHTS_2,
  SCRAMBLE_WEIGHTS_3,
  SCRAMBLE_WEIGHTS_4,
} from "../domain/team";
import { playingHandicapFrom } from "../domain/handicap";
import { resolveMatch } from "../domain/match";
import { findFormat } from "../formats";
import { cupMatchState, cupTally, pointsToWin } from "../domain/cup";
import type { HoleResult } from "../domain/types";

/**
 * THE ACCURACY SWEEP, PART 3: THE TEAM FORMATS (2026-11-09).
 *
 * Four-ball (stroke and match), best balls of N, foursomes, greensomes,
 * Chapman, the scrambles, and the cup's points — each against a figure worked
 * by hand from the Rules of Handicapping, Appendix C (2024), with the working
 * in the comment. The handicaps are UNROUNDED course handicaps with a decimal
 * (Rule 6.2a: the allowance is taken of the exact figure, rounded once), chosen
 * so that rounding first, or the wrong allowance, lands on a different literal.
 */

const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 3, 5, 4, 4, 4, 3, 5, 4];
/** SI 1 hole 4, 2 hole 12, 3 hole 2, 4 hole 14, 5 hole 6, 6 hole 17, 7 hole 1, 8 hole 10 ... 18 hole 16. */
const SI = [7, 3, 15, 1, 11, 5, 17, 13, 9, 8, 16, 2, 12, 4, 10, 18, 6, 14];
const plus = (n: number) => PARS.map((p) => p + n);

describe("Four-ball stroke play (Appendix C: 85% each, better ball counts)", () => {
  /**
   * P1: course handicap 9.5 exactly, plays off 9.5 x 0.85 = 8.075 -> 8
   *     (rounding first would be 10 x 0.85 = 8.5 -> 9). Shoots level par.
   * P2: 21.3 exactly, plays off 18.105 -> 18. One over on every hole except a
   *     gross par 3 on the 16th (SI 18), where his stroke makes it a net 2.
   *
   * P1 nets par - 1 on SI 1-8 and par elsewhere; P2 nets par everywhere but
   * the 16th. So P1's ball counts on seventeen holes and P2's on the 16th:
   *   net    72 - 8 - 1 = 63
   *   gross  72 (P2's 3 on the 16th is par, like P1's)
   *   points 8 holes x 3 + 9 holes x 2 + the 16th 3 = 45
   */
  const members = [
    { playerId: "zz-p1", strokes: [...PARS], courseHandicap: 9.5 },
    { playerId: "zz-p2", strokes: plus(1).map((s, i) => (i === 15 ? 3 : s)), courseHandicap: 21.3 },
  ];

  it("net 63, gross 72, 45 points, level par", () => {
    const card = aggregateTeamCard(members, PARS, SI, 85);
    expect(card.netTotal).toBe(63);
    expect(card.grossTotal).toBe(72);
    expect(card.pointsTotal).toBe(45);
    expect(card.toPar).toBe(0);
    expect(card.holes[15].playerId).toBe("zz-p2");
    expect(card.holes[3].playerId, "SI 1: P1's net birdie").toBe("zz-p1");
    expect(card.holes[3].net).toBe(4);
  });

  it("the stroke for the par of a higher tee is added AFTER the 85% (6.2b): net 61", () => {
    // P1 on tees two par higher: 8 + 2 = 10 strokes, so two more net birdies (SI 9 and 10).
    const card = aggregateTeamCard([{ ...members[0], parStrokes: 2 }, members[1]], PARS, SI, 85);
    expect(card.netTotal).toBe(61);
  });

  it("a GROSS four-ball counts the better gross ball", () => {
    // Gross: P1 par everywhere, P2 par+1 except the 16th where both are 3; net breaks that tie for P2.
    const card = aggregateTeamCard(members, PARS, SI, 85, 1, "gross");
    expect(card.grossTotal).toBe(72);
    expect(card.holes[15].playerId).toBe("zz-p2");
    expect(card.holes[0].playerId).toBe("zz-p1");
  });
});

describe("Best balls of four (the same operation, counting N)", () => {
  // Off scratch, three holes, par 4, 3, 5:
  //   hole 1: 4 5 3 6 -> best two 3 + 4 = 7  (points 3 + 2)
  //   hole 2: 3 2 4 3 -> best two 2 + 3 = 5  (points 3 + 2)
  //   hole 3: 6 5 5 4 -> best two 4 + 5 = 9  (points 3 + 2)
  // Gross 21 against a par of 2 x 12 = 24: three under. Points 15.
  const pars = [4, 3, 5];
  const si = [1, 2, 3];
  const four = [
    { playerId: "zz-a", strokes: [4, 3, 6], courseHandicap: 0 },
    { playerId: "zz-b", strokes: [5, 2, 5], courseHandicap: 0 },
    { playerId: "zz-c", strokes: [3, 4, 5], courseHandicap: 0 },
    { playerId: "zz-d", strokes: [6, 3, 4], courseHandicap: 0 },
  ];

  it("best two of four: 21, three under, 15 points", () => {
    const card = aggregateTeamCard(four, pars, si, 100, 2);
    expect(card.grossTotal).toBe(21);
    expect(card.toPar).toBe(-3);
    expect(card.pointsTotal).toBe(15);
  });

  it("best one of four: 3 + 2 + 4 = 9, three under par 12", () => {
    const card = aggregateTeamCard(four, pars, si, 100, 1);
    expect(card.grossTotal).toBe(9);
    expect(card.toPar).toBe(-3);
  });

  it("all four count: 18 + 12 + 20 = 50, two up on par 48", () => {
    const card = aggregateTeamCard(four, pars, si, 100, 4);
    expect(card.grossTotal).toBe(50);
    expect(card.toPar).toBe(2);
  });
});

describe("Four-ball match play (Appendix C: 90% each, strokes off the lowest of the four)", () => {
  /**
   * Course handicaps (exact) and 90% of them:
   *   a1  9.5  -> 8.55  -> 9      b1  4.2  -> 3.78 -> 4   (the low)
   *   a2 21.3  -> 19.17 -> 19     b2 15.0  -> 13.5 -> 14  (.5 rounds up)
   * Off the low: a1 receives 5 (SI 1-5), a2 15 (SI 1-15), b2 10 (SI 1-10), b1 none.
   *
   * b1 shoots level par; the other three one over everywhere. Side B always
   * nets par (b1). Side A nets par wherever a2 has a stroke (SI 1-15) and one
   * over on SI 16, 17, 18 — holes 11, 7 and 16. B wins those three:
   * 1 up after 7, 2 up after 11, 3 up with 2 to play after 16 -> B wins 3&2.
   */
  const playing = {
    a1: playingHandicapFrom(9.5, 90),
    a2: playingHandicapFrom(21.3, 90),
    b1: playingHandicapFrom(4.2, 90),
    b2: playingHandicapFrom(15.0, 90),
  };

  it("the playing handicaps are 9, 19, 4 and 14", () => {
    expect(playing).toEqual({ a1: 9, a2: 19, b1: 4, b2: 14 });
  });

  it("B wins the 7th, 11th and 16th and the match 3&2", () => {
    const holes = matchHolesOffTheLow(
      [
        { strokes: plus(1), playingHandicap: playing.a1 },
        { strokes: plus(1), playingHandicap: playing.a2 },
      ],
      [
        { strokes: [...PARS], playingHandicap: playing.b1 },
        { strokes: plus(1), playingHandicap: playing.b2 },
      ],
      SI,
      18,
    );
    const expected: HoleResult[] = PARS.map(() => "H");
    expected[6] = "B";
    expected[10] = "B";
    expected[15] = "B";
    expect(holes).toEqual(expected);
    const r = resolveMatch(holes);
    expect(r.winner).toBe("B");
    expect(r.resultText).toBe("3&2");
  });
});

describe("A side that shares one ball: what it plays off (Appendix C)", () => {
  it("foursomes, 50% of the combined: 10.6 and 9.6 play off 10, not 11", () => {
    // 50% of (10.6 + 9.6) = 10.1 -> 10. Rounding each first: 11 + 10 = 21 x 0.5 = 10.5 -> 11.
    expect(sideHandicap([10.6, 9.6], findFormat("Foursomes").allowance)).toBe(10);
    expect(sideHandicap([10.6, 9.6], findFormat("Alternate Shot").allowance)).toBe(10);
  });

  it("greensomes and Chapman, 60% of the lower + 40% of the higher: 6.3 and 22.2 play off 13", () => {
    // 0.6 x 6.3 = 3.78; 0.4 x 22.2 = 8.88; 12.66 -> 13. (Rounding first: 3.6 + 8.8 = 12.4 -> 12;
    // a flat 50% of the combined: 14.25 -> 14.)
    for (const name of ["Greensomes", "Chapman / Pinehurst"]) {
      const f = findFormat(name);
      expect(sideHandicap([22.2, 6.3], f.allowance, f.weightsBySideSize?.[2]), name).toBe(13);
    }
  });

  it("a scramble of four, 25/20/15/10 lowest first: 2.4, 11.8, 19.3, 30.6 play off 9", () => {
    // 0.6 + 2.36 + 2.895 + 3.06 = 8.915 -> 9
    expect(sideHandicap([30.6, 2.4, 19.3, 11.8], 100, SCRAMBLE_WEIGHTS_4)).toBe(9);
    expect(SCRAMBLE_WEIGHTS_4).toEqual([25, 20, 15, 10]);
  });

  it("a scramble of four with a plus player: +1.2, 8, 14, 22 play off 6", () => {
    // -0.3 + 1.6 + 2.1 + 2.2 = 5.6 -> 6. The plus player is the LOWEST and takes the 25%.
    expect(sideHandicap([8, -1.2, 22, 14], 100, SCRAMBLE_WEIGHTS_4)).toBe(6);
  });

  it("a scramble of three, 30/20/10 (2024 edition): 5, 12, 25 play off 6, not the four's shares (7)", () => {
    // 1.5 + 2.4 + 2.5 = 6.4 -> 6. With 25/20/15: 1.25 + 2.4 + 3.75 = 7.4 -> 7.
    expect(SCRAMBLE_WEIGHTS_3).toEqual([30, 20, 10]);
    expect(sideHandicap([25, 5, 12], 100, SCRAMBLE_WEIGHTS_3)).toBe(6);
  });

  it("a scramble of two, 35/15: 7 and 18 play off 5", () => {
    // 2.45 + 2.7 = 5.15 -> 5
    expect(SCRAMBLE_WEIGHTS_2).toEqual([35, 15]);
    expect(sideHandicap([18, 7], 100, SCRAMBLE_WEIGHTS_2)).toBe(5);
  });

  it("a Texas scramble takes the same tables", () => {
    const f = findFormat("Texas Scramble");
    expect(f.weightsBySideSize).toEqual({ 2: [35, 15], 3: [30, 20, 10], 4: [25, 20, 15, 10] });
  });

  it("the side's one card off 5: level par is net 67 and 41 points", () => {
    // 5 strokes on SI 1-5 (holes 4, 12, 2, 14, 6): five net birdies.
    const card = singleBallTeamCard([...PARS], PARS, 5, SI);
    expect(card.grossTotal).toBe(72);
    expect(card.netTotal).toBe(67);
    expect(card.pointsTotal).toBe(41);
    expect(card.holes[3].net).toBe(4);
    expect(card.holes[15].net, "no stroke on SI 18").toBe(3);
  });
});

describe("A team cup's points: a win is 1, a halved match a half each", () => {
  it("a 28-match cup is won at 14.5; a holder retains at 14", () => {
    expect(pointsToWin(0, 28)).toBe(14.5);
    expect(pointsToWin(0, 5)).toBe(3);
  });

  it("a halved match is half a point each; a won match one; three matches make 1.5-1.5", () => {
    expect(cupMatchState({ holes: Array(18).fill("H"), conceded: null }).points).toEqual([0.5, 0.5]);
    // A wins the 16th and 17th after fifteen halves: 2 up with 1 to play, 2&1.
    const aWins: HoleResult[] = [...Array(15).fill("H"), "A", "A", null];
    expect(cupMatchState({ holes: aWins, conceded: null })).toMatchObject({ points: [1, 0], label: "2&1" });
    const bWins: HoleResult[] = [...Array(17).fill("H"), "B"];
    const t = cupTally([
      { holes: aWins, conceded: null },
      { holes: Array(18).fill("H"), conceded: null },
      { holes: bWins, conceded: null },
    ]);
    expect([t.a, t.b, t.decided]).toEqual([1.5, 1.5, 3]);
  });
});
