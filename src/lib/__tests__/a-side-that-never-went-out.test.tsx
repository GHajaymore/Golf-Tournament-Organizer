import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TeamStandingsTable } from "@/components/TeamLeaderboard";
import type { TeamStanding } from "@/lib/services/teams";
import { readSource } from "./source";

/**
 * A SIDE THAT NEVER WENT OUT, IN A CLOSED ROUND (2026-10-08, grid cell T51).
 *
 * A best ball closed by the committee with Cat & Dot never out. The board read
 * "1 of 2 sides have started" under FINAL — a round still going — and Dot's
 * Today "YOUR SIDE · NOT STARTED · Your side's card hasn't been started yet",
 * a promise of a card the closed round cannot take.
 */
const side = (teamId: string, played: number): TeamStanding => ({
  teamId,
  name: `zz-side ${teamId}`,
  members: [],
  memberIds: [],
  playingHandicap: 26,
  gross: played ? 71 : 0,
  net: played ? 62 : 0,
  points: 0,
  played,
  toPar: played ? -9 : 0,
});
const html = (roundClosed: boolean) =>
  renderToStaticMarkup(
    createElement(TeamStandingsTable, { basis: "net", rows: [side("a", 18), side("b", 0)], roundClosed }),
  );

describe("the sides board over a closed round", () => {
  it("says who returned a card, not who has started", () => {
    expect(html(true)).toContain("1 of 2 sides returned a card.");
    expect(html(true)).not.toContain("have started");
  });

  it("says 'have started' while the round is open — the control", () => {
    expect(html(false)).toContain("1 of 2 sides have started.");
  });

  it("is told the round is closed by every board that draws it", () => {
    for (const f of [
      "src/app/(app)/leaderboard/page.tsx",
      "src/app/(app)/reports/page.tsx",
      "src/app/(player)/me/board/page.tsx",
      "src/app/live/[token]/page.tsx",
    ]) {
      expect(readSource(f), f).toMatch(/\sroundClosed=\{/);
    }
  });
});

describe("Today's side card in a closed round", () => {
  it("does not promise a card the round cannot take", () => {
    const src = readSource("src/app/(player)/me/page.tsx");
    expect(src).toMatch(/sideRoundClosed \? "Your side · did not play"/);
    expect(src).toMatch(/has closed this round; there's no card from your side/);
  });
});
