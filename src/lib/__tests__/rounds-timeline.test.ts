import { describe, it, expect } from "vitest";
import { effectLine, parsPlayed, roundNeeds, sheetFacts, type NeedsInput } from "@/lib/rounds-timeline";

/**
 * ROUNDS & FORMATS STEP 2 ("Course day", behind `?view=timeline`).
 *
 * What the timeline says about a round is read from what is stored, and the "Needs you" strip
 * guides in the order a round is set up: course, date, then tee times (Ajay, 2 Nov: "ease of using
 * the configuration and guided one").
 */
const round = (over: Partial<NeedsInput> = {}): NeedsInput => ({
  id: "r1", label: "Round 1", playing: true, done: false, playedOn: "2026-11-07",
  courseName: "Braid Hollow", hasCard: true, hasSheet: true, ...over,
});

describe("roundNeeds", () => {
  it("lists nothing for a round that is set up", () => {
    expect(roundNeeds([round()], 48)).toEqual([]);
  });

  it("guides in the order a round is set up — course, date, tee times — round by round", () => {
    const needs = roundNeeds(
      [round({ id: "r1", label: "Round 1", hasSheet: false }), round({ id: "r2", label: "Final", courseName: "", playedOn: "", hasSheet: false })],
      48,
    );
    expect(needs.map((n) => `${n.round} ${n.missing}`)).toEqual([
      "Round 1 has no tee times",
      "Final has no course",
      "Final has no date",
      "Final has no tee times",
    ]);
    // The consequence is in the player's terms, and the fix is named.
    expect(needs[0]).toMatchObject({ consequence: "players cannot see when they start", fix: "tee-sheet" });
    expect(needs[2]).toMatchObject({ consequence: "players cannot see when they play", fix: "round" });
  });

  it("asks for tee times only once somebody has entered, and never of a cut, a bracket or a played round", () => {
    expect(roundNeeds([round({ hasSheet: false })], 0)).toEqual([]);
    expect(roundNeeds([round({ playing: false, courseName: "", playedOn: "" })], 48)).toEqual([]);
    expect(roundNeeds([round({ done: true, playedOn: "" })], 48)).toEqual([]);
  });

  it("a course with no card is its own gap, said before the date", () => {
    expect(roundNeeds([round({ hasCard: false, playedOn: "" })], 0).map((n) => n.missing)).toEqual(["has no course card", "has no date"]);
  });
});

describe("parsPlayed", () => {
  const card = [4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4];
  it("gives the eighteen, or the nine the round names", () => {
    expect(parsPlayed(card, 18, "full")).toHaveLength(18);
    expect(parsPlayed(card, 9, "front")).toEqual(card.slice(0, 9));
    expect(parsPlayed(card, 9, "back")).toEqual(card.slice(9));
  });
  it("a card with a missing par is no card", () => {
    expect(parsPlayed([4, 0, 3], 18, "full")).toEqual([]);
    expect(parsPlayed([], 18, "full")).toEqual([]);
  });
});

describe("effectLine — the effect, before it happens", () => {
  const sheet = sheetFacts({
    savedAt: "", startType: "tee",
    groups: Array.from({ length: 12 }, (_, i) => ({ name: `G${i + 1}`, startHole: 1, time: `${8 + Math.floor((i * 10) / 60)}:${String((i * 10) % 60).padStart(2, "0")}`, playerIds: ["a", "b", "c", "d"] })),
  });
  it("names players, groups and times from the SAVED sheet", () => {
    expect(effectLine({ holes: 18, basis: "net 95%", facts: { ...sheet, players: 48 } })).toEqual({
      setting: "18 holes, net 95%",
      outcome: "48 players in 12 groups of 4 from 8:00; last group off 9:50",
    });
  });
  it("says there are no tee times rather than inventing groups", () => {
    expect(effectLine({ holes: 18, basis: "gross", facts: { ...sheetFacts(null), players: 48 } }).outcome).toBe("48 players; no tee times yet");
    expect(effectLine({ holes: 9, basis: "", facts: { ...sheetFacts(null), players: 0 } })).toEqual({ setting: "9 holes", outcome: "nobody entered yet" });
  });
  it("a sheet of empty groups is no sheet", () => {
    expect(sheetFacts({ savedAt: "", startType: "tee", groups: [{ name: "G1", startHole: 1, time: "8:00", playerIds: [] }] }).hasSheet).toBe(false);
  });
});
