import { describe, it, expect } from "vitest";
import { standingsFactLines, type FactRow } from "@/lib/domain/standings-facts";
import { readSource } from "./source";

/**
 * A DRAFTED MESSAGE IS WRITTEN FROM THE BOARD, NOT FROM ONE STEP BEFORE IT
 * (2026-10-09). `draftFactsFor` read `state.strokeStandings`, whose to-par is
 * GROSS; the net basis is applied in `standingRows`. On a net medal the model
 * was handed a gross to-par for a field ranked on net — and wrote sentences a
 * club then sends to its members.
 */
const row = (over: Partial<FactRow>): FactRow => ({
  rank: 1, ranked: true, started: true, name: "zz-Ann", gross: 81, net: 53, points: 0, pts: "",
  toPar: -18, parKnown: true, thru: 18, holesOwed: 18, ...over,
});

describe("the leaderboard facts", () => {
  it("give a net board the to-par the board prints, beside both totals", () => {
    // `toPar` here is what `standingRows` hands over: already on the net basis.
    const f = standingsFactLines([row({})], { isStableford: false, unit: "net strokes" });
    expect(f.heading).toBe("Leaderboard (net strokes, fewest first):");
    expect(f.lines[0]).toBe("  1. zz-Ann — -18 (gross 81, net 53), finished");
  });

  it("give a Stableford board its points, not strokes", () => {
    const f = standingsFactLines([row({ points: 38 })], { isStableford: true, unit: "Stableford points" });
    expect(f.heading).toBe("Leaderboard (Stableford points, most first):");
    expect(f.lines[0]).toBe("  1. zz-Ann — 38 pts (gross 81), finished");
  });

  it("say level par in words, share a place, and read today's round", () => {
    const f = standingsFactLines(
      [
        row({ name: "zz-Ann", toPar: 0, thru: 36, holesOwed: 36, roundThru: 18, roundHoles: 18 }),
        row({ name: "zz-Bea", toPar: 0, thru: 27, holesOwed: 36, roundThru: 9, roundHoles: 18 }),
      ],
      { isStableford: false, unit: "gross strokes" },
    );
    expect(f.lines).toEqual([
      "  T1. zz-Ann — level par (gross 81, net 53), finished",
      "  T1. zz-Bea — level par (gross 81, net 53), through 9",
    ]);
  });

  it("leave out a row that holds no place, and its name", () => {
    const f = standingsFactLines(
      [row({}), row({ name: "zz-Cut", rank: 0, ranked: false, missedCut: "Round 1" })],
      { isStableford: false, unit: "gross strokes" },
    );
    expect(f.lines).toHaveLength(1);
    expect(f.names).toEqual(["zz-Ann"]);
  });

  it("are built from the board's rows", () => {
    const src = readSource("src/lib/services/draft-facts.ts");
    expect(src).toMatch(/standingsFactLines\(standingRows\(state\)/);
    expect(src).not.toMatch(/state\.strokeStandings/);
  });
});
