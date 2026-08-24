import { describe, it, expect } from "vitest";
import { courseHandicapMap, indexForHoles } from "../domain/handicap";
import { holeStrokesReceived } from "../domain/stroke";
import { matchStrokesGiven } from "../domain/match";

/**
 * WHS Rule 6.1b: the index is expressed for the holes being played.
 *
 * Found by audit, proved by a failing version of the first test below: the
 * rating was converted to nine holes and the index was not, so an ordinary
 * 18-hole index received double its strokes in every nine-hole net round.
 * A 20-handicapper getting twenty shots over nine holes wins the monthly
 * medal every month — this is the kind of wrong that empties a competition.
 */

const NEUTRAL = new Map([["t", { courseRating: 72, slopeRating: 113, par: 72 }]]);

describe("the index is converted to the holes being played", () => {
  it("halves an 18-hole index for a nine-hole round", () => {
    const m = courseHandicapMap([{ id: "p", handicap: 20 }], NEUTRAL, "t", 9, "own");
    expect(m.get("p")).toBe(10);
  });

  it("keeps a stored 9-hole index as-is for a nine-hole round", () => {
    const m = courseHandicapMap([{ id: "p", handicap: 7, handicapType: "9" }], NEUTRAL, "t", 9, "own");
    expect(m.get("p")).toBe(7);
  });

  it("doubles a stored 9-hole index for an eighteen-hole round", () => {
    const m = courseHandicapMap([{ id: "p", handicap: 7, handicapType: "9" }], NEUTRAL, "t", 18, "own");
    expect(m.get("p")).toBe(14);
  });

  it("leaves the ordinary case — 18-hole index, 18-hole round — alone", () => {
    const m = courseHandicapMap([{ id: "p", handicap: 14 }], NEUTRAL, "t", 18, "own");
    expect(m.get("p")).toBe(14);
  });

  it("keeps the half-stroke until the final rounding", () => {
    // A 13 index over nine holes is 6.5 — rounding the index first would give
    // 7 on every course; carrying it through gives the slope its say.
    expect(indexForHoles(13, undefined, 9)).toBe(6.5);
  });

  it("applies slope to the halved index, not the full one", () => {
    // 20 ÷ 2 = 10, × (140/113) ≈ 12.4, + (35 − 36) ≈ 11.4 → 11. With the
    // unhalved index this lands near 24 — the doubled figure the bug produced,
    // with the slope compounding it.
    const hard = new Map([["t", { courseRating: 70, slopeRating: 140, par: 72 }]]);
    const m = courseHandicapMap([{ id: "p", handicap: 20 }], hard, "t", 9, "own");
    expect(m.get("p")).toBeGreaterThanOrEqual(11);
    expect(m.get("p")).toBeLessThanOrEqual(12);
  });

  it("treats an unrated nine-hole round the same way", () => {
    // No tees at all: the index is still halved, because the halving is about
    // the player's side, not the course's.
    const m = courseHandicapMap([{ id: "p", handicap: 18 }], new Map(), null, 9, "own");
    expect(m.get("p")).toBe(9);
  });
});

describe("stroke allocation wraps on the holes being played", () => {
  it("gives a 10 course handicap 10 strokes over nine holes, not 9", () => {
    // SI 1 takes the second stroke. Hardcoded to 18, the tenth stroke was
    // silently lost — exactly the players the allowance exists for.
    const NINE_SI = [7, 3, 9, 1, 5, 4, 8, 2, 6];
    const perHole = NINE_SI.map((si) => holeStrokesReceived(10, si, 9));
    expect(perHole.reduce((s, n) => s + n, 0)).toBe(10);
    expect(perHole[3]).toBe(2); // the hole with SI 1
  });

  it("gives an 18 course handicap two strokes on every nine-hole hole", () => {
    const NINE_SI = [7, 3, 9, 1, 5, 4, 8, 2, 6];
    const perHole = NINE_SI.map((si) => holeStrokesReceived(18, si, 9));
    expect(perHole).toEqual([2, 2, 2, 2, 2, 2, 2, 2, 2]);
  });

  it("keeps eighteen-hole allocation exactly as before", () => {
    expect(holeStrokesReceived(22, 1)).toBe(2);
    expect(holeStrokesReceived(22, 4)).toBe(2);
    expect(holeStrokesReceived(22, 5)).toBe(1);
    expect(holeStrokesReceived(22, 18)).toBe(1);
  });

  it("hands a nine-hole net match the full difference", () => {
    // 6 shots difference across SI 1-9: one each on the six hardest holes.
    const NINE_SI = [7, 3, 9, 1, 5, 4, 8, 2, 6];
    const { toA } = matchStrokesGiven(16, 10, NINE_SI);
    expect(toA.reduce((s, n) => s + n, 0)).toBe(6);
  });

  it("wraps a nine-hole match difference past nine", () => {
    // 12 shots over nine holes: one everywhere, a second on SI 1-3.
    const NINE_SI = [7, 3, 9, 1, 5, 4, 8, 2, 6];
    const { toA } = matchStrokesGiven(12, 0, NINE_SI);
    expect(toA.reduce((s, n) => s + n, 0)).toBe(12);
    expect(toA[3]).toBe(2); // SI 1
    expect(toA[1]).toBe(2); // SI 3
  });
});
