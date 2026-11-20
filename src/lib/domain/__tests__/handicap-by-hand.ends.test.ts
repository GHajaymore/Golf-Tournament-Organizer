import { describe, expect, it } from "vitest";
import {
  CourseHandicaps,
  courseHandicapMap,
  explainHandicap,
  indexForHoles,
  ladiesTeeOn,
  teeIdFor,
  type IndexHolder,
  type TeeRating,
} from "../handicap";
import { endsWithin } from "../../__tests__/ends-within";

/**
 * `domain/handicap.ts`, WORKED BY HAND, AND RUN FIRST (2026-11-10).
 *
 * The nightly of 10 Nov (on 2e1c07d7) held production on this module: 207 of 249 mutants caught
 * against a floor of 209. Two kills were lost, not because a test changed, but because the run was
 * cold. The night before took its results for `indexForHoles` from Stryker's incremental file, where
 * `nine-hole-index.test.ts` had killed them; the cold run had to reach that file again, behind
 * forty-odd covering tests in `matrix.test.ts` and the tee files, and ran out of time first. A plain
 * timeout counts as NOT caught (`scripts/qa/mutation-ratchet.mjs`). Fifteen more mutants on the tee
 * resolution in `courseHandicapMap` had ended the same way for longer.
 *
 * So these tests are in a `*.ends.test.ts` file, which the mutation run sorts FIRST
 * (`vitest.mutation.config.ts`): Stryker stops a mutant's run at the first failing test, and a small
 * assertion that fails here is a kill before any slow file can turn it into a timeout. Each call is
 * held to a deadline (`endsWithin`), as every file of that name must be.
 *
 * The figures are worked from the Rules of Handicapping by hand, not by calling the code's own
 * helpers: Course Handicap = Index × (Slope ÷ 113) + (Course Rating − Par) (Rule 6.1), the allowance
 * taken of the unrounded figure and rounded once, a half upwards (Rule 6.2a), and a nine-hole index on
 * a nine-hole round used as it is (Rule 6.1b). Indexes have a decimal place, as a golfer's does.
 */
const ends = <T,>(call: () => T): T => endsWithin(call);

/** Tees on two courses, and one row with no course at all (a caller that supplies ratings only). */
type Row = TeeRating & { courseId?: string; gender?: string | null };
const TEES = new Map<string, Row>([
  ["a-white", { courseRating: 70.4, slopeRating: 128, par: 71, courseId: "A" }],
  ["b-blue", { courseRating: 74.1, slopeRating: 141, par: 72, courseId: "B" }],
  ["loose", { courseRating: 72.0, slopeRating: 135, par: 72 }],
]);

const player = (teeId: string | null, handicap = 12.3): IndexHolder => ({ id: "p", handicap, teeId, flightTeeId: null });

/*
 * Index 12.3, by hand:
 *   on a-white  12.3 × 128 ÷ 113 = 1574.4 ÷ 113 = 13.933  + (70.4 − 71 = −0.6) = 13.333  → 13
 *   on b-blue   12.3 × 141 ÷ 113 = 1734.3 ÷ 113 = 15.348  + (74.1 − 72 = +2.1) = 17.448  → 17
 *   on loose    12.3 × 135 ÷ 113 = 1660.5 ÷ 113 = 14.695  + (72.0 − 72 =  0  ) = 14.695  → 15
 *   unrated     12.3 as it is                                                            → 12
 */
const ON_A_WHITE = 13;
const ON_B_BLUE = 17;
const ON_LOOSE = 15;
const UNRATED = 12;

const whole = (teeId: string | null, defaultTeeId: string | null, policy = "own") =>
  ends(() => courseHandicapMap([player(teeId)], TEES, defaultTeeId, 18, policy)).get("p");

describe("a player's tees are the course being played, worked by hand", () => {
  it("a stored set at ANOTHER course is stepped past: the round's own set prices the card", () => {
    expect(whole("b-blue", "a-white")).toBe(ON_A_WHITE);
  });

  it("with no round set there is no course to be on the wrong side of: the player's own set prices it", () => {
    expect(whole("b-blue", null)).toBe(ON_B_BLUE);
  });

  it("a stored set this map has never heard of falls through to the round's set, not to unrated", () => {
    expect(whole("ghost", "a-white")).toBe(ON_A_WHITE);
  });

  it("a set with no course on its row cannot be judged, so it is honoured as it always was", () => {
    expect(whole("loose", "a-white")).toBe(ON_LOOSE);
  });

  it("a round set missing from the map leaves the player unrated, and does not throw", () => {
    expect(whole(null, "missing")).toBe(UNRATED);
  });
});

describe("the index is converted to the holes played (Rule 6.1b)", () => {
  it("a nine-hole index on a nine-hole round is used as it is: 14.6 stays 14.6", () => {
    expect(ends(() => indexForHoles(14.6, "9", 9))).toBe(14.6);
  });

  it("an index that is not a number is nought, never NaN on a card", () => {
    expect(ends(() => indexForHoles(Number.NaN, undefined, 18))).toBe(0);
    expect(ends(() => indexForHoles(Number.POSITIVE_INFINITY, undefined, 9))).toBe(0);
  });
});

describe("the ladies' set on a course", () => {
  const sets = (rows: Array<[string, string | undefined, string, number]>) =>
    rows.map(([id, courseId, gender, courseRating]) => [id, { courseId, gender, courseRating }] as const);

  it("is the women's set with the LOWEST course rating at that course, wherever it sits on the card", () => {
    const tees = sets([
      ["red", "A", "F", 70.1],
      ["gold", "A", "Ladies", 72.4],
      ["white", "A", "M", 69.0],
      ["b-red", "B", "F", 65.2],
    ]);
    expect(ends(() => ladiesTeeOn(tees, "A"))).toBe("red");
  });

  it("on a tie of ratings goes to the set further down the card", () => {
    const tees = sets([
      ["red-front", "A", "F", 70.1],
      ["red-back", "A", "F", 70.1],
    ]);
    expect(ends(() => ladiesTeeOn(tees, "A"))).toBe("red-back");
  });

  it("is nobody's when the course is not known, even where rows carry no course either", () => {
    const tees = sets([["loose-red", undefined, "F", 70.1]]);
    expect(ends(() => ladiesTeeOn(tees, undefined))).toBeNull();
    expect(ends(() => ladiesTeeOn(tees, null))).toBeNull();
  });
});

describe("with no set anywhere, a player's tee is none — the empty id, never a made-up one", () => {
  const anywhere = () => true;
  it("under each player's own set", () => {
    expect(ends(() => teeIdFor("own", null, null, null, anywhere, null))).toBe("");
  });
  it("under the flight's set", () => {
    expect(ends(() => teeIdFor("flight", null, null, null, anywhere, null))).toBe("");
  });
});

describe("a field's Course Handicaps", () => {
  it("a whole figure set with no unrounded one behind it is its own exact figure, nought included", () => {
    const m = new CourseHandicaps();
    m.set("scratch", 0);
    expect(ends(() => m.exact("scratch"))).toBe(0);
  });

  it("strokes for the pars are never fewer than nought (Rule 6.2b gives the higher par the difference, and takes nothing)", () => {
    // A map whose field was named without this player's tees: par 71 against a field lowest of 72.
    const m = new CourseHandicaps().setExact("a", 10.4).setPar("a", 71).setFieldPars([72]);
    expect(ends(() => m.parStrokes("a"))).toBe(0);
  });
});

describe("the sentence a committee reads out, with every figure worked by hand", () => {
  // 14.6 × 125 ÷ 113 = 1825 ÷ 113 = 16.150; + (71.3 − 72) = 15.450 → a course handicap of 15;
  // 95% of 15.450 = 14.678 → 15 (Rule 6.2a: the allowance of the unrounded figure, rounded once).
  const rated = { courseRating: 71.3, slopeRating: 125, par: 72 };

  it("at an allowance, it shows the unrounded figure the allowance was taken of", () => {
    expect(ends(() => explainHandicap(14.6, rated, 95)).detail).toBe(
      "Index 14.6 × (125 ÷ 113) + (71.3 − 72) = 15.45, a course handicap of 15; 95% of 15.45 = 15 playing handicap",
    );
  });

  it("at the full handicap, it is the course handicap alone", () => {
    expect(ends(() => explainHandicap(14.6, rated, 100)).detail).toBe("Index 14.6 × (125 ÷ 113) + (71.3 − 72) = 15 course handicap");
  });

  it("a set with a slope and no par has no rating term to show: 16.150 → 16", () => {
    expect(ends(() => explainHandicap(14.6, { courseRating: 71.3, slopeRating: 125 }, 100)).detail).toBe(
      "Index 14.6 × (125 ÷ 113) = 16 course handicap",
    );
  });

  it("unrated, the index is used as it is, and an allowance is said only when there is one: 90% of 14.6 = 13.14 → 13", () => {
    expect(ends(() => explainHandicap(14.6, null, 100)).detail).toBe("No course rating for these tees, so the index of 14.6 is used as-is");
    expect(ends(() => explainHandicap(14.6, null, 90)).detail).toBe(
      "No course rating for these tees, so the index of 14.6 is used as-is, at 90% = 13",
    );
  });
});
