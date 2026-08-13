import { describe, it, expect } from "vitest";
import { aggregateStats } from "@/lib/domain/standings";
import { DEFAULT_SCORING } from "@/lib/domain/types";
import type { Match, Player, ScoringRules } from "@/lib/domain/types";

/**
 * Forfeits, and points for turning up.
 *
 * Two things a club league needs that the app could not express. A conceded
 * match had to be entered as a fabricated scoreline or left Live forever; and
 * "points for playing" existed only as `bonusPts`, a single flat award per
 * player however many matches they played — so in a league where availability
 * varies week to week, turning up paid nothing.
 */

const player = (id: string, seed: number): Player => ({ id, name: id.toUpperCase(), handicap: 0, seed });
const FIELD = [player("a", 1), player("b", 2), player("c", 3)];

const match = (id: string, aId: string, bId: string, over: Partial<Match> = {}): Match => ({
  id,
  stageId: "s1",
  groupId: "g1",
  round: 1,
  playerAId: aId,
  playerBId: bId,
  // A drawn but unplayed match: eighteen holes, none decided. NOT `[]`, which
  // resolveMatch reads as nought holes remaining and therefore a completed
  // halved match.
  holes: new Array(18).fill(null) as Match["holes"],
  ...over,
});

const scoring = (over: Partial<ScoringRules> = {}): ScoringRules => ({
  ...DEFAULT_SCORING,
  holeRatioPts: 0,
  ...over,
});

// A won by 3&2: three holes, the rest halved, closed out at the 16th.
const WON_3_AND_2 = [
  "H", "H", "H", "H", "H", "H", "H", "H", "H", "H", "H", "H", "H", "A", "A", "A",
] as Match["holes"];

describe("a forfeited match", () => {
  const rules = scoring({ winPts: 3, tiePts: 1, lossPts: 0.5 });

  it("gives the winner the configured win points", () => {
    const stats = aggregateStats(FIELD, [match("m1", "a", "b", { forfeitedBy: "a" })], rules);
    expect(stats.get("b")!.points).toBe(3);
    expect(stats.get("b")!.wins).toBe(1);
  });

  it("gives the player who forfeited the configured LOSS points, not zero", () => {
    // Explicitly not zero: a league that pays half a point for a loss pays it
    // here too. The forfeit decides the match, it does not change the tariff.
    const stats = aggregateStats(FIELD, [match("m1", "a", "b", { forfeitedBy: "a" })], rules);
    expect(stats.get("a")!.points).toBe(0.5);
    expect(stats.get("a")!.losses).toBe(1);
  });

  it("works whichever side forfeits", () => {
    const stats = aggregateStats(FIELD, [match("m1", "a", "b", { forfeitedBy: "b" })], rules);
    expect(stats.get("a")!.points).toBe(3);
    expect(stats.get("b")!.points).toBe(0.5);
  });

  it("counts no holes for either side", () => {
    // Holes entered before a player walked in are discarded. Crediting a
    // conceder the holes he was up would flatter him in the hole differential
    // his flight is ranked on.
    const played = match("m1", "a", "b", { holes: WON_3_AND_2, forfeitedBy: "b" });
    const stats = aggregateStats(FIELD, [played], scoring({ holeRatioPts: 0.5, lossPts: 0 }));
    expect(stats.get("a")!.holesWon).toBe(0);
    expect(stats.get("b")!.holesWon).toBe(0);
    // 3 for the win and nothing for the holes.
    expect(stats.get("a")!.points).toBe(3);
  });

  it("counts as played for both, so the record is honest", () => {
    const stats = aggregateStats(FIELD, [match("m1", "a", "b", { forfeitedBy: "a" })], rules);
    expect(stats.get("a")!.played).toBe(1);
    expect(stats.get("b")!.played).toBe(1);
  });

  it("ignores a forfeitedBy that names neither player", () => {
    // A stale or mistyped id must not silently decide a match.
    const stats = aggregateStats(FIELD, [match("m1", "a", "b", { forfeitedBy: "c" })], rules);
    expect(stats.get("a")!.played).toBe(0);
    expect(stats.get("b")!.played).toBe(0);
  });
});

describe("points for playing a match", () => {
  it("pays once per match contested, unlike the flat bonus", () => {
    // The distinction that matters in a league: a regular who plays three and
    // a stand-in who plays one collected the same bonus before this existed.
    const rules = scoring({ winPts: 0, tiePts: 0, lossPts: 0, playPts: 1 });
    const matches = [
      match("m1", "a", "b", { holes: WON_3_AND_2 }),
      match("m2", "a", "c", { holes: WON_3_AND_2 }),
    ];
    const stats = aggregateStats(FIELD, matches, rules);
    expect(stats.get("a")!.points).toBe(2); // played both
    expect(stats.get("b")!.points).toBe(1);
    expect(stats.get("c")!.points).toBe(1);
  });

  it("is not paid to a player who forfeited", () => {
    // They did not play it. The win points still go to the opponent.
    const rules = scoring({ winPts: 3, lossPts: 0.5, playPts: 1 });
    const stats = aggregateStats(FIELD, [match("m1", "a", "b", { forfeitedBy: "a" })], rules);
    expect(stats.get("a")!.points).toBe(0.5);
    expect(stats.get("b")!.points).toBe(4); // 3 for the win + 1 for turning up
  });

  it("pays nothing for a match still in progress", () => {
    const rules = scoring({ winPts: 3, tiePts: 1, playPts: 1 });
    // One up after one hole of eighteen: nothing is decided.
    const holes = new Array(18).fill(null) as Match["holes"];
    holes[0] = "A";
    const live = match("m1", "a", "b", { holes });
    expect(aggregateStats(FIELD, [live], rules).get("a")!.points).toBe(0);
  });

  it("sits outside the per-match cap, like the flat bonus", () => {
    // Both are awarded for taking part rather than earned from any one match,
    // so a cap on what a match can pay must not swallow them.
    const rules = scoring({ winPts: 3, holeRatioPts: 0.5, maxPerMatch: 2, playPts: 1 });
    const stats = aggregateStats(FIELD, [match("m1", "a", "b", { holes: WON_3_AND_2 })], rules);
    // The match itself is capped at 2, then the appearance point is added.
    expect(stats.get("a")!.points).toBe(3);
  });

  it("changes nothing when it is left at zero", () => {
    const stats = aggregateStats(FIELD, [match("m1", "a", "b", { holes: WON_3_AND_2 })], scoring({ winPts: 3 }));
    expect(stats.get("a")!.points).toBe(3);
    expect(stats.get("b")!.points).toBe(0);
  });
});
