import { describe, expect, it } from "vitest";
import { defaultFormationRule, divisionCountFor, flightCountFor, formGroups } from "../grouping";
import type { Player } from "../types";

/**
 * HANDICAP DIVISIONS — how a club divides a medal or Stableford field for
 * prizes: Division A the lowest handicaps, then the next band, and so on
 * (2026-09-28). Distinct from "Spread by handicap", which snake-drafts so every
 * flight holds the SAME spread — right for round-robin groups, the opposite of
 * a division.
 */
const field = (handicaps: number[]): Player[] =>
  handicaps.map((handicap, i) => ({ id: `p${i}`, name: `P${i}`, handicap, seed: i + 1 }) as unknown as Player);

describe("handicap divisions", () => {
  it("puts the lowest handicaps in Flight A and bands upward, in even sizes", () => {
    // Deliberately out of order, so a rule that kept roster order would fail.
    const hcps = [18, 2, 25, 9, 14, 31, 5, 22, 11, 28, 7, 16, 3, 20, 12, 26];
    const groups = formGroups(field(hcps), "divisions", { mode: "count", value: 2 });
    const bands = groups.map((g) => g.playerIds.map((id) => hcps[Number(id.slice(1))]));
    expect(groups.map((g) => g.name)).toEqual(["A", "B"]);
    expect(bands[0]).toEqual([2, 3, 5, 7, 9, 11, 12, 14]);
    expect(bands[1]).toEqual([16, 18, 20, 22, 25, 26, 28, 31]);
    // Every A handicap is at or below every B handicap — the definition of a band.
    expect(Math.max(...bands[0])).toBeLessThanOrEqual(Math.min(...bands[1]));
  });

  it("CONTROL: 'Spread by handicap' does NOT band — each flight holds the full spread", () => {
    const hcps = [18, 2, 25, 9, 14, 31, 5, 22, 11, 28, 7, 16, 3, 20, 12, 26];
    const groups = formGroups(field(hcps), "handicap", { mode: "count", value: 2 });
    const a = groups[0].playerIds.map((id) => hcps[Number(id.slice(1))]);
    expect(Math.max(...a)).toBeGreaterThan(20);
  });

  it("makes one, two or three divisions on auto, never flights of four", () => {
    expect(divisionCountFor(12)).toBe(1);
    expect(divisionCountFor(20)).toBe(2);
    expect(divisionCountFor(40)).toBe(3);
    expect(flightCountFor(40, { mode: "auto" }, "divisions")).toBe(3);
    // CONTROL: the same field under a playing-group rule is flights of ~4.
    expect(flightCountFor(40, { mode: "auto" }, "balanced")).toBe(10);
    // And an organizer's explicit count still wins.
    expect(flightCountFor(40, { mode: "count", value: 4 }, "divisions")).toBe(4);
  });

  it("breaks level handicaps by seed, so a redraw lands the same", () => {
    const players = field([10, 10, 10, 10]);
    const once = formGroups(players, "divisions", { mode: "count", value: 2 });
    const again = formGroups([...players].reverse(), "divisions", { mode: "count", value: 2 });
    expect(again.map((g) => g.playerIds)).toEqual(once.map((g) => g.playerIds));
  });
});

describe("the rule a new tournament defaults to", () => {
  const medal = { headToHead: false, engine: "stroke" };
  it("is divisions for individual stroke and Stableford rounds", () => {
    expect(defaultFormationRule([medal])).toBe("divisions");
    expect(defaultFormationRule([{ headToHead: false, engine: "stableford" }, medal])).toBe("divisions");
    expect(defaultFormationRule([{ headToHead: false, engine: "modified-stableford" }])).toBe("divisions");
  });

  it("stays balanced wherever a flight is who you play, or a side", () => {
    expect(defaultFormationRule([])).toBe("balanced");
    expect(defaultFormationRule([{ headToHead: true, engine: "match" }])).toBe("balanced");
    // One match-play round anywhere makes flights opponents.
    expect(defaultFormationRule([medal, { headToHead: true, engine: "stroke" }])).toBe("balanced");
    expect(defaultFormationRule([{ headToHead: false, engine: "team-aggregate" }])).toBe("balanced");
  });
});
