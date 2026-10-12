import { describe, it, expect } from "vitest";
import { computeStandings, DEFAULT_SCORING, DEFAULT_TIEBREAKERS, marginToHoles, type Player } from "../domain";
import { tournamentTerms } from "../rules";
import { readSource } from "./source";

/**
 * A COMMITTEE THAT CHOOSES NO TIE-BREAKERS GETS NONE (sweep 1, b2, 2026-10-10).
 *
 * Three parts of the app answered "what if every tie-breaker is unticked?"
 * three ways:
 *
 *   the screen    "None active — level standings fall back to seed order."
 *   the save      stored all EIGHT tie-breakers, so a reload showed eight ticked
 *   the standings read an empty chain as the default FOUR
 *
 * So the one thing a committee could not do was the thing the screen said it
 * had done. How ties are decided is the Committee's to set (Committee
 * Procedures 5A(6)), and "they are not — level players share the place" is a
 * choice many leagues make on purpose.
 *
 * An empty chain is now kept as empty and read as empty: nothing separates
 * players level on points, they share the place, and they are LISTED in entry
 * order, which decides nothing. The rules sheet says so.
 */

const player = (id: string, seed: number, handicap: number): Player => ({ id, name: id, handicap, seed, groupId: "g" });
const match = (id: string, a: string, b: string, winner: "A" | "B", margin: string) => ({
  id, stageId: "s", groupId: "g", round: 1, playerAId: a, playerBId: b, holes: marginToHoles(winner, margin, 18),
});

/**
 * A cycle: everybody has won one and lost one, so all three are level on
 * points — and every tie-breaker in the default chain can tell them apart,
 * because the three wins are by different margins.
 *
 * Points for the result only. The default also pays half a point for the
 * share of holes won, which separates these three on POINTS and leaves no tie
 * for a tie-breaker to be asked about.
 */
const RESULT_ONLY = { ...DEFAULT_SCORING, holeRatioPts: 0 };
const players = [player("ann", 1, 18), player("bea", 2, 9), player("cat", 3, 2)];
const cycle = [
  match("m1", "ann", "bea", "A", "5&4"),
  match("m2", "bea", "cat", "A", "1 UP"),
  match("m3", "cat", "ann", "A", "2&1"),
];

describe("no tie-breakers", () => {
  it("CONTROL: the default chain separates this field — or the case below proves nothing", () => {
    const rows = computeStandings(players, cycle, { ...RESULT_ONLY, tiebreakers: DEFAULT_TIEBREAKERS });
    expect(new Set(rows.map((r) => r.stats.totalPoints)).size, "the fixture is not level on points").toBe(1);
    expect(new Set(rows.map((r) => r.rank)).size, "the default chain could not separate them either").toBeGreaterThan(1);
  });

  it("an empty chain separates nobody: the three share first place", () => {
    const rows = computeStandings(players, cycle, { ...RESULT_ONLY, tiebreakers: [] });
    expect(rows.map((r) => r.rank)).toEqual([1, 1, 1]);
  });

  it("and lists them in entry order, which is an order and not a result", () => {
    const rows = computeStandings(players, cycle, { ...RESULT_ONLY, tiebreakers: [] });
    expect(rows.map((r) => r.player.id)).toEqual(["ann", "bea", "cat"]);
  });

  it("the rules sheet says ties are shared, rather than saying nothing", () => {
    const terms = tournamentTerms({
      format: "Match Play", type: "Round Robin", holes: 18, scoringBasis: "gross", handicapAllowance: 100, countBest: 0,
      tiebreakers: [], cutEnabled: false, cutMode: "", cutCount: 0, cutPercent: 0, carryForwardEnabled: false, carryForwardPct: 0,
    });
    const ties = terms.find((t) => t.label === "Ties");
    expect(ties, "a match-play round with no tie-breakers printed no line about ties").toBeDefined();
    expect(ties!.value).toMatch(/share/i);
  });
});

describe("the save keeps what the committee chose", () => {
  const body = (() => {
    const src = readSource("src/app/actions/tournament.ts");
    return src.slice(src.indexOf("export async function saveTiebreakers")).slice(0, 900);
  })();

  it("does not swap an empty chain for the full list", () => {
    // It stored `valid.length ? valid : TIEBREAKER_KEYS` — eight tie-breakers
    // in place of none.
    expect(body).not.toContain("TIEBREAKER_KEYS");
    expect(body).toContain("JSON.stringify(valid)");
  });

  it("refuses a chain made only of things that are not tie-breakers, rather than reading it as none", () => {
    expect(body).toMatch(/order\.length > 0 && valid\.length === 0/);
  });
});
