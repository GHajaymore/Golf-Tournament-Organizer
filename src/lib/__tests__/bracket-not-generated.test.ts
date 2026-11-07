import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tournamentTerms } from "../rules";
import { cutAfterRound } from "../domain/cut-ready";
import { STAGE_TYPE_INFO, seededFromQualifiers } from "../stage-types";
import type { TiebreakerKey } from "../domain/types";
import { StagesClient, type StageView } from "@/components/StagesClient";

// The Rounds screen is rendered below (the sheet's screen-side twin). Server
// actions only sit behind its buttons, so a no-op stands in for each — as in
// `render.test.tsx`; `then` stays undefined so the module is not a thenable.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
  redirect: vi.fn(),
  notFound: vi.fn(),
}));
function actionModule() {
  return new Proxy({}, { get: (_t, key) => (typeof key === "string" && key !== "then" ? async () => ({ ok: true }) : undefined) }) as Record<
    string,
    unknown
  >;
}
vi.mock("@/app/actions/series", actionModule);
vi.mock("@/app/actions/courses", actionModule);
vi.mock("@/app/actions/teams", actionModule);
vi.mock("@/app/actions/organization", actionModule);
vi.mock("@/app/actions/tournament", actionModule);
vi.mock("@/app/actions/event", actionModule);
vi.mock("@/app/actions/stages", actionModule);
vi.mock("@/app/actions/roster", actionModule);
vi.mock("@/app/actions/messaging", actionModule);
vi.mock("@/app/actions/attendance", actionModule);

/**
 * A bracket is seeded from the event's qualifiers, and a round cut on one does
 * nothing at all.
 *
 * It was still offered, still saved, and still PUBLISHED: the rules sheet a
 * club hands to its players read "Top 8 advance to the next round" while the
 * draw seeded two per flight from `qualifyPerGroup`. The players were given a
 * description of a competition they were not in.
 *
 * AND THE CUT PRINTED IS THE ONE MADE AFTER THE ROUND BEING PLAYED (2026-10-14).
 * A cut belongs to the round it feeds, and the sheet read the played round's
 * own setting: no cut at all while round 1 was played, and a cut promised once
 * round 2 had begun — already made. Nor did it say "in each flight" or "and
 * ties". So these build the TOURNAMENT's rounds and ask `cutAfterRound`, which
 * is what both rules screens hand the sheet.
 */

const terms = (over: Partial<Parameters<typeof tournamentTerms>[0]> = {}) =>
  tournamentTerms({
    format: "Match Play",
    type: "Round Robin",
    holes: 18,
    scoringBasis: "gross",
    handicapAllowance: 100,
    countBest: 0,
    tiebreakers: [] as TiebreakerKey[],
    cutAfter: null,
    carryForwardEnabled: false,
    carryForwardPct: 0,
    ...over,
  });

type Round = Parameters<typeof cutAfterRound>[0][number];
const round = (id: string, over: Partial<Round> = {}): Round => ({
  id,
  type: "Round Robin",
  format: "Match Play",
  cutEnabled: false,
  cutScope: "overall",
  cutMode: "count",
  cutCount: 8,
  cutPercent: 50,
  cutTies: "ties",
  ...over,
});
/** The Cut line on the sheet for round `id` of these rounds. */
const cutLine = (rounds: Round[], id: string) => {
  const r = rounds.find((x) => x.id === id)!;
  return terms({ type: r.type, format: r.format, cutAfter: cutAfterRound(rounds, id) }).find((t) => t.label === "Cut")?.value;
};

describe("the published rules sheet only prints a cut the engine applies", () => {
  it("prints the cut on the round it is made AFTER, not the round it feeds", () => {
    const rounds = [round("r1"), round("r2", { cutEnabled: true })];
    // "and ties": a round robin's cut takes the committee's tie rule, whose
    // default is "the leading N and ties" (J31; Committee Procedures 5A(6)).
    expect(cutLine(rounds, "r1"), "round 1 is played for a place in round 2").toBe("Top 8 and ties advance to the next round");
    expect(cutLine(rounds, "r2"), "round 2's cut has been made: there is no cut after it").toBeUndefined();
  });

  it("says a stroke cut takes ties, and a per-flight one takes them from each flight", () => {
    const medal = { type: "Stroke Play Round", format: "Stroke Play" };
    const rounds = [round("r1", medal), round("r2", { ...medal, cutEnabled: true, cutScope: "perFlight", cutMode: "percent", cutPercent: 25 })];
    expect(cutLine(rounds, "r1")).toBe("Top 25% in each flight and ties advance to the next round");
    // And a round robin's, since J31: the same tie rule, on its table.
    expect(cutLine([round("r1"), round("r2", { cutEnabled: true, cutScope: "perFlight" })], "r1")).toBe(
      "Top 8 in each flight and ties advance to the next round",
    );
    // CONTROL: a cut out of a round that settles no tie of its own (a team
    // medal, cut by neither engine's line) promises no ties.
    expect(
      cutLine([round("r1", { type: "Stroke Play Round", format: "Scramble" }), round("r2", { cutEnabled: true, cutScope: "perFlight" })], "r1"),
    ).toBe("Top 8 in each flight advance to the next round");
  });

  it("prints a round robin's tie method in the table's words, not the card's (J31)", () => {
    const cut = (cutTies: string) => cutLine([round("r1"), round("r2", { cutEnabled: true, cutTies })], "r1");
    expect(cut("playoff")).toBe("Top 8 advance to the next round. A tie for the last place is decided by a play-off");
    expect(cut("countback")).toBe(
      "Top 8 advance to the next round. A tie for the last place is decided by the table's tie-breaks, in the order set for the round, then by lot",
    );
    // CONTROL: the card's countback names holes a table does not have.
    expect(cut("countback")).not.toMatch(/last 9/);
  });

  it("prints the committee's method for a tie when it is not 'and ties' (2026-10-23)", () => {
    const medal = { type: "Stroke Play Round", format: "Stroke Play" };
    const cut = (cutTies: string) => cutLine([round("r1", medal), round("r2", { ...medal, cutEnabled: true, cutTies })], "r1");
    expect(cut("playoff")).toBe("Top 8 advance to the next round. A tie for the last place is decided by a play-off");
    expect(cut("countback")).toMatch(/^Top 8 advance to the next round\. A tie for the last place is decided by countback/);
    // CONTROL: the default says "and ties" and nothing more.
    expect(cut("ties")).toBe("Top 8 and ties advance to the next round");
  });

  it("prints no cut for a bracket, whose field is the qualifiers", () => {
    // The exact sentence a club was publishing against a draw that ignored it.
    expect(cutLine([round("r1"), round("r2", { type: "Bracket Stage", cutEnabled: true })], "r1")).toBeUndefined();
  });

  it("still prints everything else about a bracket round", () => {
    // The point is one wrong line, not silencing the sheet.
    const out = terms({ type: "Bracket Stage", tiebreakers: ["lower-handicap"] as TiebreakerKey[] });
    expect(out.length).toBeGreaterThan(0);
    expect(out.find((t) => t.label === "Ties")).toBeDefined();
  });

  it("prints a percent cut before an ordinary round and not before a bracket", () => {
    expect(cutLine([round("r1"), round("r2", { cutEnabled: true, cutMode: "percent" })], "r1")).toBe(
      "Top 50% and ties advance to the next round",
    );
    expect(
      cutLine([round("r1"), round("r2", { type: "Bracket Stage", cutEnabled: true, cutMode: "percent" })], "r1"),
    ).toBeUndefined();
  });
});

describe("which round types take their field from qualification", () => {
  it("is the bracket, and only the bracket", () => {
    const seeded = STAGE_TYPE_INFO.filter((t) => t.seededFromQualifiers).map((t) => t.key);
    expect(seeded).toEqual(["Bracket Stage"]);
  });

  it("leaves an unknown type on the ordinary path", () => {
    // False rather than true for anything unrecognised: a type nobody has
    // taught the app about should not quietly exempt itself from the cut.
    expect(seededFromQualifiers("Something New")).toBe(false);
    expect(seededFromQualifiers("")).toBe(false);
  });

  it("agrees with the type table", () => {
    for (const t of STAGE_TYPE_INFO) {
      expect(seededFromQualifiers(t.key), t.key).toBe(t.seededFromQualifiers);
    }
  });
});

describe("the published rules sheet breaks ties the way the round is scored", () => {
  /**
   * THE CHAIN IN `tiebreakers` IS MATCH PLAY, AND ONLY MATCH PLAY.
   *
   * Every key in it is a match concept — head-to-head, most wins, holes-won
   * ratio, fewest holes lost — and `computeStandings` is the only thing that
   * applies them. A STROKE round is separated by `stroke-countback.ts`, which
   * is not configurable and never reads that list.
   *
   * So a medal's published terms stated rules the app does not use and could
   * not: "head-to-head result" between two players who are not playing each
   * other is a category error, not a tiebreak. Read off `/me/rules` on the
   * seeded Demo Cup on 2026-09-12, on a Stroke Play Round with seven cards in.
   *
   * This is the sheet a club publishes and the screen a player checks before
   * signing, and both rules screens build it here — so deciding it here is
   * what stops the two of them disagreeing.
   */
  const CHAIN: TiebreakerKey[] = ["head-to-head", "fewest-holes-lost"];

  it("prints the countback for a stroke round, not the match chain", () => {
    const ties = terms({
      type: "Stroke Play Round",
      format: "Stroke Play",
      tiebreakers: CHAIN,
    }).find((t) => t.label === "Ties");
    expect(ties, "a medal published no tiebreak at all").toBeTruthy();
    expect(ties!.value).toMatch(/^Countback: last 9, 6 and 3 holes, then the final hole/);
    // And specifically NOT the match chain, which is the half that was wrong.
    expect(ties!.value).not.toMatch(/[Hh]ead-to-head/);
  });

  it("starts the ladder at the last six on a nine-hole round", () => {
    /**
     * Quoted from `stroke-countback.ts`, which says why: "a 'last nine' of a
     * nine-hole round is the whole round, which is the number that was already
     * equal". A sheet that published a step the engine skips would be wrong in
     * the other direction.
     */
    const ties = terms({
      type: "Stroke Play Round",
      format: "Stroke Play",
      holes: 9,
      tiebreakers: CHAIN,
    }).find((t) => t.label === "Ties");
    expect(ties!.value).toMatch(/^Countback: last 6 and 3 holes, then the final hole/);
    expect(ties!.value).not.toMatch(/last 9/);
  });

  it("calls a ROUND ROBIN SET TO STROKE PLAY a medal here too", () => {
    // The legacy shape, which is head-to-head by type and scored off cards in
    // fact. Its ties are settled by the countback like any other card.
    const ties = terms({
      type: "Round Robin",
      format: "Stroke Play",
      tiebreakers: CHAIN,
    }).find((t) => t.label === "Ties");
    expect(ties!.value).toMatch(/^Countback:/);
  });

  it("still prints the configured chain for a real match", () => {
    /**
     * THE CONTROL, and it is the half a fix keyed on the wrong thing would
     * have broken: a match IS decided by this chain, the committee chose it,
     * and it has to be published under Committee Procedures 5A.
     */
    const ties = terms({ type: "Round Robin", format: "Match Play", tiebreakers: CHAIN }).find(
      (t) => t.label === "Ties",
    );
    expect(ties!.value).toBe("Head-to-head result, then Fewest holes lost");
    expect(ties!.rule).toBe("decidingTies");
  });

  it("still publishes a tiebreak on a medal where the old sheet published none", () => {
    // With no chain configured the old code printed nothing at all, so a medal
    // said how it was scored and never how a tie was settled — and a countback
    // was running regardless.
    const ties = terms({
      type: "Stroke Play Round",
      format: "Stroke Play",
      tiebreakers: [] as TiebreakerKey[],
    }).find((t) => t.label === "Ties");
    expect(ties, "a medal with no configured chain published no tiebreak").toBeTruthy();
    expect(ties!.value).toMatch(/^Countback:/);
  });
});

/**
 * THE SCREEN OFFERS A TIE METHOD EXACTLY WHERE THE SHEET PRINTS ONE (J31 review,
 * 2026-11-07) — the screen-side twin of "a scramble medal promises no ties".
 *
 * Rounds & formats sets how a tie at the cut line is settled; the rules sheet
 * prints it (`cutAfterRound`); the cut is made by the engine `cutLineKindOf`
 * names. The control was given the choice unconditionally and fell back to the
 * table's words where there is no line of either kind, so a cut no engine
 * settles a tie on would be offered a Play-off, store it, and print nothing.
 * Here, for every shape: the choice is on screen if and only if the sheet
 * prints a tie method, and in the same terms — points and the table's
 * tie-breaks for a round robin's, "that score" for a card's.
 */
describe("the Rounds screen offers a tie method exactly where the sheet prints one", () => {
  const view = (id: string, position: number, s: Partial<StageView>): StageView => ({
    id, position, type: "Round Robin", description: "", format: "Match Play",
    closed: false,
    holes: 18, playedOn: "", deadline: "", scoringBasis: "gross", scoreInput: "", matchKeptBy: "", carryEnabled: false, carryPct: 0,
    carryAsked: true, cutEnabled: false, cutMode: "count", cutCount: 8, cutPercent: 50, cutScope: "overall", cutTies: "ties", deadlineOverride: null, optDeadline: "", attendance: null,
    matchCount: 0, courseId: null, nine: "full", teamScoring: null, allowance: null, handicaps: [], ...s,
  });
  const base = {
    today: "2026-11-07",
    rrMatchesPerPlayer: 3,
    scoring: { winPts: 1, tiePts: 0.5, lossPts: 0, holeRatioPts: 0, bonusPts: 0, maxPerMatch: 0 },
    tiebreakers: [] as never[],
    qual: { mode: "overall", perFlight: 2, overall: 8 },
    confirmedCount: 32,
    chainsRounds: true,
  };
  const RR = { type: "Round Robin", format: "Match Play" };
  const MEDAL = { type: "Stroke Play Round", format: "Stroke Play" };
  const SCRAMBLE = { type: "Stroke Play Round", format: "Scramble" };
  const RR_MEDAL = { type: "Round Robin", format: "Stroke Play" };
  const shapes: [string, typeof RR, typeof RR][] = [
    ["round robin → round robin", RR, RR],
    ["round robin → medal", RR, MEDAL],
    ["round robin at stroke play → medal", RR_MEDAL, MEDAL],
    ["medal → medal", MEDAL, MEDAL],
    ["a scramble medal → round robin", SCRAMBLE, RR],
    ["a scramble medal → medal", SCRAMBLE, MEDAL],
    ["medal → round robin", MEDAL, RR],
  ];
  for (const [name, first, second] of shapes) {
    it(name, () => {
      const stages = [view("r1", 0, first), view("r2", 1, { ...second, cutEnabled: true, cutTies: "playoff" })];
      const html = renderToStaticMarkup(createElement(StagesClient, { ...base, stages }));
      const sheet = cutAfterRound(stages, "r1");
      const offered = /\/>Play-off<\/label>/.test(html);
      expect(offered, `${name}: the screen offers a tie method — the sheet prints ${sheet?.decidedOn ?? "none"}`).toBe(
        !!sheet?.decidedOn,
      );
      if (sheet?.decidedOn === "table") expect(html, name).toContain("the players level on points play off");
      if (sheet?.decidedOn === "card") expect(html, name).toContain("the players level on that score play off");
    });
  }
});
