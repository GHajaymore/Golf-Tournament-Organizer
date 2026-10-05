import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TeamEntryClient, holeGroups, type TeamEntryRow } from "@/components/TeamEntryClient";

/**
 * A FOUR-BALL SCORED AT THE COURSE (walked at 393px, 2026-10-04): four
 * eighteen-column grids became one hole with all four players on it, and a
 * side handicap ("Plays off 37" over a 17 and a 24) that nothing on a
 * four-ball card uses came off it.
 */
const blank = () => new Array(18).fill(null) as (number | null)[];
const card = (playerId: string, playerName: string) => ({ playerId, playerName, handicap: 10, strokes: blank() });

const fourBall: TeamEntryRow[] = [
  { teamId: "ta", teamName: "zz-Ann & zz-Bob", matchId: "m1", opponentName: "zz-Cy & zz-Di", playingHandicap: 37, cards: [card("a", "zz-Ann"), card("b", "zz-Bob")], grossTotal: 0, netTotal: 0, played: 0 },
  { teamId: "tb", teamName: "zz-Cy & zz-Di", matchId: "m1", opponentName: "zz-Ann & zz-Bob", playingHandicap: 41, cards: [card("c", "zz-Cy"), card("d", "zz-Di")], grossTotal: 0, netTotal: 0, played: 0 },
];
const foursomes: TeamEntryRow[] = [
  { teamId: "ta", teamName: "zz-Ann & zz-Bob", matchId: "m1", opponentName: "zz-Cy & zz-Di", playingHandicap: 9, cards: [card("", "")], grossTotal: 0, netTotal: 0, played: 0 },
];

describe("holeGroups", () => {
  it("puts both sides of a match — all four players — on one hole", () => {
    const groups = holeGroups(fourBall);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows.map((r) => r.card.playerName)).toEqual(["zz-Ann", "zz-Bob", "zz-Cy", "zz-Di"]);
    expect(groups[0].label).toBe("zz-Ann & zz-Bob v zz-Cy & zz-Di");
  });

  it("keeps two matches apart, and a side with no opponent on its own", () => {
    const groups = holeGroups([
      ...fourBall,
      { ...fourBall[0], teamId: "tc", matchId: "m2", teamName: "zz-E & zz-F", opponentName: "" },
      { ...fourBall[0], teamId: "td", matchId: "", teamName: "zz-G & zz-H", opponentName: "" },
    ]);
    expect(groups.map((g) => g.rows.length)).toEqual([4, 2, 2]);
  });
});

describe("a side's one card is called by the side's name", () => {
  it("in full on the hole, never shortened as if it were a person", async () => {
    const { HoleByHoleCard } = await import("@/components/HoleByHoleCard");
    const side = "zz-Ann Walker & zz-Bob Partner";
    const html = renderToStaticMarkup(
      <HoleByHoleCard
        players={[
          { id: "s1", name: side, label: side },
          { id: "s2", name: "zz-Cy Third & zz-Di Fourth", label: "zz-Cy Third & zz-Di Fourth" },
        ]}
        cards={{ s1: blank(), s2: blank() }}
        pars={new Array(18).fill(4)}
        yards={[]}
        strokeIndex={[]}
        holes={18}
        onSet={() => {}}
      />,
    );
    // The VISIBLE label — the full name is also in each button's aria-label,
    // which is right and says nothing about what the scorer reads.
    expect(html).toMatch(/>zz-Ann Walker &amp; zz-Bob Partner</);
    // The control: the same name with no label is shortened like a person's.
    const unlabelled = renderToStaticMarkup(
      <HoleByHoleCard
        players={[
          { id: "s1", name: side },
          { id: "s2", name: "zz-Cy Third & zz-Di Fourth" },
        ]}
        cards={{ s1: blank(), s2: blank() }}
        pars={new Array(18).fill(4)}
        yards={[]}
        strokeIndex={[]}
        holes={18}
        onSet={() => {}}
      />,
    );
    expect(unlabelled).not.toMatch(/>zz-Ann Walker &amp; zz-Bob Partner</);
    expect(unlabelled).toMatch(/>zz-Ann</);
  });

  it("is what the team screen passes for a shared ball", async () => {
    const { readSource } = await import("./source");
    expect(readSource("src", "components", "TeamEntryClient.tsx")).toContain(
      "...(card.playerId ? {} : { label: team.teamName })",
    );
  });
});

describe("the side's handicap", () => {
  const render = (teams: TeamEntryRow[]) =>
    renderToStaticMarkup(
      <TeamEntryClient round="Round 1" teams={teams} pars={new Array(18).fill(4)} strokeIndex={[]} note="" holes={18} />,
    );

  it("is not on a four-ball, where every player plays off their own strokes", () => {
    expect(render(fourBall)).not.toContain("Plays off");
  });

  it("is on a side that plays one ball (the control)", () => {
    expect(render(foursomes)).toMatch(/Plays off (<!-- -->)?9/);
  });
});
