import { describe, it, expect } from "vitest";
import {
  cutLineOutcome,
  fieldEnteringRound,
  nextRoundFlights,
  reflightSurvivors,
  CUT_SCOPE_HELP,
  ROUND_CUT_HELP,
  QUALIFICATION_CUT_HELP,
  type CutLineRow,
  type CutRule,
  type RoundCutFields,
} from "../cut";
import type { Player } from "../types";

/**
 * More examples worked by hand for `domain/cut.ts` (J49, 2026-11-09): a decision's winners, the field
 * entering a round, the help sentences, and how survivors are flighted for the next round.
 */
const row = (id: string, rank: number, score: number): CutLineRow => ({ id, rank, score, groupId: null });
const rule = (count: number): CutRule => ({ scope: "overall", mode: "count", count, percent: 50 });

describe("a decision must name only players who were tied", () => {
  it("one winner from the tie and one stranger fills the two places but is not a decision", () => {
    // 70, then four level on 72, cut to 3: two places among b, c, d, e. "a" was not in the tie.
    const four = [row("a", 1, 70), row("b", 2, 72), row("c", 3, 72), row("d", 4, 72), row("e", 5, 72)];
    const out = cutLineOutcome(four, rule(3), "playoff", [{ tied: ["b", "c", "d", "e"], through: ["c", "a"] }]);
    expect(out.decided).toEqual([]);
    expect(out.undecided).toHaveLength(1);
  });
});

describe("the field entering a round, after every cut before it", () => {
  const cutOn = (over: Partial<RoundCutFields> = {}): RoundCutFields => ({
    cutEnabled: true, cutMode: "count", cutCount: 4, cutPercent: 50, cutScope: "overall", ...over,
  });
  const off = cutOn({ cutEnabled: false });

  it("an overall cut takes the whole field to the count, and forgets the flights", () => {
    // 16 in two flights of 8; round 2 cuts overall to 4. The flights are no longer known,
    // so a later per-flight cut is sized against the field (4), not against 8 + 8.
    expect(fieldEnteringRound([off, cutOn()], 1, { total: 16, flights: [8, 8] })).toBe(4);
    expect(fieldEnteringRound([off, cutOn(), cutOn({ cutScope: "perFlight", cutCount: 2 })], 2, { total: 16, flights: [8, 8] })).toBe(4);
  });

  it("a per-flight cut is the count out of each flight, added up", () => {
    // Flights of 8 and 3, top 4 each: 4 + 3.
    expect(fieldEnteringRound([off, cutOn({ cutScope: "perFlight" })], 1, { total: 11, flights: [8, 3] })).toBe(7);
    // And a second per-flight cut works on what is left of each: top 2 of (4, 3) = 2 + 2.
    expect(
      fieldEnteringRound([off, cutOn({ cutScope: "perFlight" }), cutOn({ cutScope: "perFlight", cutCount: 2 })], 2, { total: 11, flights: [8, 3] }),
    ).toBe(4);
  });

  it("a per-flight cut with the flights not known leaves the field as it is (too big, never too small)", () => {
    expect(fieldEnteringRound([off, cutOn({ cutScope: "perFlight", cutCount: 2 })], 1, { total: 10 })).toBe(10);
    // Flights of nothing are no flights.
    expect(fieldEnteringRound([off, cutOn({ cutScope: "perFlight", cutCount: 2 })], 1, { total: 10, flights: [0, 0] })).toBe(10);
    // An empty flight is dropped, the other is cut: top 2 of 8 = 2.
    expect(fieldEnteringRound([off, cutOn({ cutScope: "perFlight", cutCount: 2 })], 1, { total: 8, flights: [0, 8] })).toBe(2);
  });

  it("an overall cut after tracked flights is still an overall cut", () => {
    expect(fieldEnteringRound([off, cutOn({ cutCount: 3 })], 1, { total: 16, flights: [8, 8] })).toBe(3);
  });

  it("only the cuts BEFORE the asked round apply, and round one is never cut", () => {
    const rounds = [cutOn({ cutCount: 1 }), cutOn({ cutCount: 6 }), cutOn({ cutCount: 2 })];
    expect(fieldEnteringRound(rounds, 0, { total: 20 })).toBe(20);
    expect(fieldEnteringRound(rounds, 1, { total: 20 })).toBe(6);
    expect(fieldEnteringRound(rounds, 2, { total: 20 })).toBe(2);
    // A cut on a round that is switched off does nothing.
    expect(fieldEnteringRound([off, off, cutOn({ cutCount: 2 })], 1, { total: 20 })).toBe(20);
  });

  it("an index past the last round applies every cut once and no more", () => {
    expect(fieldEnteringRound([off, cutOn({ cutCount: 6 })], 9, { total: 20 })).toBe(6);
  });

  it("a negative field is no field", () => {
    expect(fieldEnteringRound([off], 0, { total: -5 })).toBe(0);
  });
});

describe("the help sentences say what they are for", () => {
  it("each names the thing it explains", () => {
    expect(CUT_SCOPE_HELP).toContain("Overall");
    expect(CUT_SCOPE_HELP).toContain("Per flight");
    expect(ROUND_CUT_HELP).toContain("play-off");
    expect(ROUND_CUT_HELP).toContain("countback");
    expect(QUALIFICATION_CUT_HELP).toContain("knockout bracket");
  });
});

describe("the next round's flights", () => {
  const p = (id: string, handicap: number, seed: number, groupId?: string): Player => ({
    id, name: id, handicap, seed, ...(groupId ? { groupId } : {}),
  });

  it("a per-flight cut keeps each old flight, unnamed, and leaves out a player who was never in one", () => {
    const list = [p("a1", 2, 1, "A"), p("a2", 5, 2, "A"), p("b1", 6, 3, "B"), p("b2", 9, 4, "B"), p("loose", 4, 5)];
    expect(nextRoundFlights(list, "perFlight", 8)).toEqual([
      { keepGroupId: "A", name: "", playerIds: ["a1", "a2"] },
      { keepGroupId: "B", name: "", playerIds: ["b1", "b2"] },
    ]);
  });

  it("balanced flights: handicaps 2, 5, 8, 11 in two flights make 2+11 and 5+8, level at 13 each", () => {
    const four = [p("h2", 2, 1), p("h5", 5, 2), p("h8", 8, 3), p("h11", 11, 4)];
    const flights = reflightSurvivors(four, 2);
    expect(flights).toHaveLength(2);
    const hcp: Record<string, number> = { h2: 2, h5: 5, h8: 8, h11: 11 };
    for (const f of flights) expect(f.playerIds.reduce((s, id) => s + hcp[id], 0)).toBe(13);
  });
});
