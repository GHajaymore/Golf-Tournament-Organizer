import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { courseHandicap, courseHandicapExact } from "../handicap";
import { playingHandicapInRound } from "../../round-allowance";
import { courseHandicapOver1130, roundHalfUp } from "./properties-reference";

/**
 * THE ALLOWANCE A ROUND PLAYS AT, AS A PROPERTY (2026-10-31, backlog A7: the
 * property half of what lets money and handicap changes come down from three
 * rounds — see `ARITHMETIC_KEEPS_THREE_ROUNDS` in scripts/qa/layers.mjs).
 *
 * `properties-handicap-and-card.test.ts` holds `playingHandicapFrom` — one
 * figure, one percentage. This holds the ROUND's whole path, the one every
 * board and match screen prices through (`playingHandicapInRound`): which
 * allowance the round plays at, which figure it is taken of, and the strokes
 * for tees of a higher par, in that order.
 *
 * Worked from the Rules by a route the code does not take:
 *
 *   - the allowance is read from Appendix C as written below, not from the
 *     format table (`formats.ts`) and `recommendedAllowance`;
 *   - the Course Handicap is the exact fraction over 1130 in whole numbers
 *     (`courseHandicapOver1130`), never a float;
 *   - the allowance is taken of THAT, and rounded once, a half upwards
 *     (Rule 6.2a); then the par difference is added (Rule 6.2b) — except where
 *     the result is counted against par (Stableford), which the Rule leaves out.
 */
const RUNS = { seed: 20261031, numRuns: 2000 } as const;

/** Rules of Handicapping, Appendix C — the recommended allowances, for the rounds this table names. */
const APPENDIX_C = [
  { format: "Stroke Play", type: "Stroke Play Round", basis: "net", pct: 95, parStrokes: true, rule: "individual stroke play 95%" },
  { format: "Stableford", type: "Stroke Play Round", basis: "stableford", pct: 95, parStrokes: false, rule: "individual Stableford 95%; counted against par, so no 6.2b strokes" },
  { format: "Modified Stableford", type: "Stroke Play Round", basis: "stableford", pct: 95, parStrokes: false, rule: "as Stableford" },
  { format: "Match Play", type: "Single Match Stage", basis: "net", pct: 100, parStrokes: true, rule: "individual match play 100%" },
  { format: "Match Play", type: "Bracket Stage", basis: "net", pct: 100, parStrokes: true, rule: "individual match play 100%" },
  { format: "Four-Ball", type: "Stroke Play Round", basis: "net", pct: 85, parStrokes: true, rule: "four-ball stroke play 85%" },
  { format: "Four-Ball", type: "Single Match Stage", basis: "net", pct: 90, parStrokes: true, rule: "four-ball match play 90%" },
  { format: "Four-Ball", type: "Round Robin", basis: "net", pct: 90, parStrokes: true, rule: "four-ball match play 90%" },
] as const;

const round = fc.constantFrom(...APPENDIX_C);
/** A Handicap Index has one decimal place, from plus 10 to 54 (Rule 5.3). */
const indexTenths = fc.integer({ min: -100, max: 540 });
const tee = fc.record({
  slope: fc.integer({ min: 55, max: 155 }),
  par: fc.integer({ min: 66, max: 74 }),
  ratingOff: fc.integer({ min: -60, max: 60 }),
});
/** The strokes for tees of a higher par: the difference from the field's lowest (Rule 6.2b). */
const parDiff = fc.integer({ min: 0, max: 4 });

function member(i: number, t: { slope: number; par: number; ratingOff: number }, parStrokes: number) {
  const ratingTenths = t.par * 10 + t.ratingOff;
  const rating = { courseRating: ratingTenths / 10, slopeRating: t.slope, par: t.par };
  return {
    figures: { whole: courseHandicap(i / 10, rating), exact: courseHandicapExact(i / 10, rating), parStrokes },
    over1130: courseHandicapOver1130(i, t.slope, ratingTenths, t.par),
  };
}

describe("a round's Playing Handicap (Rules of Handicapping 6.2a, 6.2b, Appendix C)", () => {
  it("is the round's Appendix C allowance of the EXACT Course Handicap, rounded once, plus the par difference where the Rule gives it", () => {
    fc.assert(
      fc.property(round, indexTenths, tee, parDiff, (r, i, t, diff) => {
        const m = member(i, t, diff);
        const app = playingHandicapInRound({ format: r.format, type: r.type, scoringBasis: r.basis, handicapAllowance: 0 }, null, m.figures);
        const byTheRules = roundHalfUp(m.over1130 * BigInt(r.pct), 113000n) + (r.parStrokes ? diff : 0);
        expect(app, `${r.rule}: index ${i / 10}, slope ${t.slope}, par ${t.par}, +${diff}`).toBe(byTheRules);
      }),
      RUNS,
    );
  });

  it("a committee's allowance for the round replaces Appendix C's, and is taken of the same exact figure", () => {
    fc.assert(
      fc.property(round, indexTenths, tee, parDiff, fc.integer({ min: 1, max: 100 }), (r, i, t, diff, committee) => {
        const m = member(i, t, diff);
        const app = playingHandicapInRound({ format: r.format, type: r.type, scoringBasis: r.basis, handicapAllowance: committee }, null, m.figures);
        expect(app).toBe(roundHalfUp(m.over1130 * BigInt(committee), 113000n) + (r.parStrokes ? diff : 0));
      }),
      RUNS,
    );
  });

  it("a committee's figure for the PLAYER is a whole number, and the allowance is taken of what they said", () => {
    fc.assert(
      fc.property(round, indexTenths, tee, parDiff, fc.integer({ min: 0, max: 54 }), (r, i, t, diff, said) => {
        const m = member(i, t, diff);
        const app = playingHandicapInRound(
          { format: r.format, type: r.type, scoringBasis: r.basis, handicapAllowance: 0 },
          { frozen: null, frozenExact: null, override: said, frozenParStrokes: null },
          m.figures,
        );
        expect(app).toBe(roundHalfUp(BigInt(said) * BigInt(r.pct), 100n) + (r.parStrokes ? diff : 0));
      }),
      RUNS,
    );
  });

  it("CONTROL: the cases above reach the axis — taking the allowance of the ROUNDED figure gives a different answer in a share of them", () => {
    // Without this, a generator that only ever met whole Course Handicaps would pass a
    // twice-rounded implementation, and the first property would be asserting nothing.
    const cases = fc.sample(fc.tuple(round, indexTenths, tee), { seed: RUNS.seed, numRuns: RUNS.numRuns });
    const differ = cases.filter(([r, i, t]) => {
      const m = member(i, t, 0);
      const once = roundHalfUp(m.over1130 * BigInt(r.pct), 113000n);
      const twice = roundHalfUp(BigInt(roundHalfUp(m.over1130, 1130n)) * BigInt(r.pct), 100n);
      return r.pct !== 100 && once !== twice;
    }).length;
    expect(differ).toBeGreaterThan(cases.length / 50);
  });
});
