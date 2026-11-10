import { describe, it, expect } from "vitest";
import {
  courseHandicap,
  courseHandicapExact,
  courseHandicapMap,
  playingHandicapFrom,
  roundPlayingHandicap,
  type TeeRating,
} from "../domain/handicap";
import { holeStrokesReceived, rankStrokeIndex } from "../domain/stroke";
import { parStrokesApply } from "../round-allowance";

/**
 * THE ACCURACY SWEEP, PART 1: WHAT A PLAYER PLAYS OFF (2026-11-09).
 *
 * Every expected figure in this file was worked BY HAND from the Rules of
 * Handicapping (2024 edition) and written in as a literal, with the working in
 * the comment beside it. None is computed by the code under test or by a copy
 * of its formula, so a test here can disagree with the app — which is the only
 * kind of test that can find the app wrong.
 *
 * The working was done in whole numbers (an index in tenths, a rating in
 * tenths, everything over 1130) so that it shares neither formula nor floating
 * point with `domain/handicap.ts`:
 *
 *     Course Handicap x 1130 = (index x 10) x Slope + (CR x 10 - Par x 10) x 113
 *
 * Every row is ABSOLUTE: a constant offset on every player, the error that
 * `docs/claude/combination-sweep.md` point 7 says ordering tests cannot see,
 * moves a figure here off its literal.
 */

/** A rated set of tees, as a club's card prints it. */
const tee = (slopeRating: number, courseRating: number, par: number): TeeRating => ({ slopeRating, courseRating, par });

describe("Course Handicap (Rules of Handicapping 6.1a): Index x Slope / 113 + (Course Rating - Par)", () => {
  // [index, tees, exact Course Handicap to 4 places (hand-worked), whole]
  const ROWS: Array<[number, TeeRating, number, number]> = [
    // 86 x 125 = 10750; + 0 = 10750 / 1130 = 9.5133 -> 10 (the USGA's own example)
    [8.6, tee(125, 71.0, 71), 9.5133, 10],
    // 103 x 125 = 12875 / 1130 = 11.3938 -> 11
    [10.3, tee(125, 71.0, 71), 11.3938, 11],
    // 202 x 128 = 25856; (726 - 730) x 113 = -452; 25404 / 1130 = 22.4814 -> 22
    [20.2, tee(128, 72.6, 73), 22.4814, 22],
    // 200 x 124 = 24800; (698 - 710) x 113 = -1356; 23444 / 1130 = 20.7469 -> 21
    [20.0, tee(124, 69.8, 71), 20.7469, 21],
    // A PLUS index: -23 x 135 = -3105; (731 - 720) x 113 = 1243; -1862 / 1130 = -1.6478 -> -2 (plus 2)
    [-2.3, tee(135, 73.1, 72), -1.6478, -2],
    // 331 x 122 = 40382; (702 - 720) x 113 = -2034; 38348 / 1130 = 33.9363 -> 34
    [33.1, tee(122, 70.2, 72), 33.9363, 34],
  ];
  for (const [index, t, exact, whole] of ROWS) {
    it(`index ${index} off ${t.slopeRating}/${t.courseRating}/par ${t.par} is ${exact} exactly, ${whole} as played`, () => {
      expect(courseHandicapExact(index, t)).toBeCloseTo(exact, 4);
      expect(courseHandicap(index, t)).toBe(whole);
    });
  }
});

describe("Playing Handicap (Rule 6.2a, Appendix C): the allowance is taken of the UNROUNDED Course Handicap, rounded once", () => {
  // [index, tees, allowance, playing handicap (hand-worked), what rounding first would give]
  const ROWS: Array<[number, TeeRating, number, number, number]> = [
    // USGA example, four-ball stroke play at 85%: 9.5133 x 0.85 = 8.086 -> 8 (rounding first: 10 x 0.85 = 8.5 -> 9)
    [8.6, tee(125, 71.0, 71), 85, 8, 9],
    // 11.3938 x 0.85 = 9.685 -> 10 (rounding first: 11 x 0.85 = 9.35 -> 9)
    [10.3, tee(125, 71.0, 71), 85, 10, 9],
    // Individual stroke play at 95%: 57 x 127 = 7239; (712 - 720) x 113 = -904; 6335 / 1130 = 5.6062;
    // x 0.95 = 5.326 -> 5 (rounding first: 6 x 0.95 = 5.7 -> 6)
    [5.7, tee(127, 71.2, 72), 95, 5, 6],
    // Four-ball match play at 90%: 78 x 118 = 9204; (701 - 710) x 113 = -1017; 8187 / 1130 = 7.2451;
    // x 0.9 = 6.5206 -> 7 (rounding first: 7 x 0.9 = 6.3 -> 6)
    [7.8, tee(118, 70.1, 71), 90, 7, 6],
    // Best 1 ball of 4 at 75%: 33.9363 x 0.75 = 25.452 -> 25 (rounding first: 34 x 0.75 = 25.5 -> 26)
    [33.1, tee(122, 70.2, 72), 75, 25, 26],
    // Plus 2.3 at 95%: -1.6478 x 0.95 = -1.5654 -> -2 (still plus 2)
    [-2.3, tee(135, 73.1, 72), 95, -2, -2],
  ];
  for (const [index, t, pct, playing, roundedFirst] of ROWS) {
    it(`index ${index} at ${pct}% plays off ${playing}${playing !== roundedFirst ? ` (not ${roundedFirst})` : ""}`, () => {
      expect(playingHandicapFrom(courseHandicapExact(index, t), pct)).toBe(playing);
    });
  }
});

describe("Tees of a higher par (Rule 6.2b): the difference is added AFTER the allowance", () => {
  // Men off the whites, par 71; ladies off the reds, par 73. The man (20.0) is
  // 20.7469 exactly (worked above). The lady (20.4): 204 x 128 = 26112;
  // (726 - 730) x 113 = -452; 25660 / 1130 = 22.7080 -> 23.
  const tees = new Map([
    ["white", { ...tee(124, 69.8, 71), courseId: "c1" }],
    ["red", { ...tee(128, 72.6, 73), courseId: "c1" }],
  ]);
  const field = [
    { id: "zz-lady", handicap: 20.4, teeId: "red", flightTeeId: null, gender: "F" },
    { id: "zz-man", handicap: 20.0, teeId: null, flightTeeId: null, gender: "M" },
  ];
  const map = courseHandicapMap(field, tees, "white", 18, "own");

  it("the lady is told 23 and given the 2 strokes for the par of her tees, outside the allowance: 24", () => {
    expect(map.get("zz-lady")).toBe(23);
    expect(map.parStrokes("zz-lady")).toBe(2);
    // 22.7080 x 0.95 = 21.5726 -> 22, then + (73 - 71) = 24.
    // NOT 95% of (22.7080 + 2) = 23.47 -> 23: the allowance is not taken of the par strokes.
    expect(roundPlayingHandicap(map.exact("zz-lady")!, 95, map.parStrokes("zz-lady"))).toBe(24);
  });

  it("the man on the lowest par is given none", () => {
    expect(map.get("zz-man")).toBe(21);
    expect(map.parStrokes("zz-man")).toBe(0);
    // 20.7469 x 0.95 = 19.7096 -> 20.
    expect(roundPlayingHandicap(map.exact("zz-man")!, 95, map.parStrokes("zz-man"))).toBe(20);
  });

  it("Stableford gives none: counted against par, each player is already measured against their own (6.2b)", () => {
    expect(parStrokesApply("Stableford", "net")).toBe(false);
    expect(parStrokesApply("Modified Stableford", "net")).toBe(false);
    // And a stroke round SET to points is counted against par all the same.
    expect(parStrokesApply("Stroke Play", "stableford")).toBe(false);
    // Stroke play and match play counted in strokes do (6.2b).
    expect(parStrokesApply("Stroke Play", "net")).toBe(true);
    expect(parStrokesApply("Match Play", "net")).toBe(true);
    expect(parStrokesApply("Four-Ball", "net")).toBe(true);
  });
});

describe("A nine-hole round (Rule 6.1b): half the index, against nine-hole ratings", () => {
  // The club publishes eighteen-hole ratings only; nine-hole CR and par are half.
  const tees = new Map([["white", { ...tee(120, 71.2, 72), courseId: "c1" }]]);

  it("an 18-hole index of 14.6 plays a nine off 7", () => {
    // (14.6 / 2) x 120 / 113 + (35.6 - 36): 73 x 120 = 8760; (356 - 360) x 113 = -452;
    // 8308 / 1130 = 7.3522 -> 7. Not 15 (an eighteen's figure on nine holes).
    const map = courseHandicapMap([{ id: "zz-nine", handicap: 14.6, teeId: null, flightTeeId: null }], tees, "white", 9, "own");
    expect(map.get("zz-nine")).toBe(7);
    expect(map.exact("zz-nine")).toBeCloseTo(7.3522, 4);
  });

  it("the same player on eighteen holes plays off 15", () => {
    // 146 x 120 = 17520; (712 - 720) x 113 = -904; 16616 / 1130 = 14.7044 -> 15.
    const map = courseHandicapMap([{ id: "zz-nine", handicap: 14.6, teeId: null, flightTeeId: null }], tees, "white", 18, "own");
    expect(map.get("zz-nine")).toBe(15);
  });
});

/**
 * The card every allocation below is read off: odd stroke indexes on the front
 * nine, even on the back, as most clubs print them (Rule 6.2, Appendix E).
 */
const SI = [7, 3, 15, 1, 11, 5, 17, 13, 9, 8, 16, 2, 12, 4, 10, 18, 6, 14];
const strokesFor = (playing: number, si: number[] = SI, holes = 18) => si.map((s) => holeStrokesReceived(playing, s, holes));

describe("Where the strokes fall (Rules of Handicapping 6.2, Appendix E)", () => {
  it("a 20 gets two on stroke index 1 and 2 and one everywhere else", () => {
    expect(strokesFor(20)).toEqual([1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1]);
  });

  it("a 40 gets three on stroke index 1 to 4 and two everywhere else", () => {
    // 40 = 2 x 18 + 4. SI 1 is hole 4, SI 2 hole 12, SI 3 hole 2, SI 4 hole 14.
    expect(strokesFor(40)).toEqual([2, 3, 2, 3, 2, 2, 2, 2, 2, 2, 2, 3, 2, 3, 2, 2, 2, 2]);
  });

  it("a 54 (the most an index can be) gets three on every hole", () => {
    expect(strokesFor(54)).toEqual(Array(18).fill(3));
  });

  it("a plus 3 gives back on stroke index 16, 17 and 18 — the easiest holes, not the hardest", () => {
    // SI 16 is hole 11, SI 17 hole 7, SI 18 hole 16.
    const back = strokesFor(-3);
    expect(back.filter((s) => s !== 0)).toEqual([-1, -1, -1]);
    expect(back[10]).toBe(-1);
    expect(back[6]).toBe(-1);
    expect(back[15]).toBe(-1);
    expect(back[3], "nothing is given back on stroke index 1").toBe(0);
  });

  it("a nine-hole round ranks the nine it plays 1 to 9 before allocating", () => {
    const front = SI.slice(0, 9); // 7, 3, 15, 1, 11, 5, 17, 13, 9
    const ranked = rankStrokeIndex(front);
    expect(ranked).toEqual([4, 2, 8, 1, 6, 3, 9, 7, 5]);
    // A nine-hole 7: one on every hole but the two easiest (SI 15 -> rank 8, SI 17 -> rank 9).
    expect(strokesFor(7, ranked, 9)).toEqual([1, 1, 0, 1, 1, 1, 0, 1, 1]);
    // A nine-hole 11: two on ranks 1 and 2 (holes 4 and 2), one elsewhere = 11.
    const eleven = strokesFor(11, ranked, 9);
    expect(eleven).toEqual([1, 2, 1, 2, 1, 1, 1, 1, 1]);
    expect(eleven.reduce((a, b) => a + b, 0)).toBe(11);
    // A nine-hole plus 2 gives back on ranks 9 and 8 (holes 7 and 3).
    expect(strokesFor(-2, ranked, 9)).toEqual([0, 0, -1, 0, 0, 0, -1, 0, 0]);
  });

  it("every handicap from plus 10 to 54 hands out exactly its own number of strokes over eighteen", () => {
    for (let h = -10; h <= 54; h += 1) {
      expect(strokesFor(h).reduce((a, b) => a + b, 0), `a ${h}`).toBe(h);
    }
  });
});
