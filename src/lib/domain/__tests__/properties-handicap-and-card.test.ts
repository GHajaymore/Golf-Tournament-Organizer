import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  courseHandicap,
  courseHandicapExact,
  playingHandicapFrom,
  roundPlayingHandicap,
  CourseHandicaps,
} from "../handicap";
import { holeStrokesReceived, stablefordPointsForHole, computeStrokeCard, rankStrokeIndex, strokesReceivedOnHolesPlayed } from "../stroke";
import { courseHandicapRef, playingHandicapRef, strokesByHandingOut, stablefordByName } from "./properties-reference";

/**
 * PROPERTIES OF A HANDICAP AND A CARD, each a Rule checked against the Rule
 * worked in whole numbers (`properties-reference.ts`) — foundation pass,
 * 2026-10-23, at the testing panel's request.
 *
 * Fixed seeds, so a run is repeatable and a failure is the same failure on
 * every machine. A failure fast-check shrinks is pinned below as an ordinary
 * test, so it is found again without the generator.
 */
const RUNS = { seed: 20261023, numRuns: 2000 } as const;

const tee = fc.record({
  slope: fc.integer({ min: 55, max: 155 }),
  par: fc.integer({ min: 54, max: 76 }),
  ratingOff: fc.integer({ min: -60, max: 60 }), // tenths either side of par
});
/** A Handicap Index has one decimal place, from plus 10 to 54 (Rule 5.3). */
const indexTenths = fc.integer({ min: -100, max: 540 });

/** A stroke index: every number from 1 to n, once each, in some order. */
const strokeIndexOf = (n: number) =>
  fc.shuffledSubarray(Array.from({ length: n }, (_, i) => i + 1), { minLength: n, maxLength: n });

describe("a handicap (Rules of Handicapping 6.1, 6.2a)", () => {
  it("the Course Handicap is Index × Slope ÷ 113 + (Rating − Par), rounded once, a half upwards", () => {
    fc.assert(
      fc.property(indexTenths, tee, (i, t) => {
        const rating = t.par * 10 + t.ratingOff;
        const app = courseHandicap(i / 10, { courseRating: rating / 10, slopeRating: t.slope, par: t.par });
        expect(app).toBe(courseHandicapRef(i, t.slope, rating, t.par));
      }),
      RUNS,
    );
  });

  it("the Playing Handicap is the allowance of the UNROUNDED Course Handicap, rounded once", () => {
    fc.assert(
      fc.property(indexTenths, tee, fc.integer({ min: 0, max: 100 }), (i, t, pct) => {
        const rating = t.par * 10 + t.ratingOff;
        const exact = courseHandicapExact(i / 10, { courseRating: rating / 10, slopeRating: t.slope, par: t.par });
        expect(playingHandicapFrom(exact, pct)).toBe(playingHandicapRef(i, t.slope, rating, t.par, pct));
      }),
      RUNS,
    );
  });

  it("the strokes for tees of a higher par (6.2b) are added AFTER the allowance, and are the difference from the field's lowest par", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ i: indexTenths, par: fc.integer({ min: 69, max: 74 }) }), { minLength: 1, maxLength: 12 }),
        fc.integer({ min: 0, max: 100 }),
        (field, pct) => {
          const lowest = Math.min(...field.map((p) => p.par));
          const map = new CourseHandicaps();
          map.setFieldPars(field.map((p) => p.par));
          field.forEach((p, k) => {
            map.setExact(`p${k}`, courseHandicapExact(p.i / 10, { courseRating: p.par, slopeRating: 113, par: p.par }));
            map.setPar(`p${k}`, p.par);
          });
          field.forEach((p, k) => {
            const extra = p.par - lowest;
            expect(map.parStrokes(`p${k}`)).toBe(extra);
            // Slope 113 and rating = par: the Course Handicap is the index itself.
            expect(roundPlayingHandicap(map.exact(`p${k}`)!, pct, map.parStrokes(`p${k}`))).toBe(
              playingHandicapRef(p.i, 113, p.par * 10, p.par, pct) + extra,
            );
          });
        },
      ),
      RUNS,
    );
  });

  it("a map of part of the field still measures from the FIELD's lowest par", () => {
    const pot = new CourseHandicaps();
    pot.setFieldPars([71, 72]);
    pot.setExact("lady", 18).setPar("lady", 72);
    expect(pot.parStrokes("lady")).toBe(1);
  });
});

describe("strokes by stroke index (Rule 6.2, Appendix E)", () => {
  it("every playing handicap, on eighteen holes or nine, is handed out one stroke at a time from stroke index 1 — and back from the highest when it is plus", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(9, 18).chain((n) => fc.tuple(fc.constant(n), strokeIndexOf(n), fc.integer({ min: -12, max: 80 }))),
        ([n, si, playing]) => {
          const app = si.map((s) => holeStrokesReceived(playing, s, n));
          expect(app).toEqual(strokesByHandingOut(playing, si));
          expect(app.reduce((a, b) => a + b, 0)).toBe(playing);
          // Never -0: it prints as "-0" on a card.
          for (const x of app) expect(Object.is(x, -0)).toBe(false);
        },
      ),
      RUNS,
    );
  });

  it("a nine cut from an eighteen keeps its holes' order of difficulty, re-ranked 1 to 9 — front nine or back", () => {
    fc.assert(
      fc.property(strokeIndexOf(18), fc.boolean(), (si18, back) => {
        const nine = back ? si18.slice(9) : si18.slice(0, 9);
        const ranked = rankStrokeIndex(nine);
        expect([...ranked].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
        for (let a = 0; a < 9; a += 1) {
          for (let b = 0; b < 9; b += 1) {
            if (nine[a] < nine[b]) expect(ranked[a]).toBeLessThan(ranked[b]);
          }
        }
      }),
      RUNS,
    );
  });

  it("the strokes received over the holes played count only the holes with a score", () => {
    fc.assert(
      fc.property(
        strokeIndexOf(18),
        fc.integer({ min: -5, max: 40 }),
        fc.array(fc.option(fc.integer({ min: 1, max: 12 }), { nil: null }), { minLength: 18, maxLength: 18 }),
        (si, playing, strokes) => {
          const each = strokesByHandingOut(playing, si);
          const expected = each.reduce((a, s, h) => a + (strokes[h] != null ? s : 0), 0);
          expect(strokesReceivedOnHolesPlayed(playing, strokes, si, 18)).toBe(expected);
        },
      ),
      RUNS,
    );
  });

  // Pinned from the Rules, without a generator.
  it("a plus 2 gives two strokes BACK, on stroke index 17 and 18; a 54 receives three on every hole", () => {
    const si = Array.from({ length: 18 }, (_, i) => i + 1);
    expect(si.map((s) => holeStrokesReceived(-2, s, 18))).toEqual([...Array(16).fill(0), -1, -1]);
    expect(si.map((s) => holeStrokesReceived(54, s, 18))).toEqual(Array(18).fill(3));
    expect(si.map((s) => holeStrokesReceived(-1, s, 9)).slice(0, 9)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, -1]);
  });
});

describe("a card (Rule 21.1 Stableford; Rule 3.3 stroke play)", () => {
  it("Stableford points are the scorer's table: 0 for net double bogey or worse, 1 bogey, 2 par, 3 birdie, 4 eagle …", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 15 }), fc.integer({ min: 3, max: 6 }), fc.integer({ min: -3, max: 5 }), (gross, par, shots) => {
        expect(stablefordPointsForHole(gross, par, shots)).toBe(stablefordByName(gross - shots, par));
      }),
      RUNS,
    );
  });

  it("a full card's gross, to par, net and points add up hole by hole", () => {
    fc.assert(
      fc.property(
        strokeIndexOf(18),
        fc.array(fc.integer({ min: 3, max: 5 }), { minLength: 18, maxLength: 18 }),
        fc.array(fc.integer({ min: 1, max: 12 }), { minLength: 18, maxLength: 18 }),
        fc.integer({ min: -5, max: 40 }),
        (si, pars, strokes, playing) => {
          const each = strokesByHandingOut(playing, si);
          const card = computeStrokeCard(strokes, pars, playing, si);
          const gross = strokes.reduce((a, b) => a + b, 0);
          expect(card.gross).toBe(gross);
          expect(card.played).toBe(18);
          expect(card.toPar).toBe(gross - pars.reduce((a, b) => a + b, 0));
          expect(card.net).toBe(gross - playing);
          expect(card.points).toBe(strokes.reduce((a, s, h) => a + stablefordByName(s - each[h], pars[h]), 0));
        },
      ),
      RUNS,
    );
  });
});
