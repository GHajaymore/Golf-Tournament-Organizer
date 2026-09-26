import { describe, it, expect } from "vitest";
import { readSource } from "./source";

/**
 * A STRAIGHT KNOCKOUT'S STANDINGS ARE ITS DRAW.
 *
 * Found 2026-09-26 with a semi-final already decided on the bracket: the Live
 * leaderboard printed all eight players on 0 played and 0 points "reflecting
 * the qualification cutoff", and the dashboard showed "Qualification cutoff ·
 * Top 2/flight · cutoff ≈ 0 pts" and "8 of 8 advancing" — for a draw nobody
 * qualified into (a first-round bracket draws the whole field). Both screens
 * are server pages, so the decision is pinned at source; each assertion was
 * watched fail.
 */
const STRAIGHT = /state\.stages\.findIndex\(\(s\) => isKnockoutRound\(s\.type\)\) === 0/;

describe("the Live leaderboard", () => {
  const src = readSource("src/app/(app)/leaderboard/page.tsx");

  it("shows the draw, read-only, for a straight knockout", () => {
    expect(src).toMatch(STRAIGHT);
    const at = src.search(STRAIGHT);
    const branch = src.slice(at, src.indexOf("if (kind ===", at));
    expect(branch).toMatch(/<BracketClient[\s\S]*readOnly[\s\S]*straight/);
  });
});

describe("the dashboard", () => {
  const src = readSource("src/app/(app)/dashboard/page.tsx");

  it("knows a straight knockout by the same test", () => {
    expect(src).toMatch(new RegExp(`const straightKnockout = ${STRAIGHT.source}`));
  });

  it("offers no qualification or advancing figure for one", () => {
    expect(src).toMatch(/hasKnockout && !straightKnockout && showStandings && \(\s*<StatCard label="Advancing"/);
    expect(src).toMatch(/hasKnockout && !straightKnockout && showStandings && \(\s*<FactCard\s+title="Qualification cutoff"/);
  });

  it("prints no 0-0-0 standings table for one", () => {
    expect(src).toMatch(/usesStandardBoard\(state\.boardStage\?\.format\) && !straightKnockout/);
  });
});
