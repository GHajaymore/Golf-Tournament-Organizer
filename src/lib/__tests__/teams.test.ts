import { describe, it, expect } from "vitest";
import { snakeDraw, teamProblems, sidePlayingHandicap, effectiveAllowance, effectiveCountBest } from "../services/teams";
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

  it("splits greensomes 60/40, lower handicap first", () => {
    // 60% of 10 + 40% of 20 = 6 + 8 = 14.
    expect(sidePlayingHandicap([10, 20], "Greensomes")).toBe(14);
  });

  it("gives a greensomes pair fewer shots than the same pair at foursomes", () => {
    // The point of the split: picking the better of two drives is an
    // advantage, so the side plays off less than an alternate-shot pair.
    // Falling through to the flat allowance would hand them the combined
    // handicap instead — the failure this guards.
    expect(sidePlayingHandicap([10, 20], "Greensomes")).toBeLessThan(
      sidePlayingHandicap([10, 20], "Four-Ball"),
    );
    expect(sidePlayingHandicap([10, 20], "Greensomes")).toBeLessThan(30);
  });

  it("lets a committee override greensomes, replacing the split entirely", () => {
    // Consistent with the scramble rule: an override means that percentage of
    // the combined handicaps, not a percentage layered on the 60/40 table.
    expect(sidePlayingHandicap([10, 20], "Greensomes", 50)).toBe(15);
  });

  it("returns zero for a side with nobody in it", () => {
    expect(sidePlayingHandicap([], "Scramble")).toBe(0);
  });
});

describe("committee allowance override", () => {
  it("replaces the format's recommendation", () => {
    // Foursomes recommends 50% of the combined handicaps; a committee that
    // sets 60 means 60.
    expect(sidePlayingHandicap([10, 20], "Foursomes")).toBe(15);
    expect(sidePlayingHandicap([10, 20], "Foursomes", 60)).toBe(18);
  });

  it("replaces the scramble table outright rather than stacking on it", () => {
    // A committee saying "40%" means 40% of the combined handicaps, not 40%
    // layered on a descending table they never mentioned.
    const table = sidePlayingHandicap([4, 8, 16, 24], "Scramble");
    const flat = sidePlayingHandicap([4, 8, 16, 24], "Scramble", 40);
    expect(flat).not.toBe(table);
    expect(flat).toBe(Math.round((4 + 8 + 16 + 24) * 0.4));
  });

  it("treats zero as no opinion, not as a zero allowance", () => {
    // Every existing round stores 0 and means "use the recommendation", so
    // reading 0 as 0% would silently strip every side's shots.
    expect(sidePlayingHandicap([10, 20], "Foursomes", 0)).toBe(
      sidePlayingHandicap([10, 20], "Foursomes"),
    );
    expect(effectiveAllowance("Foursomes", 0)).toBe(50);
    expect(effectiveAllowance("Foursomes", 60)).toBe(60);
  });

  it("reports the scramble convention when nothing is set", () => {
    expect(effectiveAllowance("Scramble", 0)).toBe(25);
  });
});

describe("a committee's own allowance split", () => {
  it("uses the split the committee typed, in place of the format's", () => {
    // 50/50 on 10 and 20 = 5 + 10 = 15, where greensomes' own 60/40 gives 14.
    expect(sidePlayingHandicap([10, 20], "Greensomes", 0, [50, 50])).toBe(15);
  });

  it("applies shares best player first, however the handicaps arrive", () => {
    // The larger share belongs to the lower handicap whichever order the pair
    // is listed in — otherwise the same two people get different strokes
    // depending on who happened to be entered first.
    expect(sidePlayingHandicap([20, 10], "Greensomes", 0, [60, 40])).toBe(
      sidePlayingHandicap([10, 20], "Greensomes", 0, [60, 40]),
    );
  });

  it("beats a flat override, being the more specific instruction", () => {
    expect(sidePlayingHandicap([10, 20], "Greensomes", 50, [60, 40])).toBe(14);
  });

  it("ignores a split that doesn't cover the side, rather than dropping a player", () => {
    // sideHandicap gives an unlisted position a weight of zero, so a short
    // list would quietly leave someone's handicap out of the calculation.
    // Falling back to the format's own split is the safe reading.
    expect(sidePlayingHandicap([10, 20], "Greensomes", 0, [60])).toBe(14);
  });

  it("ignores nonsense shares rather than scoring the round with them", () => {
    expect(sidePlayingHandicap([10, 20], "Greensomes", 0, [-10, 40])).toBe(14);
    expect(sidePlayingHandicap([10, 20], "Greensomes", 0, [140, 40])).toBe(14);
    expect(sidePlayingHandicap([10, 20], "Greensomes", 0, [0, 0])).toBe(14);
    expect(sidePlayingHandicap([10, 20], "Greensomes", 0, [])).toBe(14);
  });

  it("does not require the shares to add up to 100", () => {
    // Greensomes' 60/40 does; a scramble's 25/20/15/10 sums to 70. Both real.
    expect(sidePlayingHandicap([10, 20], "Greensomes", 0, [30, 20])).toBe(7);
  });
});

describe("how many scores count", () => {
  it("counts one when nothing is set — how four-ball is normally played", () => {
    // A stored zero means "no opinion". Reading it as zero would score every
    // hole blank, which is the failure worth guarding.
    expect(effectiveCountBest("Four-Ball", 0)).toBe(1);
  });

  it("takes the committee's count when they have set one", () => {
    expect(effectiveCountBest("Best Ball", 2)).toBe(2);
  });

  it("never counts more scores than a side can hold", () => {
    // "Best 6 of 4" is not a format; it is a confusing way of writing
    // "everyone counts".
    expect(effectiveCountBest("Four-Ball", 6)).toBe(2);
    expect(effectiveCountBest("Best Ball", 9)).toBe(4);
  });

  it("treats a negative as no opinion rather than inverting anything", () => {
    expect(effectiveCountBest("Four-Ball", -3)).toBe(1);
  });
});
