import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { unrankedNote, type StandingRow } from "@/components/LeaderboardTable";
import { PlayerLeaderboard } from "@/components/PlayerLeaderboard";

/**
 * A ROW WITHOUT A PLACE SAYS WHY, AND THE THREE REASONS ARE DIFFERENT.
 *
 * Completing a tournament now closes its rounds (Ajay, 2026-09-26), which
 * unranks every player with no card for a closed round — a player cut after
 * round 1 of a championship. The console captioned them "card incomplete" and
 * the player's board and the public link "F · not ranked": both wrong about a
 * complete card whose owner simply did not play round 2.
 */
const row = (over: Partial<StandingRow>): StandingRow =>
  ({
    id: "p1", rank: 0, ranked: false, started: true, name: "zz-Ann Doyle", flight: "—",
    advancing: false, tiedAtCut: false, record: "", diff: "", pts: "", played: 0, wins: 0,
    ties: 0, losses: 0, gross: 76, net: 76, toPar: 4, parKnown: true, points: 0,
    thru: 18, holesOwed: 18, ...over,
  }) as StandingRow;

describe("why a stroke row holds no place", () => {
  it("names the closed round a player did not play", () => {
    expect(unrankedNote(row({ missedRound: "Round 2" }))).toBe("Not ranked — didn't play Round 2");
  });

  it("keeps the other two reasons for the cases they describe (controls)", () => {
    expect(unrankedNote(row({ thru: 14, holesOwed: 18 }))).toBe("Not ranked — 14 of 18 holes played");
    expect(unrankedNote(row({}))).toBe("Not ranked — card incomplete");
    expect(unrankedNote(row({ ranked: true, rank: 3, missedRound: "" }))).toBe("");
  });

  it("says the same on the player's board and the public link", () => {
    const html = renderToStaticMarkup(
      <PlayerLeaderboard
        isStroke
        isStableford={false}
        rows={[row({ missedRound: "Round 2" }), row({ id: "p2", name: "zz-Rob Ferris", ranked: true, rank: 1, missedRound: "" })]}
        holes={18}
        unit="strokes"
        cutNote=""
      />,
    );
    expect(html).toContain("didn&#x27;t play Round 2");
    expect(html).not.toContain("F · not ranked");
  });
});
