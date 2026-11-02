import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/dashboard",
}));
vi.mock("@/app/actions/tournament", () => ({ setRoundClosed: vi.fn(), settleCutTie: vi.fn() }));

import { CutReadyCard } from "@/components/CutReadyCard";
import { PlayerLeaderboard } from "@/components/PlayerLeaderboard";
import type { StandingRow } from "@/components/LeaderboardTable";

/**
 * A CUT'S TIE THE COMMITTEE HAS STILL TO SETTLE, AS IT IS DRAWN (2026-10-23).
 *
 * On the player's board: the tie is ON the line, so the line goes under it and
 * each row says "tied for the last place" — drawn under the last certain player
 * it put the tie below the line, which is how a player reads "out". On the cut
 * card: the tie is named with a tick per player, and the button it holds up
 * says why beside itself.
 */
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const row = (id: string, rank: number, over: Partial<StandingRow> = {}): StandingRow => ({
  id,
  rank,
  ranked: true,
  started: true,
  name: `Player ${id}`,
  flight: "",
  advancing: false,
  record: "",
  diff: "",
  pts: "",
  played: 0,
  wins: 0,
  ties: 0,
  losses: 0,
  gross: 72,
  net: 72,
  toPar: 0,
  points: 0,
  thru: 18,
  holesOwed: 18,
  ...over,
});

describe("the player's board, with a tie on the cut line", () => {
  const board = (rows: StandingRow[]) =>
    text(renderToStaticMarkup(<PlayerLeaderboard isStroke rows={rows} holes={18} cutNote="NOTE" />));

  it("draws the line under the tie, and marks each player in it", () => {
    const t = board([
      row("lead", 1, { advancing: true, toPar: -2 }),
      row("ann", 2, { tiedAtCut: true, cutTieBy: "playoff" }),
      row("bob", 3, { tiedAtCut: true, cutTieBy: "playoff" }),
      row("cy", 4, { toPar: 3 }),
    ]);
    // The line, and its note, come after Bob — not after the leader.
    expect(t.indexOf("Cut line")).toBeGreaterThan(t.indexOf("Player bob"));
    expect(t.indexOf("Cut line")).toBeLessThan(t.indexOf("Player cy"));
    expect(t.match(/tied for the last place/g)).toHaveLength(2);
  });

  it("CONTROL: with nobody in a tie, the line is under the last player through", () => {
    const t = board([row("lead", 1, { advancing: true, toPar: -2 }), row("ann", 2), row("bob", 3)]);
    expect(t.indexOf("Cut line")).toBeLessThan(t.indexOf("Player ann"));
    expect(t).not.toMatch(/tied for the last place/);
  });
});

describe("the cut card, with a tie to settle", () => {
  const card = (chosen: string[]) =>
    renderToStaticMarkup(
      <CutReadyCard
        feederId="r1"
        feederName="Round 1"
        nextName="Round 2"
        rule="Top 2"
        through={1}
        missed={2}
        tieRule="A tie for the last place is decided by a play-off"
        ties={[{ tied: ["a", "b", "c"], names: ["Ann", "Bob", "Cy"], places: 1, by: "playoff", chosen }]}
      />,
    );

  it("names the tie, offers a tick for each, and holds the button saying why", () => {
    const html = card([]);
    expect(text(html)).toMatch(/Ann, Bob and Cy are level for the last place/);
    expect(html.match(/type="checkbox"/g)).toHaveLength(3);
    expect(text(html)).toMatch(/Record the play-off/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Approve the cut/);
    expect(text(html)).toMatch(/The cut waits on the tie above/);
  });

  it("CONTROL: once recorded, the button opens and the wait is not mentioned", () => {
    const html = card(["b"]);
    expect(text(html)).toMatch(/The play-off for the last place is recorded/);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>.*Approve the cut/);
    expect(text(html)).not.toMatch(/The cut waits on the tie above/);
  });
});
