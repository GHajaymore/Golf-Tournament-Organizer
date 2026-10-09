import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { unrankedNote, type StandingRow } from "@/components/LeaderboardTable";
import { PlayerLeaderboard } from "@/components/PlayerLeaderboard";
import { readSource } from "./source";

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

  /**
   * A MISSED CUT IS NOT A NO-SHOW (2026-10-08). Once round 2 was closed a
   * player cut after round 1 read "didn't play Round 2" on every board — a
   * player who failed to turn up, not one the cut sent home.
   */
  it("says a player missed the cut, before saying what they did not play", () => {
    const cut = row({ missedCut: "Round 1", missedRound: "Round 2" });
    expect(unrankedNote(cut)).toBe("Missed the cut after Round 1");
    const html = renderToStaticMarkup(
      <PlayerLeaderboard isStroke isStableford={false} rows={[cut]} holes={18} unit="strokes" cutNote="" />,
    );
    expect(html).toContain("F · missed the cut");
    expect(html).not.toContain("didn&#x27;t play");
  });

  it("says WD for a player who withdrew, on both boards", () => {
    const wd = row({ withdrew: true, thru: 27, holesOwed: 36 });
    expect(unrankedNote(wd)).toBe("WD — withdrew");
    const html = renderToStaticMarkup(
      <PlayerLeaderboard isStroke isStableford={false} rows={[wd]} holes={18} unit="strokes" cutNote="" />,
    );
    expect(html).toContain("thru 27 · WD");
    expect(html).not.toContain("not ranked");
  });

  it("says DQ for a player the committee disqualified, on both boards", () => {
    const dq = row({ disqualified: true, thru: 18 });
    expect(unrankedNote(dq)).toBe("DQ — disqualified");
    const html = renderToStaticMarkup(
      <PlayerLeaderboard isStroke isStableford={false} rows={[dq]} holes={18} unit="strokes" cutNote="" />,
    );
    expect(html).toContain("F · DQ");
  });

  it("and Today does not ask a cut player for a card the cut never owed them", () => {
    const src = readSource("src/lib/services/me.ts");
    expect(src).toMatch(/const closedWithout =\s*!cutOut && stage\.closedAt != null/);
  });
});

/**
 * A NO-SHOW ON A CLOSED ROUND DID NOT PLAY IT (2026-10-08, grid cell T48).
 * Entered, never teed off, and the committee closed the round: the public
 * board read FINAL over "Dan · not started" — somebody who may still walk in —
 * and the console a row of dashes. Both now say what happened.
 */
describe("a player with no card for a closed round", () => {
  const noShow = row({ thru: 0, gross: 0, net: 0, toPar: 0, started: false, missedRound: "Round 1" });

  it("reads 'didn't play Round 1' on the player's board and the public link", () => {
    const html = renderToStaticMarkup(
      <PlayerLeaderboard isStroke isStableford={false} rows={[noShow]} holes={18} unit="strokes" cutNote="" />,
    );
    expect(html).toContain("didn&#x27;t play Round 1");
    expect(html).not.toContain("not started");
  });

  it("is captioned on the console", () => {
    expect(unrankedNote(noShow)).toBe("Didn't play Round 1");
  });

  it("while a round still open is 'not started' — the control", () => {
    const early = row({ thru: 0, gross: 0, net: 0, toPar: 0, started: false, missedRound: "" });
    const html = renderToStaticMarkup(
      <PlayerLeaderboard isStroke isStableford={false} rows={[early]} holes={18} unit="strokes" cutNote="" />,
    );
    expect(html).toContain("not started");
    expect(unrankedNote(early)).toBe("");
  });
});
