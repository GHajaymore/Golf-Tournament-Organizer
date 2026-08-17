import { describe, it, expect } from "vitest";
import {
  toughestN,
  isTiebreakerKey,
  tiebreakerLabel,
  tiebreakerHelp,
  MAX_TOUGHEST_N,
  DEFAULT_SCORING,
} from "@/lib/domain/types";
import { computeStandings } from "@/lib/domain/standings";
import type { Player, Match, ScoringRules } from "@/lib/domain/types";

/**
 * The countback over the N hardest holes, with N the committee's choice.
 *
 * Was two fixed keys, six and three, which is one club's convention rather
 * than a rule. A key now carries its own N, so the parser is what stands
 * between the database and a tiebreaker reading holes that do not exist.
 */

describe("reading N out of a key", () => {
  it("accepts any N a card can have", () => {
    expect(toughestN("toughest-1")).toBe(1);
    expect(toughestN("toughest-9")).toBe(9);
    expect(toughestN(`toughest-${MAX_TOUGHEST_N}`)).toBe(MAX_TOUGHEST_N);
  });

  it("refuses an N no card can have", () => {
    // The important half. A key arrives from the database as free text:
    // toughest-0 would decide nothing while looking like a tiebreaker, and
    // toughest-99 would read holes off the end of the card.
    expect(toughestN("toughest-0")).toBeNull();
    expect(toughestN("toughest-19")).toBeNull();
    expect(toughestN("toughest--3")).toBeNull();
    expect(toughestN("toughest-3.5")).toBeNull();
    expect(toughestN("toughest-")).toBeNull();
    expect(toughestN("toughest-3x")).toBeNull();
  });

  it("is not confused by the fixed tiebreakers", () => {
    expect(toughestN("head-to-head")).toBeNull();
    expect(toughestN("lower-handicap")).toBeNull();
  });

  it("validates a whole key either way", () => {
    expect(isTiebreakerKey("toughest-7")).toBe(true);
    expect(isTiebreakerKey("head-to-head")).toBe(true);
    expect(isTiebreakerKey("toughest-40")).toBe(false);
    expect(isTiebreakerKey("wheelbarrow")).toBe(false);
  });
});

describe("what a countback is called", () => {
  it("names its own N", () => {
    expect(tiebreakerLabel("toughest-9")).toBe("Toughest 9 holes (by stroke index)");
    expect(tiebreakerLabel("toughest-6")).toBe("Toughest 6 holes (by stroke index)");
  });

  it("reads properly for a single hole", () => {
    // "Toughest 1 holes" on a committee's own rules sheet is the kind of
    // detail that makes the rest look careless.
    expect(tiebreakerLabel("toughest-1")).toBe("Toughest 1 hole (by stroke index)");
    expect(tiebreakerHelp("toughest-1")).toMatch(/hardest hole\b/);
  });

  it("still warns that a countback needs a stroke index", () => {
    // The catch that only shows up on the day, and the reason the help text
    // exists at all. It must survive being generated rather than written out.
    expect(tiebreakerHelp("toughest-12")).toMatch(/Needs a stroke index/);
  });

  it("leaves the fixed ones alone", () => {
    expect(tiebreakerLabel("head-to-head")).toBe("Head-to-head result");
    expect(tiebreakerHelp("head-to-head")).toMatch(/never met/);
  });
});

describe("a chain of countbacks", () => {
  // Stroke index 1 is hole 1, 2 is hole 2, and so on.
  const strokeIndex = Array.from({ length: 18 }, (_, i) => i + 1);
  const player = (id: string): Player => ({ id, name: id, handicap: 10, seed: 1 });

  /** A completed match where `winner` takes the listed holes and halves the rest. */
  const played = (id: string, aId: string, bId: string, aHoles: number[]): Match => {
    const holes: Match["holes"] = Array(18).fill("H") as Match["holes"];
    for (const h of aHoles) holes[h] = "A";
    return { id, stageId: "s", groupId: "g", round: 1, playerAId: aId, playerBId: bId, holes } as Match;
  };

  it("falls through a wider cut to a tighter one", () => {
    // X and Y are level, and level again over the hardest 6 — both won three
    // of them. Over the hardest 1, X won it and Y did not. The second
    // countback is what separates them, which is the whole point of being
    // able to write more than one.
    const players = [player("x"), player("y"), player("z")];
    const matches = [
      played("m1", "x", "z", [0, 1, 2]), // holes 1,2,3 — three of the hardest six
      played("m2", "y", "z", [3, 4, 5]), // holes 4,5,6 — also three of the hardest six
    ];
    const scoring: ScoringRules = {
      ...DEFAULT_SCORING,
      tiebreakers: ["toughest-6", "toughest-1"],
    };
    // Level on points: both won by the same margin over the same opponent.
    const carried = { x: 0, y: 0, z: 0 };
    const order = computeStandings(players, matches, scoring, carried, strokeIndex).map((r) => r.player.id);
    expect(order.slice(0, 2)).toEqual(["x", "y"]);
  });

  it("decides nothing without a stroke index, whatever N is", () => {
    const players = [player("x"), player("y"), player("z")];
    const matches = [played("m1", "x", "z", [0, 1, 2]), played("m2", "y", "z", [3, 4, 5])];
    const scoring: ScoringRules = { ...DEFAULT_SCORING, tiebreakers: ["toughest-6"] };
    // No stroke index passed: the countback abstains and the order rests on
    // whatever comes next, not on a countback quietly inventing an answer.
    const withIndex = computeStandings(players, matches, scoring, {}, strokeIndex).map((r) => r.player.id);
    const without = computeStandings(players, matches, scoring, {}).map((r) => r.player.id);
    expect(withIndex.slice(0, 2)).toEqual(["x", "y"]);
    expect(without).toHaveLength(3);
  });

  it("ignores a key whose N is out of range rather than throwing", () => {
    // A tournament saved before the bounds existed, or edited by hand. It must
    // degrade to "this tiebreaker decides nothing", not crash the leaderboard.
    const players = [player("x"), player("y")];
    const scoring = { ...DEFAULT_SCORING, tiebreakers: ["toughest-99"] } as ScoringRules;
    expect(() => computeStandings(players, [], scoring, {}, strokeIndex)).not.toThrow();
  });
});
