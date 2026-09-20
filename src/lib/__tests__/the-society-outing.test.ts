import { describe, it, expect } from "vitest";
import { boardKind, needsTeams, isStrokeScored, findFormat } from "@/lib/formats";
import { roundIsStroke, generatesPairings, isPlayingRound, isHeadToHead } from "@/lib/stage-types";
import { holesPlayed } from "@/lib/domain/handicap";
import { aggregateStroke, isRanked, type StrokeCard } from "@/lib/domain/stroke-agg";
import { resolveMatch } from "@/lib/domain/match";
import type { HoleResult } from "@/lib/domain/types";
import { formGroups, flightCountFor } from "@/lib/domain/grouping";

/**
 * THE SOCIETY OUTING: FORTY PLAYERS, THREE DIFFERENT GAMES IN ONE DAY.
 *
 * Ajay's scenario, 2026-09-19, and it is a combination rather than a feature:
 *
 *   front nine   two-team stroke play, sides matched on ability
 *   back nine    match play between two PAIRS
 *   next round   individuals
 *
 * Every one of those rounds works on its own and is tested on its own. What
 * nothing tested is the three of them inside ONE tournament, which is exactly
 * the class CLAUDE.md's combination sweep exists for: "almost none were in a
 * function that was individually wrong — they were in COMBINATIONS nobody had
 * a test for".
 *
 * THE HAZARD THIS IS AIMED AT is recorded in the deferred register: `isStroke`
 * is read off the EVENT's format while the boards are fixed per round. On a
 * day like this the event has no single answer — the same tournament is team
 * stroke play, then pairs match play, then individual stroke play — so a
 * screen that asks the event is wrong on at least two of its three rounds.
 * These assertions ask each ROUND, which is the shape the fix has to take.
 */

const FIELD = 40;

/** The three rounds of the day, as an organizer would set them up. */
const ROUNDS = [
  {
    name: "Front nine — two teams, stroke play",
    type: "Stroke Play Round",
    format: "Best Ball",
    holes: 9,
  },
  {
    name: "Back nine — pairs match play",
    type: "Single Match Stage",
    format: "Four-Ball",
    holes: 9,
  },
  {
    name: "Round 2 — individuals",
    type: "Stroke Play Round",
    format: "Stroke Play",
    holes: 18,
  },
] as const;

describe("forty players, three games, one tournament", () => {
  it("asks each ROUND what it is, never the tournament", () => {
    /**
     * The whole point. One tournament, three answers — a screen holding a
     * single `isStroke` for the event is wrong on two of these three rounds
     * whichever way it resolves.
     */
    const answers = ROUNDS.map((r) => roundIsStroke(r.type, r.format));
    expect(answers).toEqual([true, false, true]);
    // And the boards differ too: a team round does not rank players.
    expect(ROUNDS.map((r) => boardKind(r.format))).toEqual(["team", "team", "standard"]);
  });

  it("knows which rounds are played by sides and which by people", () => {
    expect(ROUNDS.map((r) => needsTeams(r.format))).toEqual([true, true, false]);
    // Four-Ball is a pair, which is what "between two pairs" means.
    expect(findFormat("Four-Ball").sideSize).toBe(2);
    expect(findFormat("Stroke Play").sideSize).toBe(1);
    /**
     * HEAD-TO-HEAD, BUT NOT DRAWN BY THE APP. The back nine is a match, and
     * `isHeadToHead` says so — but `generatesPairings` is false for all three,
     * because a Single Match Stage is one match the organizer sets rather than
     * a draw the app makes. Asserted because the two read alike and mean
     * different things: a screen using the second to decide whether a round is
     * match play would score this nine as a medal.
     */
    expect(ROUNDS.map((r) => isHeadToHead(r.type))).toEqual([false, true, false]);
    expect(ROUNDS.map((r) => generatesPairings(r.type))).toEqual([false, false, false]);
    expect(ROUNDS.every((r) => isPlayingRound(r.type))).toBe(true);
  });

  it("scores each round over the holes it was actually played over", () => {
    // Two nines and an eighteen in one tournament: a round that borrowed the
    // event's hole count would score the front nine over eighteen holes.
    expect(ROUNDS.map((r) => holesPlayed(r.holes))).toEqual([9, 9, 18]);
  });

  it("splits forty into sides that can actually play each other", () => {
    // Two teams of twenty for the front nine. Nobody is left in a side of one,
    // which is the off-by-one this suite's grouping sweep was written for.
    const players = Array.from({ length: FIELD }, (_, i) => ({
      id: `p${i}`,
      name: `p${i}`,
      handicap: i % 20,
      seed: i + 1,
    }));
    // Two sides, which is what "two teams" means for the front nine.
    const groups = formGroups(players, "balanced", { mode: "count", value: 2 });
    expect(groups.length).toBe(2);
    for (const g of groups) expect(g.playerIds.length).toBeGreaterThan(1);
    // Everybody is in exactly one side — nobody sits out and nobody plays twice.
    const placed = groups.flatMap((g) => g.playerIds);
    expect(new Set(placed).size).toBe(FIELD);
    expect(flightCountFor(FIELD, { mode: "count", value: 2 })).toBe(2);
  });

  it("scores the individual round over its own eighteen holes, with no NaN", () => {
    const PARS = [4, 5, 3, 4, 4, 4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 3, 4, 4];
    const SI = [7, 3, 11, 1, 15, 5, 17, 9, 13, 8, 4, 12, 2, 16, 6, 18, 10, 14];
    const cards: StrokeCard[] = Array.from({ length: FIELD }, (_, i) => ({
      playerId: `p${i}`,
      stageId: "s2",
      strokes: PARS.map((p) => p + (i % 3) - 1),
    }));
    const agg = aggregateStroke(cards, {
      courseFor: () => ({ pars: PARS, holeDifficulty: SI }),
      handicapFor: () => 0,
      holeStrokesReceived: () => 0,
      stablefordPointsForHole: () => 0,
      allocationHoles: (h) => h,
    });
    expect(agg.size).toBe(FIELD);
    for (const [playerId, row] of agg) {
      expect(Number.isFinite(row.gross), `gross for ${playerId}`).toBe(true);
      expect(row.thru, playerId).toBe(18);
      // The front nine was a different round on a different card; this one is
      // eighteen holes and owes eighteen.
      expect(row.holesOwed, playerId).toBe(18);
      expect(isRanked(row), playerId).toBe(true);
    }
  });

  it("settles the pairs match over nine holes, not eighteen", () => {
    /**
     * A nine-hole match is over when one side is up by more holes than remain
     * — the Rules of Golf do not care that the card has eighteen boxes. A
     * match that borrowed the tournament's hole count would report this one
     * as still in progress.
     */
    // A wins the first five of nine: five up with four to play is 5&4, and the
    // match is over before the card runs out.
    const holes: HoleResult[] = ["A", "A", "A", "A", "A", null, null, null, null];
    const result = resolveMatch(holes);
    expect(result.complete).toBe(true);
    expect(result.winner).toBe("A");
    expect(result.remaining).toBe(4);
  });

  it("does not rank the two team rounds as if they were individual ones", () => {
    /**
     * The failure this guards is the one `services/me.ts` shipped: a player
     * handed a rank and a to-par for a round the leaderboard refuses to score,
     * so the screen the player looks at contradicts the organizer's.
     */
    for (const r of ROUNDS.filter((x) => needsTeams(x.format))) {
      expect(boardKind(r.format), r.name).not.toBe("standard");
      expect(isStrokeScored(r.format) && !needsTeams(r.format), r.name).toBe(false);
    }
  });

  it("counts the day as three rounds, the match round among them", () => {
    // Three PLAYING rounds, which is what a member should be told they played.
    // A structural stage (a bracket's scaffolding) would not count; all three
    // of these are rounds somebody walked.
    expect(ROUNDS.filter((r) => isPlayingRound(r.type)).length).toBe(3);
  });
});
