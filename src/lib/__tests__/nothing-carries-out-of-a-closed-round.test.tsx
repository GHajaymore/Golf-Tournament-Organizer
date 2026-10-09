import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SkinsStandingsTable, NassauMatches } from "@/components/PointsLeaderboard";
import type { SkinsBoard } from "@/lib/services/points-standings";
import { readSource } from "./source";

/**
 * NOTHING CARRIES OUT OF A CLOSED ROUND (2026-10-08, grid cell T53).
 *
 * A skins round closed by the committee, the last fifteen holes tied. Under
 * FINAL the board read "15 skins are still carrying — the last decided hole
 * was tied. 18 holes decided so far." Skins tied through the last hole are not
 * won; nothing is coming for them to carry to.
 */
const board: SkinsBoard = {
  outcome: {
    holes: Array.from({ length: 18 }, (_, i) => ({ hole: i + 1 })) as unknown as SkinsBoard["outcome"]["holes"],
    standings: [{ playerId: "a", skins: 2, holesWon: [1, 2] }] as unknown as SkinsBoard["outcome"]["standings"],
    unclaimed: 15,
  },
  nameById: { a: "zz-Ann" },
};
const text = (roundClosed: boolean) =>
  renderToStaticMarkup(createElement(SkinsStandingsTable, { board, roundClosed })).replace(/<[^>]+>/g, " ");

describe("the skins board over a closed round", () => {
  it("says the skins were never won, and nothing about 'so far'", () => {
    const t = text(true);
    expect(t).toContain("15 skins were never won");
    expect(t).not.toMatch(/still carrying|so far/);
  });

  it("says they are carrying while the round is open — the control", () => {
    expect(text(false)).toContain("15 skins are still carrying");
  });

  it("is told the round is closed wherever it is drawn for a round", () => {
    for (const f of [
      "src/app/(app)/reports/page.tsx",
      "src/app/(player)/me/board/page.tsx",
      "src/app/live/[token]/page.tsx",
    ]) {
      expect(readSource(f), f).toMatch(/<SkinsStandingsTable board=\{[^}]+\} roundClosed=\{/);
    }
    expect(readSource("src/app/(app)/leaderboard/page.tsx")).toMatch(/<SkinsLeaderboard [^>]*\sroundClosed=\{/);
  });
});

/**
 * And a Nassau round closed with no matches drawn read "No matches in this
 * round yet" under FINAL (grid cell T54) — a promise of matches to come.
 */
describe("the Nassau board over a closed round", () => {
  const nassau = (roundClosed: boolean) =>
    renderToStaticMarkup(createElement(NassauMatches, { rows: [], roundClosed }));

  it("says no matches were played", () => {
    expect(nassau(true)).toContain("No matches were played in this round.");
    expect(nassau(true)).not.toContain("yet");
  });

  it("says 'yet' while the round is open — the control", () => {
    expect(nassau(false)).toContain("No matches in this round yet.");
  });
});
