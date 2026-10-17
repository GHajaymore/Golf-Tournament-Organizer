import { describe, it, expect } from "vitest";
import { deriveNetHoles } from "../match";
import { matchHolesOffTheLow } from "../team";

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
