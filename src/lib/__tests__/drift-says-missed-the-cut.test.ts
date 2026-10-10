import { describe, it, expect } from "vitest";
import { driftSentence, teeSheetDrift, type TeeSheet } from "@/lib/domain/tee-sheet";

/**
 * A SHEET DRAWN BEFORE THE CUT, READ AFTER IT (2026-10-10). Walked on a
 * 120-player championship: the Round 2 sheet drawn ahead of the cut said
 * "79 drawn players have left the field" — a withdrawal's words, about players
 * who had only missed the cut. And one short group read "leaving short: Group 1".
 */
const sheet = (groups: string[][]): TeeSheet => ({
  savedAt: "",
  startType: "tee",
  groups: groups.map((ids, i) => ({ name: `Group ${i + 1}`, startHole: 1, time: "", playerIds: ids })),
});

describe("what a stale tee sheet says", () => {
  it("says the cut players missed the cut, and a withdrawal left the field", () => {
    const drift = teeSheetDrift(sheet([["a", "b", "c"], ["d", "e", "wd"]]), new Set(["a", "b", "d"]));
    expect(driftSentence(drift, new Set(["c", "e"]))).toBe(
      "2 drawn players have missed the cut. 1 drawn player has left the field. That leaves these groups short: Group 1, Group 2.",
    );
  });

  it("CONTROL: with no cut, a departure is a departure", () => {
    const drift = teeSheetDrift(sheet([["a", "b"]]), new Set(["a"]));
    expect(driftSentence(drift)).toBe("1 drawn player has left the field. That leaves Group 1 short.");
  });

  it("counts a long list of short groups instead of naming thirty of them", () => {
    const groups = Array.from({ length: 28 }, (_, i) => [`k${i}`, `x${i}`]);
    const drift = teeSheetDrift(sheet(groups), new Set(groups.map((g) => g[0])));
    const cut = new Set(groups.map((g) => g[1]));
    expect(driftSentence(drift, cut)).toBe("28 drawn players have missed the cut. That leaves 28 groups short.");
  });

  it("names a confirmed player with no tee time", () => {
    const drift = teeSheetDrift(sheet([["a"]]), new Set(["a", "late"]));
    expect(driftSentence(drift)).toBe("1 confirmed player has no tee time.");
  });
});
