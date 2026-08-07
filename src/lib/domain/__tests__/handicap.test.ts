import { describe, it, expect } from "vitest";
import {
  courseHandicap,
  playingHandicapFrom,
  clampSlope,
  nineHoleTee,
  isRated,
  explainHandicap,
  STANDARD_SLOPE,
  MIN_SLOPE,
  MAX_SLOPE,
  type TeeRating,
} from "../handicap";
import { holeStrokesReceived } from "../stroke";

const tee = (over: Partial<TeeRating> = {}): TeeRating => ({
  courseRating: 71.5,
  slopeRating: 125,
  par: 72,
  ...over,
});

describe("Course Handicap — the conversion the app was missing", () => {
  it("matches a worked WHS example", () => {
    // Index 10.5, slope 125, CR 71.5, par 72:
    //   10.5 × (125/113) = 11.615, + (71.5 − 72) = 11.115 → 11
    expect(courseHandicap(10.5, tee())).toBe(11);
  });

  it("matches a second, harder course", () => {
    // Index 22.0, slope 145, CR 74.2, par 72:
    //   22 × (145/113) = 28.23, + 2.2 = 30.43 → 30
    expect(courseHandicap(22.0, tee({ slopeRating: 145, courseRating: 74.2 }))).toBe(30);
  });

  it("gives a high-slope course more strokes than the raw index", () => {
    // The headline case: a 12.4 index off 140 slope is worth 15 strokes, not
    // 12. Scoring it as 12 is what the app did before this existed.
    const strokes = courseHandicap(12.4, tee({ slopeRating: 140, courseRating: 72, par: 72 }));
    expect(strokes).toBe(15);
    expect(strokes).toBeGreaterThan(Math.round(12.4));
  });

  it("gives an easy course fewer strokes", () => {
    expect(courseHandicap(18, tee({ slopeRating: 95, courseRating: 68, par: 72 }))).toBeLessThan(18);
  });

  it("leaves an index unchanged at standard slope and rating equal to par", () => {
    // 113 is the neutral slope by definition, so a course of exactly that
    // difficulty should not move the number at all.
    expect(courseHandicap(14, tee({ slopeRating: STANDARD_SLOPE, courseRating: 72, par: 72 }))).toBe(14);
  });

  it("applies the rating term when a course plays harder than its par", () => {
    // Same slope, rating two strokes above par: two more strokes.
    const level = courseHandicap(10, tee({ slopeRating: STANDARD_SLOPE, courseRating: 72, par: 72 }));
    const hard = courseHandicap(10, tee({ slopeRating: STANDARD_SLOPE, courseRating: 74, par: 72 }));
    expect(hard - level).toBe(2);
  });

  it("handles a plus handicap without inverting the maths", () => {
    // A scratch-or-better player: the sign has to survive the conversion.
    expect(courseHandicap(-2.4, tee({ slopeRating: 140, courseRating: 72, par: 72 }))).toBeLessThan(0);
  });
});

describe("courses with no rating on file", () => {
  it("falls back to the raw index rather than refusing to score", () => {
    // Societies routinely play courses whose rating nobody has to hand, and
    // this is what the app did for its whole life. Blocking the round would
    // be a worse answer than an unrated one.
    expect(courseHandicap(14.2, null)).toBe(14);
    expect(courseHandicap(14.2, undefined)).toBe(14);
    expect(courseHandicap(14.2, {})).toBe(14);
    expect(courseHandicap(14.2, { slopeRating: 0 })).toBe(14);
  });

  it("still applies slope when only the rating is missing", () => {
    // Slope is the larger and more important of the two terms, so a tee with
    // slope but no rating should not throw that away.
    expect(courseHandicap(10, { slopeRating: 140 })).toBe(Math.round(10 * (140 / 113)));
  });

  it("reports whether a tee is rated", () => {
    expect(isRated(tee())).toBe(true);
    expect(isRated({ slopeRating: 0 })).toBe(false);
    expect(isRated(null)).toBe(false);
  });
});

describe("bad data can't distort a field", () => {
  it("clamps a slope outside the published range", () => {
    expect(clampSlope(200)).toBe(MAX_SLOPE);
    expect(clampSlope(10)).toBe(MIN_SLOPE);
    expect(clampSlope(Number.NaN)).toBe(STANDARD_SLOPE);
  });

  it("uses the clamp in the conversion, not just in validation", () => {
    // A typo of 1250 for 125 must not hand somebody 100 extra strokes.
    expect(courseHandicap(10, tee({ slopeRating: 1250 }))).toBe(
      courseHandicap(10, tee({ slopeRating: MAX_SLOPE })),
    );
  });

  it("returns zero for a non-numeric index rather than NaN", () => {
    // NaN would propagate silently into every hole allocation.
    expect(courseHandicap(Number.NaN, tee())).toBe(0);
  });
});

describe("Playing Handicap", () => {
  it("applies the format allowance to the course handicap", () => {
    expect(playingHandicapFrom(20, 90)).toBe(18);
    expect(playingHandicapFrom(20, 50)).toBe(10);
    expect(playingHandicapFrom(20, 100)).toBe(20);
  });

  it("rounds the course handicap first, then the allowance", () => {
    // Two roundings on purpose: the course handicap is a real number a player
    // is told on the first tee, and the allowance applies to that. Collapsing
    // them gives a different answer often enough to cause arguments.
    const ch = courseHandicap(10.5, tee()); // 11
    expect(ch).toBe(11);
    expect(playingHandicapFrom(ch, 90)).toBe(10); // 9.9 → 10
  });
});

describe("nine-hole rounds", () => {
  it("halves an eighteen-hole rating as the documented approximation", () => {
    const nine = nineHoleTee(tee({ courseRating: 71.4, par: 72 }));
    expect(nine.courseRating).toBeCloseTo(35.7, 5);
    expect(nine.par).toBe(36);
    expect(nine.slopeRating).toBe(125); // slope is not halved
  });

  it("gives roughly half the strokes over nine holes", () => {
    const full = courseHandicap(18, tee({ slopeRating: STANDARD_SLOPE, courseRating: 72, par: 72 }));
    const half = courseHandicap(9, nineHoleTee(tee({ slopeRating: STANDARD_SLOPE, courseRating: 72, par: 72 })));
    expect(half).toBe(Math.round(full / 2));
  });
});

describe("it feeds stroke allocation correctly", () => {
  it("hands the allocator a course handicap, not an index", () => {
    // The bug this whole file prevents: allocating off 12 when the player is
    // entitled to 15 shorts them three holes' worth of strokes.
    const index = 12.4;
    const ch = courseHandicap(index, tee({ slopeRating: 140, courseRating: 72, par: 72 }));
    const wrong = holeStrokesReceived(Math.round(index), 14);
    const right = holeStrokesReceived(ch, 14);
    expect(ch).toBe(15);
    expect(right).toBe(1);
    expect(wrong).toBe(0); // stroke index 14 gets nothing off 12, one off 15
  });

  it("allocates every stroke it grants", () => {
    const ch = courseHandicap(18, tee({ slopeRating: STANDARD_SLOPE, courseRating: 72, par: 72 }));
    const si = Array.from({ length: 18 }, (_, i) => i + 1);
    const total = si.reduce((sum, s) => sum + holeStrokesReceived(ch, s), 0);
    expect(total).toBe(ch);
  });
});

describe("explaining the number to a golfer who asks", () => {
  it("shows the arithmetic rather than asserting a result", () => {
    // "The computer said so" is not an answer a committee can give.
    const e = explainHandicap(10.5, tee(), 100);
    expect(e.courseHandicap).toBe(11);
    expect(e.rated).toBe(true);
    expect(e.detail).toContain("10.5");
    expect(e.detail).toContain("125");
    expect(e.detail).toContain("113");
  });

  it("mentions the allowance only when it changes the number", () => {
    expect(explainHandicap(10.5, tee(), 100).detail).not.toMatch(/playing handicap/);
    expect(explainHandicap(10.5, tee(), 90).detail).toMatch(/90%/);
  });

  it("says plainly when the tees are unrated", () => {
    const e = explainHandicap(14.2, null, 100);
    expect(e.rated).toBe(false);
    expect(e.detail).toMatch(/No course rating/);
    expect(e.courseHandicap).toBe(14);
  });
});
