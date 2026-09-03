import { describe, it, expect } from "vitest";
import { computeStandings, DEFAULT_SCORING, marginToHoles, type Player } from "../index";
import { suggestChampion } from "../honours";

/**
 * Two players nothing separates share a place.
 *
 * `rankPlayers` numbered `i + 1` down the sorted list, so the match-play
 * standings could never hold the same rank twice however level two players
 * actually were. The sort's last fallback is SEED — entry order — so a dead
 * heat was broken by whoever signed up first, and the board printed 1 and 2 as
 * though somebody had won.
 *
 * The consequence is permanent. `suggestChampion` declines to name anybody
 * when `leaders.length > 1`, and that branch could never fire for a non-stroke
 * event, so a two-player match halved on the last green put the lower seed on
 * the club's honours board with no tie for a committee to resolve.
 */

const player = (id: string, name: string, handicap: number, seed: number): Player => ({
  id,
  name,
  handicap,
  seed,
  groupId: "g",
});

const match = (id: string, aId: string, bId: string, winner: "A" | "B" | "H", margin: string) => ({
  id,
  stageId: "s1",
  groupId: "g",
  round: 1,
  playerAId: aId,
  playerBId: bId,
  holes: marginToHoles(winner, margin, 18),
});

/** No tiebreakers configured: the plainest possible dead heat. */
const NO_TIEBREAKS = { ...DEFAULT_SCORING, tiebreakers: [] };

describe("a match nothing separates", () => {
  it("gives both players the same place", () => {
    const players = [player("p1", "Alice", 10, 1), player("p2", "Bob", 10, 2)];
    const standings = computeStandings(
      players,
      [match("m1", "p1", "p2", "H", "AS")],
      NO_TIEBREAKS,
    );

    expect(standings.map((s) => s.rank)).toEqual([1, 1]);
  });

  it("does not let entry order decide it", () => {
    /**
     * The fault in one assertion. Seed is the sort's last fallback and it
     * always separates, so the old code handed first place to whoever signed
     * up first — a fact about the sign-up sheet, printed as a result.
     */
    const players = [player("p1", "Alice", 10, 1), player("p2", "Bob", 10, 2)];
    const standings = computeStandings(players, [match("m1", "p1", "p2", "H", "AS")], NO_TIEBREAKS);
    const bySeed = [...standings].sort((a, b) => a.player.seed - b.player.seed);
    expect(bySeed[0].rank).toBe(bySeed[1].rank);
  });

  it("refuses to name a champion, which is the point", () => {
    const players = [player("p1", "Alice", 10, 1), player("p2", "Bob", 10, 2)];
    const standings = computeStandings(players, [match("m1", "p1", "p2", "H", "AS")], NO_TIEBREAKS);

    const suggestion = suggestChampion({
      completed: true,
      positions: standings.map((s) => ({
        playerId: s.player.id,
        name: s.player.name,
        rank: s.rank,
      })),
    });

    // A halved match has no winner, and the honours board is permanent.
    expect(suggestion.ok).toBe(false);
    // Both names come back, so the committee is asked rather than told.
    expect(
      suggestion.ok === false ? suggestion.tied.map((t) => t.name).sort() : [],
    ).toEqual(["Alice", "Bob"]);
  });

  it("puts the next player third, not second", () => {
    // Standard competition ranking: two share first, so second place does not
    // exist and the next player is third.
    const players = [
      player("p1", "Alice", 10, 1),
      player("p2", "Bob", 10, 2),
      player("p3", "Cara", 10, 3),
    ];
    const standings = computeStandings(
      players,
      [
        match("m1", "p1", "p3", "A", "3&2"),
        match("m2", "p2", "p3", "A", "3&2"),
        match("m3", "p1", "p2", "H", "AS"),
      ],
      NO_TIEBREAKS,
    );

    const rankOf = (id: string) => standings.find((s) => s.player.id === id)!.rank;
    expect(rankOf("p1")).toBe(1);
    expect(rankOf("p2")).toBe(1);
    expect(rankOf("p3")).toBe(3);
  });
});

describe("a tiebreaker that does separate them", () => {
  it("still separates them", () => {
    /**
     * The guard against the guard. Sharing a rank must only happen when
     * NOTHING the organizer configured can split the two — otherwise a
     * tournament with a working countback stops using it and every close
     * finish becomes a tie nobody asked for.
     *
     * Alice and Bob both beat Cara and halve each other, so they are level on
     * points; Alice wins more holes doing it, and holes-won-ratio is in the
     * chain.
     */
    const players = [
      player("p1", "Alice", 10, 1),
      player("p2", "Bob", 10, 2),
      player("p3", "Cara", 10, 3),
    ];
    const scoring = { ...DEFAULT_SCORING, tiebreakers: ["holes-won-ratio" as const] };
    const standings = computeStandings(
      players,
      [
        match("m1", "p1", "p3", "A", "6&5"),
        match("m2", "p2", "p3", "A", "2&1"),
        match("m3", "p1", "p2", "H", "AS"),
      ],
      scoring,
    );

    const rankOf = (id: string) => standings.find((s) => s.player.id === id)!.rank;
    expect(rankOf("p1")).toBe(1);
    expect(rankOf("p2")).toBe(2);
  });

  it("separates players on different points without consulting anything else", () => {
    const players = [player("p1", "Alice", 10, 1), player("p2", "Bob", 10, 2)];
    const standings = computeStandings(
      players,
      [match("m1", "p1", "p2", "A", "3&2")],
      NO_TIEBREAKS,
    );
    expect(standings.map((s) => s.rank)).toEqual([1, 2]);
  });
});

describe("the ranks a board can print", () => {
  it("are non-decreasing down the list", () => {
    const players = Array.from({ length: 6 }, (_, i) => player(`p${i}`, `P${i}`, 10, i + 1));
    const standings = computeStandings(players, [], NO_TIEBREAKS);
    const ranks = standings.map((s) => s.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it("gives a whole field that has played nothing the same place", () => {
    // Everyone on zero, nothing to separate them: six players sharing first is
    // the honest answer before a ball is struck, and it is what stops the
    // qualification screen reading seed order as a result.
    const players = Array.from({ length: 6 }, (_, i) => player(`p${i}`, `P${i}`, 10, i + 1));
    const standings = computeStandings(players, [], NO_TIEBREAKS);
    expect(standings.every((s) => s.rank === 1)).toBe(true);
  });
});
