import { describe, it, expect } from "vitest";
import { effectLine, parsPlayed, sheetFacts } from "@/lib/rounds-timeline";

/**
 * ROUNDS & FORMATS STEP 2 ("Course day", behind `?view=timeline`).
 *
 * The golf facts the timeline says about a round are read from what is stored. What the round
 * still NEEDS is the state machine's (`rounds[i].needs`) and is tested with the machine, in
 * `domain/__tests__/timeline-step.test.ts` (PR 5c, J16).
 */
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
