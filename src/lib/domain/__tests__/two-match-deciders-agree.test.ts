import { describe, it, expect } from "vitest";
import { deriveNetHoles } from "../match";
import { matchHolesOffTheLow } from "../team";
import { rankStrokeIndex } from "../stroke";

/**
 * TWO DECIDERS OF A NET MATCH HOLE, AND WHERE THEY MUST AGREE (2026-10-17).
 *
 * A singles match kept by strokes is decided by `deriveNetHoles` (shots = the
 * difference between the two handicaps); a side match by `matchHolesOffTheLow`
 * (each player's shots = their handicap less the lowest of all). For one ball
 * a side the two are the same rule — Rule 6.1, Appendix C: in match play the
 * higher handicap receives the difference, on the holes the stroke index
 * names — so they must decide every hole alike. Cup stroke scoring (the
 * review panel's slice S1) folds the first into the second; this is the sweep
 * that has to be green before it may, and stays to pin that they did.
 *
 * The axis: every whole handicap from plus 5 to 54 against every other, on
 * an 18-hole index, a nine ranked 1 to 9, and a nine carrying the odd numbers
 * of an 18-hole card — each with cards from a seeded generator, so a run is
 * repeatable and a failure names its case.
 */

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function shuffled(n: number, values: number[], next: () => number): number[] {
  const out = [...values];
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const INDEXES: Array<{ name: string; holes: number; si: number[] }> = (() => {
  const next = rng(7);
  return [
    { name: "18 holes", holes: 18, si: shuffled(18, Array.from({ length: 18 }, (_, i) => i + 1), next) },
    { name: "a nine ranked 1 to 9", holes: 9, si: shuffled(9, Array.from({ length: 9 }, (_, i) => i + 1), next) },
    { name: "a nine of an 18-hole card", holes: 9, si: shuffled(9, Array.from({ length: 9 }, (_, i) => 2 * i + 1), next) },
  ];
})();

const HANDICAPS = Array.from({ length: 60 }, (_, i) => i - 5); // +5 (written -5) to 54

describe("one ball a side: the two deciders give every hole the same way", () => {
  for (const { name, holes, si } of INDEXES) {
    it(`on ${name}, every pair of handicaps from plus 5 to 54`, () => {
      const next = rng(holes * 101);
      let compared = 0;
      for (const hA of HANDICAPS) {
        for (const hB of HANDICAPS) {
          // A card a golfer might write: 2 to 9 on a hole, with some holes blank.
          const card = () => Array.from({ length: holes }, () => (next() < 0.08 ? null : 2 + Math.floor(next() * 8)));
          const a = card();
          const b = card();
          const one = deriveNetHoles(a, b, hA, hB, si, holes);
          const other = matchHolesOffTheLow([{ strokes: a, playingHandicap: hA }], [{ strokes: b, playingHandicap: hB }], si, holes, 1);
          if (JSON.stringify(one) !== JSON.stringify(other)) {
            throw new Error(`${name}: ${hA} v ${hB} disagree\n  cards ${JSON.stringify(a)} / ${JSON.stringify(b)}\n  singles ${JSON.stringify(one)}\n  sides   ${JSON.stringify(other)}`);
          }
          compared += 1;
        }
      }
      // CONTROL: the sweep walked the whole square.
      expect(compared).toBe(HANDICAPS.length * HANDICAPS.length);
    });
  }

  it("and both decide as the Rules do, worked by a route the code does not take (a nine ranked 1 to 9 first, as every caller does)", () => {
    /**
     * Rule 6.1 and Appendix C, worked here by RANKING the holes rather than
     * through `holeStrokesReceived`: each player receives (their handicap less
     * the lowest in the match) strokes, one on each hole in order of the stroke
     * index, going round again past the last; the better net ball of each side
     * takes the hole. Four-balls (two a side) and singles, every index above.
     */
    const byRules = (sides: number[][][], hcps: number[][], si: number[], holes: number): (string | null)[] => {
      const low = Math.min(...hcps.flat());
      const order = si.map((s, h) => ({ s, h })).sort((x, y) => x.s - y.s).map((x) => x.h);
      const shots = (d: number) => {
        const out = new Array(holes).fill(Math.floor(d / holes));
        for (let k = 0; k < d % holes; k += 1) out[order[k]] += 1;
        return out;
      };
      return Array.from({ length: holes }, (_, h) => {
        const best = sides.map((side, s) => {
          const nets = side.map((card, p) => (card[h] == null ? null : card[h]! - shots(hcps[s][p] - low)[h])).filter((n): n is number => n !== null);
          return nets.length ? Math.min(...nets) : null;
        });
        if (best[0] == null || best[1] == null) return null;
        return best[0] < best[1] ? "A" : best[1] < best[0] ? "B" : "H";
      });
    };
    let compared = 0;
    for (const { name, holes, si } of INDEXES) {
      const next = rng(holes * 37 + si[0]);
      for (let t = 0; t < 400; t += 1) {
        const perSide = t % 2 === 0 ? 1 : 2;
        const hcps = [0, 1].map(() => Array.from({ length: perSide }, () => HANDICAPS[Math.floor(next() * HANDICAPS.length)]));
        const cards = hcps.map((side) => side.map(() => Array.from({ length: holes }, () => (next() < 0.05 ? null : 2 + Math.floor(next() * 8)))));
        const balls = cards.map((side, s) => side.map((strokes, p) => ({ strokes, playingHandicap: hcps[s][p] })));
        const got = matchHolesOffTheLow(balls[0], balls[1], rankStrokeIndex(si), holes, 1);
        const want = byRules(cards as number[][][], hcps, si, holes);
        expect(got, `${name}: ${JSON.stringify(hcps)}`).toEqual(want);
        if (perSide === 1) expect(deriveNetHoles(cards[0][0], cards[1][0], hcps[0][0], hcps[1][0], rankStrokeIndex(si), holes), `${name} singles`).toEqual(want);
        compared += 1;
      }
    }
    expect(compared).toBe(1200);
  });

  it("CONTROL: the sweep can see a disagreement — giving the shots to the LOWER handicap is caught", () => {
    const si = INDEXES[0].si;
    const a = Array(18).fill(5);
    const b = Array(18).fill(5);
    // 10 v 4: six shots to A. Swapping the handicaps for one decider gives them to B.
    const right = deriveNetHoles(a, b, 10, 4, si, 18);
    const wrong = matchHolesOffTheLow([{ strokes: a, playingHandicap: 4 }], [{ strokes: b, playingHandicap: 10 }], si, 18, 1);
    expect(JSON.stringify(right)).not.toBe(JSON.stringify(wrong));
    expect(right.filter((h) => h === "A")).toHaveLength(6);
  });
});
