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
vi.mock("@/app/actions/league", actionModule);

import { TeamsClient } from "@/components/TeamsClient";
import { PairBuilder } from "@/components/PairBuilder";
import { LeagueSettings } from "@/components/LeagueSettings";
import { PlayoffDecision } from "@/components/PlayoffDecision";

/**
 * A LEAGUE'S SIDES HAVE ONE DOOR, THE LEAGUE SECTION (B115b).
 *
 * A pair is a `Team` on the week with `clubGroupId` set, and the generic side controls (Remove team, a member's remove, Add
 * player) wrote the same rows with their own lock and none of the club-roster rule: padlocked while Withdraw was open, and
 * open to put another club's player into a pair. The actions refuse a league now (`LEAGUE_SIDES_REFUSAL`), so the cards
 * draw read-only: names, the plays-off figures and members, and no control that would be refused.
 */
const textOf = (html: string) => html.replace(/<[^>]*>/g, "");

const FORMAT = {
  name: "Four-Ball", desc: "", min: 2, max: 2, sharesOneCard: false, allowance: 85, recommendedAllowance: 85,
  allowanceOverridden: false, allowanceIsConvention: false,
  shares: null, recommendedShares: null, sharesOverridden: false,
  countBest: null, countBestOverridden: false, maxCountBest: 2,
};
const teamsScreen = (league: boolean) =>
  renderToStaticMarkup(
    <TeamsClient matchesHere={false} teeTimesHref="/foursomes?round=r1"
      rounds={[{ id: "r1", label: "R1", format: "Four-Ball" }]} activeRoundId="r1"
      format={FORMAT}
      teams={[{
        id: "t1", name: "zz-Side A", seed: 1, stageId: "r1", playingHandicap: 8,
        members: [
          { playerId: "p1", name: "zz-Ann", handicap: 8, position: 0, playing: 7 },
          { playerId: "p2", name: "zz-Bob", handicap: 10, position: 1, playing: 9 },
        ],
      }]}
      problems={[]} unassigned={[{ id: "p3", name: "zz-Cy", handicap: 12 }]} matchCount={0} drawsMatches={false} league={league} />,
  );

describe("Teams & pairs: a league's side cards are read-only", () => {
  it("a league draws no Remove team, no member remove and no Add player, and keeps the names and figures", () => {
    const html = teamsScreen(true);
    expect(html).not.toContain("Remove team");
    expect(html).not.toContain("Remove zz-Ann");
    expect(html).not.toContain("Add player");
    expect(textOf(html)).toContain("zz-Ann");
    expect(textOf(html)).toContain("Plays off 7 · 9");
    expect(textOf(html)).toContain("nominates or withdraws its pairs, and the week is drawn, in the League section below");
  });

  it("CONTROL: without `league` the same card draws all three", () => {
    const html = teamsScreen(false);
    expect(html).toContain("Remove team");
    expect(html).toContain("Remove zz-Ann");
    expect(html).toContain("Add player");
  });
});

describe("the League section's controls shut when the tournament is completed", () => {
  const CLUB = {
    clubId: "c1", clubName: "zz-Club", captainName: null, expected: 2,
    pairs: [{ id: "pair1", name: "zz-Ann / zz-Bob" }],
    roster: [{ playerId: "p3", name: "zz-Cy", handicap: 12, available: true, answered: true, pairId: null }],
  };
  // The mark is the padlock button; a shut control carries `disabled`.
  const mark = 'aria-label="Locked';

  it("PairBuilder: Withdraw and Nominate are disabled and marked when locked, live otherwise", () => {
    const shut = renderToStaticMarkup(<PairBuilder club={CLUB as never} stageId="s1" locked />);
    const open = renderToStaticMarkup(<PairBuilder club={CLUB as never} stageId="s1" locked={false} />);
    expect(shut).toContain(mark);
    expect(shut).toMatch(/<button[^>]*disabled=""[^>]*>Withdraw<\/button>/);
    expect(open).not.toContain(mark);
    expect(open).not.toMatch(/<button[^>]*disabled=""[^>]*>Withdraw<\/button>/);
  });

  it("LeagueSettings: Save is disabled and marked when locked, live otherwise", () => {
    const props = { points: "match" as const, matchBonus: 2, pairs: 2, playoffs: 0, canEdit: true };
    const shut = renderToStaticMarkup(<LeagueSettings {...props} locked />);
    const open = renderToStaticMarkup(<LeagueSettings {...props} locked={false} />);
    expect(shut).toContain(mark);
    expect(shut).toMatch(/<button[^>]*disabled=""[^>]*>Save league settings<\/button>/);
    expect(open).not.toContain(mark);
    expect(open).not.toMatch(/<button[^>]*disabled=""[^>]*>Save league settings<\/button>/);
  });

  it("PlayoffDecision: the decision is disabled and marked when locked, live otherwise", () => {
    const meetings = [{ stageId: "s1", roundName: "Final", clubA: "a", clubB: "b", clubAName: "zz-A", clubBName: "zz-B", level: true, decided: null }];
    const shut = renderToStaticMarkup(<PlayoffDecision meetings={meetings} locked />);
    const open = renderToStaticMarkup(<PlayoffDecision meetings={meetings} locked={false} />);
    expect(shut).toContain(mark);
    expect(shut).toMatch(/<button[^>]*disabled=""[^>]*>.*Record the play-off hole<\/button>/);
    expect(open).not.toContain(mark);
    expect(open).not.toMatch(/<button[^>]*disabled=""[^>]*>.*Record the play-off hole<\/button>/);
  });
});
