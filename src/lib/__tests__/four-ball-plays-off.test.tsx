import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
  redirect: vi.fn(),
  notFound: vi.fn(),
}));
// A click is the only thing that calls an action; a render only holds them.
function actionModule() {
  return new Proxy({}, { get: (_t, key) => (typeof key === "string" && key !== "then" ? async () => ({ ok: true }) : undefined) }) as Record<string, unknown>;
}
vi.mock("@/app/actions/teams", actionModule);
vi.mock("@/app/actions/tournament", actionModule);

import { TeamsClient } from "@/components/TeamsClient";
import { TeamEntryClient } from "@/components/TeamEntryClient";
import { TeeSheetPrint } from "@/components/TeeSheetPrint";
import { TeamMatchLeaderboard, TEAM_MATCH_BOARD_NOTE } from "@/components/TeamMatchLeaderboard";
import { readSource } from "./source";

/**
 * "PLAYS OFF" IS WHAT A PLAYER TAKES STROKES FROM (backlog J23, 2026-11-05).
 *
 * Where every player plays their own ball (four-ball, best ball, a shamble) the
 * side has no handicap anybody plays off, so a screen prints each player's own
 * figure — "Plays off 8 · 10" — and never the side's. Where the side shares one
 * ball (foursomes, greensomes, a scramble) the side is the player and its
 * figure is right. #1026 did this on the team board and the rules sheet; these
 * are the other screens that said "Plays off" or printed a side number.
 *
 * SIDE is distinct from every player's figure, so a screen that printed the
 * side's by mistake is seen.
 */
const SIDE = 777;
const PARS = Array(18).fill(4);
const SI = Array.from({ length: 18 }, (_, i) => i + 1);
const textOf = (html: string) => html.replace(/<[^>]*>/g, "");

const formatOf = (name: string, sharesOneCard: boolean) => ({
  name, desc: "", min: 2, max: 2, sharesOneCard, allowance: 85, recommendedAllowance: 85,
  allowanceOverridden: false, allowanceIsConvention: false,
  shares: null, recommendedShares: null, sharesOverridden: false,
  countBest: null, countBestOverridden: false, maxCountBest: 2,
});
const teamsScreen = (name: string, sharesOneCard: boolean) =>
  textOf(
    renderToStaticMarkup(
      <TeamsClient
        rounds={[{ id: "r1", label: "R1", format: name }]} activeRoundId="r1"
        format={formatOf(name, sharesOneCard)}
        teams={[{
          id: "t1", name: "Side A", seed: 1, stageId: "r1", playingHandicap: SIDE,
          members: [
            { playerId: "p1", name: "zz-Ann", handicap: 8, position: 0, playing: sharesOneCard ? null : 7 },
            { playerId: "p2", name: "zz-Bob", handicap: 10, position: 1, playing: sharesOneCard ? null : 9 },
          ],
        }]}
        problems={[]} unassigned={[]} matchCount={0} drawsMatches={false} />,
    ),
  );

describe("Teams screen: Plays off", () => {
  it("a four-ball side says what each partner plays off, and not the side's figure", () => {
    const text = teamsScreen("Four-Ball", false);
    expect(text).toContain("Plays off 7 · 9");
    expect(text).not.toContain(String(SIDE));
  });
  it("CONTROL: a foursomes side keeps the side's figure", () => {
    expect(teamsScreen("Foursomes", true)).toContain(`Plays off ${SIDE}`);
  });
});

const entryScreen = (name: string, own: boolean) =>
  textOf(
    renderToStaticMarkup(
      <TeamEntryClient
        round={name} note="" holes={18} pars={PARS} strokeIndex={SI}
        teams={[{
          teamId: "t1", teamName: "Side A", matchId: "m1", opponentName: "Side B", playingHandicap: SIDE,
          grossTotal: 0, netTotal: 0, played: 0,
          cards: own
            ? [
                { playerId: "p1", playerName: "zz-Ann", handicap: 8, playing: 7, strokes: Array(18).fill(null) },
                { playerId: "p2", playerName: "zz-Bob", handicap: 10, playing: 9, strokes: Array(18).fill(null) },
              ]
            : [{ playerId: "", playerName: "", handicap: 0, strokes: Array(18).fill(null) }],
        }]} />,
    ),
  );

describe("Team score entry: Plays off", () => {
  it("a four-ball side says what each partner plays off, and not the side's figure", () => {
    const text = entryScreen("Four-Ball", true);
    expect(text).toContain("Plays off 7 · 9");
    expect(text).not.toContain(String(SIDE));
  });
  it("CONTROL: a shared-ball side keeps the side's figure", () => {
    expect(entryScreen("Scramble", false)).toContain(`Plays off ${SIDE}`);
  });
});

const printed = (sharedBall: boolean) => {
  const player = (name: string, side: string, playing: number) => ({ name, handicap: 8, sideName: side, playingHandicap: playing });
  return renderToStaticMarkup(
    <TeeSheetPrint
      groups={[{ name: "Group 1", startHole: 1, time: "", players: [player("zz-Ann", "Side A", 7), player("zz-Bob", "Side A", 9), player("zz-Cat", "Side B", 5), player("zz-Dot", "Side B", 6)] }]}
      clubName="zz club" courseName="zz course" dates="" roundLabel="R1"
      pars={PARS} strokeIndex={SI} holes={18}
      teamRound={{ format: sharedBall ? "Foursomes" : "Four-Ball", allowance: 85, teams: true, sharedBall, countBest: 1, matchPlay: false }}
      sides={["Side A", "Side B"].map((name) => ({ name, playingHandicap: SIDE, shots: Array(18).fill(0) }))}
    />,
  );
};

describe("Printed tee-sheet card: the side's figure", () => {
  it("a four-ball card prints each player's own figure and never the side's", () => {
    const html = printed(false);
    expect(html).not.toContain(String(SIDE));
    expect(textOf(html)).toContain("zz-Ann");
  });
  it("CONTROL: a shared-ball card prints the side's", () => {
    expect(printed(true)).toContain(String(SIDE));
  });
});

/**
 * IN A MATCH THE STROKES COME OFF THE LOWEST HANDICAP IN IT (Rules of
 * Handicapping 6.2, Appendix C). The dots on the card are `playing - low`, so the
 * words must say what the dots show: "Plays off 5 · 9" over a card where the 5
 * gets nothing and the 9 gets four contradicts itself.
 */
const matchEntry = (own: boolean) =>
  textOf(
    renderToStaticMarkup(
      <TeamEntryClient
        round="x" note="" holes={18} pars={PARS} strokeIndex={SI}
        teams={[{
          teamId: "t1", teamName: "Side A", matchId: "m1", opponentName: "Side B", playingHandicap: 12, matchLow: 5,
          grossTotal: 0, netTotal: 0, played: 0,
          cards: own
            ? [
                { playerId: "p1", playerName: "zz-Ann", handicap: 5, playing: 5, received: 0, strokes: Array(18).fill(null) },
                { playerId: "p2", playerName: "zz-Bob", handicap: 9, playing: 9, received: 4, strokes: Array(18).fill(null) },
              ]
            : [{ playerId: "", playerName: "", handicap: 0, received: 7, strokes: Array(18).fill(null) }],
        }]} />,
    ),
  );
describe("Team score entry in a MATCH says what the dots show", () => {
  it("a four-ball match: strokes received, off the low", () => {
    const text = matchEntry(true);
    expect(text).toContain("Gets 0 · 4 (off the low of 5)");
    expect(text).not.toContain("Plays off");
  });
  it("a shared-ball match keeps the side's own figure (Appendix C) in a tag of its own, and adds what the dots show", () => {
    const text = matchEntry(false);
    // The league spec reads "Plays off N" as a whole element, so the figure must not be merged into the other words.
    expect(text).toContain("Plays off 12");
    expect(text).toContain("Gets 7 (off the low of 5)");
    expect(text).not.toContain("Plays off 12 ·");
  });
});

describe("a partner who has left the field plays off nothing", () => {
  it("the Teams screen lists only who is still playing", () => {
    const text = textOf(
      renderToStaticMarkup(
        <TeamsClient
          rounds={[{ id: "r1", label: "R1", format: "Four-Ball" }]} activeRoundId="r1"
          format={formatOf("Four-Ball", false)}
          teams={[{
            id: "t1", name: "Side A", seed: 1, stageId: "r1", playingHandicap: SIDE,
            members: [
              { playerId: "p1", name: "zz-Ann", handicap: 8, position: 0, playing: 7 },
              { playerId: "p2", name: "zz-Bob", handicap: 10, position: 1, playing: 9, withdrawn: true },
            ],
          }]}
          problems={[]} unassigned={[]} matchCount={0} drawsMatches={false} />,
      ),
    );
    expect(text).toContain("Plays off 7");
    expect(text).not.toContain("7 · 9");
  });
});

describe("Teams screen: how a match is stroked", () => {
  const screen = (name: string, sharesOneCard: boolean, drawsMatches: boolean) =>
    textOf(
      renderToStaticMarkup(
        <TeamsClient
          rounds={[{ id: "r1", label: "R1", format: name }]} activeRoundId="r1"
          format={formatOf(name, sharesOneCard)} teams={[]} problems={[]} unassigned={[]} matchCount={0}
          drawsMatches={drawsMatches} />,
      ),
    );
  const LINE = "In a match, strokes come off the lowest of the four.";
  it("a four-ball match round says it", () => expect(screen("Four-Ball", false, true)).toContain(LINE));
  it("CONTROL: a medal four-ball does not", () => expect(screen("Four-Ball", false, false)).not.toContain(LINE));
  it("CONTROL: a shared-ball match round does not (sides, not four players)", () =>
    expect(screen("Foursomes", true, true)).not.toContain(LINE));
});

describe("Today (/me) asks the ROUND which board it is", () => {
  const src = readSource("src/app/(player)/me/page.tsx");
  it("uses boardKindForRound and never boardKind of the format", () => {
    expect(src).toMatch(/boardKindForRound\(/);
    expect(src).not.toMatch(/\bboardKind\(/);
  });
  it("gives a match player their side's match record, not a stroke place", () => {
    expect(src).toContain('"team-match"');
    expect(src).toContain("teamMatchBoard");
  });
});

/**
 * THE WORDS A PLAYER READS (e2e/player-words.spec.ts): no sentence of 12 words
 * or more, no block of 25. Counted as that spec counts them.
 */
describe("the words this change puts on a player's screen are short", () => {
  const words = (s: string) => s.split(" ").filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  const longest = (text: string) => Math.max(0, ...text.split(/(?<=[.!?])\s+/).map(words));
  const lines = [
    TEAM_MATCH_BOARD_NOTE,
    "Your side's match",
    "No match has finished yet.",
    "Won 10, halved 10, lost 10.",
    "Gets 10 · 10 (off the low of 10)",
    "Plays off 10 · 10",
  ];
  for (const line of lines) {
    it(`"${line}" is under 12 words`, () => {
      expect(line, "the line is missing").toBeTruthy();
      expect(longest(line)).toBeLessThan(12);
      expect(words(line)).toBeLessThan(25);
    });
  }
  /**
   * THE BLOCK THE SPEC MEASURES, and the type it is set in. Moving a four-ball
   * round robin onto the match table put that table's footnote on a player's
   * phone at 13px: a sentence is held to 14 (`e2e/player-words.spec.ts`). Every
   * paragraph of the table is read as the spec reads a block.
   */
  it("every paragraph of the match table meets the player-words rule: short, and 14px when it is a sentence", () => {
    const html = renderToStaticMarkup(
      <TeamMatchLeaderboard format="Four-Ball" system="match" rows={[{
        teamId: "t1", name: "Side A", members: ["Ann", "Bob"], memberIds: ["p1", "p2"],
        played: 1, wins: 1, halved: 0, losses: 0, holesDiff: 3, points: 2, rank: 1,
      }]} />,
    );
    const paragraphs = [...html.matchAll(/<p([^>]*)>(.*?)<\/p>/gs)].map(([, attrs, inner]) => [attrs, /style="([^"]*)"/.exec(attrs)?.[1], inner] as const);
    expect(paragraphs.length, "the table has paragraphs to read").toBeGreaterThan(0);
    const words = (s: string) => s.split(" ").filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
    for (const [, style, inner] of paragraphs) {
      expect(inner).toBeTruthy();
      const text = textOf(inner).replace(/\s+/g, " ").trim();
      expect(words(text), `block: ${text}`).toBeLessThan(25);
      expect(longest(text), `sentence: ${text}`).toBeLessThan(12);
      if (words(text) >= 5 && /[.!?]$/.test(text)) {
        const px = Number(/font-size:\s*(\d+(?:\.\d+)?)px/.exec(style ?? "")?.[1] ?? 16);
        expect(px, `a sentence is set at 14px or more: ${text}`).toBeGreaterThanOrEqual(14);
      }
    }
  });
  it("the board uses the constant, not a literal of its own", () => {
    expect(readSource("src/app/(player)/me/board/page.tsx")).toContain("TEAM_MATCH_BOARD_NOTE");
  });
});

describe("The player's board asks the ROUND which board it is", () => {
  const src = readSource("src/app/(player)/me/board/page.tsx");
  it("uses boardKindForRound, not boardKind of the format", () => {
    expect(src).toMatch(/boardKindForRound\(/);
    expect(src).not.toMatch(/\bboardKind\(/);
  });
  it("draws the matches for a round decided on its matches, as the console and /live do", () => {
    expect(src).toContain('"team-match"');
    expect(src).toContain("TeamMatchLeaderboard");
  });
});
