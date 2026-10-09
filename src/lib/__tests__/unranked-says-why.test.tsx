import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LeaderboardTable, unrankedNote, type StandingRow } from "@/components/LeaderboardTable";
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
    // The guarantee is `!cutOut` leading the condition; what else it asks
    // (a round of cards, closed) may grow — see T50.
    expect(src).toMatch(/const closedWithout =\s*!cutOut &&[^;]*stage\.closedAt != null/);
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

/**
 * TODAY'S ROUND ON A MULTI-ROUND BOARD (2026-10-09, grid cell T67). Round 2
 * under way: a player who had not started it read "F" (Round 1 complete) and
 * one nine holes in read "thru 27". The board reads today's round; a player
 * the cut took out keeps the tournament count, so "missed the cut" still sits
 * against a finished card.
 */
describe("thru on a board two rounds in", () => {
  const two = (over: Partial<StandingRow>) => row({ ranked: true, rank: 1, thru: 18, holesOwed: 18, roundHoles: 18, ...over });
  const html = (rows: StandingRow[]) =>
    renderToStaticMarkup(<PlayerLeaderboard isStroke isStableford={false} rows={rows} holes={18} unit="strokes" cutNote="" />);

  it("calls a player who has not begun today's round not started, not F", () => {
    const out = html([two({ roundThru: 0 })]);
    expect(out).toContain("not started");
    expect(out).not.toMatch(/>F</);
  });

  it("counts today's holes, not the tournament's", () => {
    expect(html([two({ thru: 27, holesOwed: 36, roundThru: 9 })])).toContain("thru 9");
    expect(html([two({ thru: 36, holesOwed: 36, roundThru: 18 })])).not.toContain("thru");
  });

  it("and the console's Thru column says the same", () => {
    const console = (r: StandingRow) =>
      renderToStaticMarkup(<LeaderboardTable isStroke rows={[r]} />).match(/<td style="text-align:center[^>]*>([^<]*)</)?.[1];
    expect(console(two({ thru: 27, holesOwed: 36, roundThru: 9 }))).toBe("9");
    expect(console(two({ roundThru: 0 }))).toBe("—");
    // The control: a one-round row keeps its count.
    expect(console(row({ ranked: true, rank: 1, thru: 14, holesOwed: 18 }))).toBe("14");
  });

  it("and so does the standings CSV, which said 36 / 27 / 18 under the same heading", () => {
    const src = readSource("src/components/ReportsClient.tsx");
    expect(src).toMatch(/const thruCell = \(r: StandingRow\) => String\(todaysThru\(r, r\.holesOwed\)\.thru\)/);
    expect(src.match(/r\.flight, thruCell\(r\), blankIfNone/g)?.length, "both stroke rows").toBe(2);
    expect(src).not.toMatch(/String\(r\.thru\)/);
  });

  it("a one-round board and a missed cut are read as before — the controls", () => {
    expect(html([row({ ranked: true, rank: 1, thru: 9, holesOwed: 18 })])).toContain("thru 9");
    expect(html([row({ thru: 18, holesOwed: 18, roundThru: 0, roundHoles: 18, missedCut: "Round 1" })])).toContain("F · missed the cut");
  });
});
