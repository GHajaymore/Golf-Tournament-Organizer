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
