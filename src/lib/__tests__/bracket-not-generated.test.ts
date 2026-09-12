import { describe, it, expect } from "vitest";
import { tournamentTerms } from "../rules";
import { STAGE_TYPE_INFO, seededFromQualifiers } from "../stage-types";
import type { TiebreakerKey } from "../domain/types";

/**
 * A bracket is seeded from the event's qualifiers, and a round cut on one does
 * nothing at all.
 *
 * It was still offered, still saved, and still PUBLISHED: the rules sheet a
 * club hands to its players read "Top 8 advance to the next round" while the
 * draw seeded two per flight from `qualifyPerGroup`. The players were given a
 * description of a competition they were not in.
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
    cutEnabled: true,
    cutMode: "count",
    cutCount: 8,
    cutPercent: 50,
    carryForwardEnabled: false,
    carryForwardPct: 0,
    ...over,
  });

describe("the published rules sheet only prints a cut the engine applies", () => {
  it("prints the cut for a round that is decided by one", () => {
    const cut = terms().find((t) => t.label === "Cut");
    expect(cut?.value).toBe("Top 8 advance to the next round");
  });

  it("prints no cut for a bracket, whose field is the qualifiers", () => {
    // The exact sentence a club was publishing against a draw that ignored it.
    expect(terms({ type: "Bracket Stage" }).find((t) => t.label === "Cut")).toBeUndefined();
  });

  it("still prints everything else about a bracket round", () => {
    // The point is one wrong line, not silencing the sheet.
    const out = terms({ type: "Bracket Stage", tiebreakers: ["lower-handicap"] as TiebreakerKey[] });
    expect(out.length).toBeGreaterThan(0);
    expect(out.find((t) => t.label === "Ties")).toBeDefined();
  });

  it("prints a percent cut on an ordinary round and not on a bracket", () => {
    expect(terms({ cutMode: "percent" }).find((t) => t.label === "Cut")?.value).toBe(
      "Top 50% advance to the next round",
    );
    expect(
      terms({ cutMode: "percent", type: "Bracket Stage" }).find((t) => t.label === "Cut"),
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
    expect(ties!.value).toMatch(/^Countback: last 9 holes, then last 6, then last 3/);
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
    expect(ties!.value).toMatch(/^Countback: last 6 holes, then last 3, then the final hole/);
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
