import { describe, it, expect } from "vitest";
import { cardImportProblem, courseInputProblem, playedChoice, teeInputProblem } from "../course-payload";

const GOOD_COURSE = { name: "Zz Links", city: "Nowhere", pars: new Array(18).fill(4), yards: new Array(18).fill(400), strokeIndex: [] as number[] };
const GOOD_TEE = { name: "Blue", gender: "any", courseRating: 71.5, slopeRating: 125, par: 72 };

describe("the course library's payload boundary (R2a, S5)", () => {
  it("played: only the three answers; anything else is the question", () => {
    expect(playedChoice("rescore")).toBe("rescore");
    expect(playedChoice("keep-history")).toBe("keep-history");
    expect(playedChoice("ask")).toBe("ask");
    for (const bad of ["RESCORE", "", " rescore", "keep_history", 1, null, undefined, {}, ["rescore"]]) {
      expect(playedChoice(bad), String(bad)).toBe("ask");
    }
  });

  it("a course: fit input passes, every unfit shape is refused in words", () => {
    expect(courseInputProblem(GOOD_COURSE)).toBeNull();
    expect(courseInputProblem({ ...GOOD_COURSE, strokeIndex: [1, NaN, 3] })).toBeNull(); // blanks are legitimate
    for (const bad of [null, "x", 5, { ...GOOD_COURSE, name: 5 }, { ...GOOD_COURSE, name: "x".repeat(121) },
      { ...GOOD_COURSE, city: {} }, { ...GOOD_COURSE, pars: "4,4" }, { ...GOOD_COURSE, pars: new Array(40).fill(4) },
      { ...GOOD_COURSE, yards: ["400"] }, { ...GOOD_COURSE, id: 7 }]) {
      expect(courseInputProblem(bad), JSON.stringify(bad)).toMatch(/\S/);
    }
  });

  it("a tee: NaN and Infinity never reach teeProblem", () => {
    expect(teeInputProblem(GOOD_TEE)).toBeNull();
    expect(teeInputProblem({ ...GOOD_TEE, courseRating: 0, slopeRating: 0 })).toBeNull(); // "not rated yet"
    for (const key of ["par", "courseRating", "slopeRating"] as const) {
      for (const v of [NaN, Infinity, -Infinity, "72", null, undefined]) {
        expect(teeInputProblem({ ...GOOD_TEE, [key]: v }), `${key}=${String(v)}`).toMatch(/numbers/);
      }
    }
    expect(teeInputProblem({ ...GOOD_TEE, name: 3 })).toMatch(/name/);
    expect(teeInputProblem({ ...GOOD_TEE, name: "x".repeat(61) })).toMatch(/at most/);
    expect(teeInputProblem(null)).toMatch(/\S/);
  });

  it("a pasted card: strings only, capped", () => {
    const ok = { name: "Zz Links", pars: "4 4 3", strokeIndex: "1 2 3" };
    expect(cardImportProblem(ok)).toBeNull();
    for (const bad of [{ ...ok, name: 1 }, { ...ok, pars: ["4"] }, { ...ok, strokeIndex: "1 ".repeat(400) },
      { ...ok, yards: 5 }, { ...ok, holes: "9" }, { ...ok, city: [] }, null]) {
      expect(cardImportProblem(bad), JSON.stringify(bad)).toMatch(/\S/);
    }
  });
});
