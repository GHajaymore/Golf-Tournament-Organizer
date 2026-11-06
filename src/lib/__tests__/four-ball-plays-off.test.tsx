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
