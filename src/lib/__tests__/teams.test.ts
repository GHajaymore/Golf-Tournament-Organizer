import { describe, it, expect } from "vitest";
import { snakeDraw, teamProblems, sidePlayingHandicap } from "../services/teams";
import type { TeamView } from "../services/teams";

const player = (id: string, handicap: number) => ({ id, handicap });

const team = (id: string, sizes: number): TeamView => ({
  id,
  name: `Team ${id}`,
  seed: 0,
  stageId: null,
  members: Array.from({ length: sizes }, (_, i) => ({
    playerId: `${id}-${i}`,
    name: `P${i}`,
    handicap: 10,
    position: i,
  })),
  playingHandicap: 0,
});

describe("snakeDraw", () => {
  it("splits the field into sides of the right size", () => {
    const sides = snakeDraw([1, 2, 3, 4, 5, 6, 7, 8].map((n) => player(`p${n}`, n)), 2);
    expect(sides).toHaveLength(4);
    expect(sides.every((s) => s.length === 2)).toBe(true);
  });

  it("pairs the strongest with the weakest", () => {
    // Handicaps 1..4 into two pairs. A straight split would give (1,2) and
    // (3,4) — one side two shots better before a ball is struck.
    const sides = snakeDraw([1, 2, 3, 4].map((n) => player(`p${n}`, n)), 2);
    const totals = sides.map((s) => s.reduce((sum, p) => sum + p.handicap, 0));
    expect(totals[0]).toBe(totals[1]); // 1+4 === 2+3
  });

  it("keeps sides within a shot of each other across a wide field", () => {
    const field = [0, 3, 5, 8, 12, 15, 18, 24].map((h, i) => player(`p${i}`, h));
    const sides = snakeDraw(field, 2);
    const totals = sides.map((s) => s.reduce((sum, p) => sum + p.handicap, 0));
    expect(Math.max(...totals) - Math.min(...totals)).toBeLessThanOrEqual(4);
  });

  it("does not depend on the order the field is passed in", () => {
    const field = [12, 3, 24, 8, 0, 18, 5, 15].map((h, i) => player(`p${i}`, h));
    const a = snakeDraw(field, 2).map((s) => s.map((p) => p.id).sort().join(","));
    const b = snakeDraw([...field].reverse(), 2).map((s) => s.map((p) => p.id).sort().join(","));
    expect(a.sort()).toEqual(b.sort());
  });

  it("leaves a short final side rather than dropping anyone", () => {
    // Seven players into fours is not a clean split, and silently discarding
    // the seventh would lose a paying entrant.
    const sides = snakeDraw([1, 2, 3, 4, 5, 6, 7].map((n) => player(`p${n}`, n)), 4);
    const total = sides.reduce((sum, s) => sum + s.length, 0);
    expect(total).toBe(7);
  });

  it("returns nothing for an empty field", () => {
    expect(snakeDraw([], 4)).toEqual([]);
  });
});

describe("teamProblems", () => {
  it("flags a side short of players", () => {
    const problems = teamProblems([team("a", 1)], "Four-Ball");
    expect(problems).toHaveLength(1);
    expect(problems[0].problem).toBe("has 1 of 2 players");
  });

  it("flags an empty side in plain words", () => {
    expect(teamProblems([team("a", 0)], "Foursomes")[0].problem).toBe("has no players");
  });

  it("flags an oversized side", () => {
    expect(teamProblems([team("a", 3)], "Four-Ball")[0].problem).toBe("has 3 players, more than 2");
  });

  it("accepts a size inside the format's range", () => {
    // Best Ball allows 2 to 4, so all three are legal.
    expect(teamProblems([team("a", 2), team("b", 3), team("c", 4)], "Best Ball")).toEqual([]);
  });

  it("says nothing about a correctly sized scramble four", () => {
    expect(teamProblems([team("a", 4)], "Scramble")).toEqual([]);
  });
});

describe("sidePlayingHandicap", () => {
  it("halves the combined handicaps for foursomes", () => {
    expect(sidePlayingHandicap([10, 20], "Foursomes")).toBe(15);
  });

  it("uses the descending table for a scramble", () => {
    // 25/20/15/10 best player first: 4, 8, 16, 24 -> 1 + 1.6 + 2.4 + 2.4 = 7.4
    expect(sidePlayingHandicap([24, 4, 16, 8], "Scramble")).toBe(7);
  });

  it("uses the two-player table for a two-person scramble", () => {
    // 35/15 on 10 and 20: 3.5 + 3 = 6.5 -> 7
    expect(sidePlayingHandicap([20, 10], "Texas Scramble")).toBe(7);
  });

  it("gives a four-ball pair the 90% allowance on the combined total", () => {
    expect(sidePlayingHandicap([10, 20], "Four-Ball")).toBe(27);
  });

  it("returns zero for a side with nobody in it", () => {
    expect(sidePlayingHandicap([], "Scramble")).toBe(0);
  });
});
