import { describe, it, expect } from "vitest";
import { readSource } from "./source";

/**
 * THE DASHBOARD'S FLIGHT CARD PRINTS THE FIGURE ITS ROWS ARE ORDERED BY.
 *
 * Found 2026-09-26 on a newcomer's club Stableford: the card was sorted by
 * points and printed a to-par, so Flight 1 read "+18, +18, E, +18" — the
 * level-par round third, behind two players eighteen over. The leaderboard
 * card above it printed points correctly; this card had no Stableford branch.
 * `board-prints-what-it-ranked-on` holds the rule for the boards; the flight
 * card is built inline in the dashboard page, so it is pinned here.
 */
describe("the dashboard flight card", () => {
  const src = readSource("src/app/(app)/dashboard/page.tsx");
  const start = src.indexOf("const flightColumns");
  const block = src.slice(start, src.indexOf("}));", src.indexOf(": groupStandings", start)));

  it("is found (control)", () => {
    expect(start).toBeGreaterThan(0);
    expect(block).toMatch(/strokeStandings/);
  });

  it("prints points on a Stableford board", () => {
    expect(block).toMatch(/stablefordBoard\s*\?\s*`\$\{s\.points\} pts`/);
    // Decided by the same test the leaderboard card on this page uses.
    expect(src).toMatch(
      /const stablefordBoard = isStablefordRound\(state\.boardStage\?\.scoringBasis, state\.boardStage\?\.format\)/,
    );
  });

  it("prints the board's own to-par otherwise, never the raw gross", () => {
    expect(block).toMatch(/toParText\(s\.toParShown\)/);
    expect(block).not.toMatch(/toParText\(s\.toPar\)/);
  });
});
