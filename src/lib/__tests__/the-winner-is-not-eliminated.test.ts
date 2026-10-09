import { describe, it, expect } from "vitest";
import { exportStatus } from "@/lib/domain/csv-export";
import { readSource } from "./source";

/**
 * THE WINNER OF AN ORDINARY MEDAL IS NOT "ELIMINATED" (2026-10-09).
 *
 * Read off the standings CSV for grid cell T58 — a one-round medal, no cut, no
 * knockout. Advancing means going on to a cut round or a bracket; with neither,
 * `advancing` is false for every player, so the Status column read
 * "Eliminated" against all of them, the winner included — in the file that is
 * printed, pinned up and mailed to a committee. A no-show read "Eliminated"
 * too, where every board says "didn't play Round 1".
 */
const row = (over: Partial<Parameters<typeof exportStatus>[0]> = {}) => ({ rank: 1, ranked: true, ...over });

describe("a round that decides nobody's progress", () => {
  it("leaves a ranked player's status blank — the winner included", () => {
    expect(exportStatus(row(), false)).toBe("");
    expect(exportStatus(row({ rank: 4 }), false)).toBe("");
  });

  it("says why a row holds no place", () => {
    expect(exportStatus(row({ ranked: false, rank: 0, missedRound: "Round 1" }), false)).toBe("Didn't play Round 1");
    expect(exportStatus(row({ ranked: false, rank: 0 }), false)).toBe("Not ranked");
    expect(exportStatus(row({ ranked: false, disqualified: true }), false)).toBe("DQ");
    expect(exportStatus(row({ ranked: false, withdrew: true }), false)).toBe("WD");
  });
});

describe("a round with a cut or a knockout ahead — the control", () => {
  it("still says Advancing and Eliminated", () => {
    expect(exportStatus(row({ advancing: true }), true)).toBe("Advancing");
    expect(exportStatus(row({ rank: 9, advancing: false }), true)).toBe("Eliminated");
    expect(exportStatus(row({ tiedAtCut: true }), true)).toBe("Tied — play-off to decide");
  });

  it("and a no-show there did not play rather than being eliminated", () => {
    expect(exportStatus(row({ ranked: false, rank: 0, missedRound: "Round 1" }), true)).toBe("Didn't play Round 1");
  });
});

describe("Reports hands the export the answer", () => {
  it("passes the tournament's own qualifying flag", () => {
    expect(readSource("src/app/(app)/reports/page.tsx")).toMatch(/\squalifying=\{state\.qualifying\}/);
    expect(readSource("src/components/ReportsClient.tsx")).toMatch(/exportStatus\(r, qualifying\)/);
  });
});

/**
 * AND THE EXPORTS RANK ONLY ROWS THAT HOLD A PLACE (2026-10-09). Read off the
 * real files: a DQ and a no-show shared "3rd" in flight-results, a side with no
 * card was 2nd in team-standings at gross 0 / net 0 / E, and the Modified
 * Stableford and team files numbered by list index. Each now takes the board's
 * own places and leaves a no-card row blank.
 */
describe("the other exports take the board's places", () => {
  const reports = () => readSource("src/app/(app)/reports/page.tsx");
  it("team standings", () => {
    expect(reports()).toMatch(/placesByValue\(teams, \(t\) => valueOnBasis\(basis, t\), \(t\) => t\.played > 0\)/);
  });
  it("modified Stableford", () => {
    expect(reports()).toMatch(/placesByValue\(mod, \(r\) => r\.points, \(r\) => r\.played > 0\)/);
  });
  it("neither numbers by list index any more", () => {
    expect(reports()).not.toMatch(/String\(i \+ 1\)/);
  });
});
