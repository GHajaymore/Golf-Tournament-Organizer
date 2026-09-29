import { describe, expect, it } from "vitest";
import { cupMatchState, cupPoints, cupTally, cupVerdict, pointsToWin, type CupMatchInput } from "../cup";
import type { HoleResult } from "../types";

/**
 * THE TEAM CUP'S ARITHMETIC, asserted against how a golfer scores a Ryder Cup:
 * a point a match, ½ each for a halve, a match decided when one side leads by
 * more holes than remain (Rule 3.2a(3)), and the cup won at the target.
 */
const card = (s: string): HoleResult[] =>
  [...s.padEnd(18, "-")].map((c) => (c === "-" ? null : (c as HoleResult)));
const m = (s: string, conceded: CupMatchInput["conceded"] = null): CupMatchInput => ({ holes: card(s), conceded });

describe("one match", () => {
  it("is decided the moment the lead exceeds the holes left (Rule 3.2a(3))", () => {
    // A wins 1-4 then halves: four up after the 15th with three to play is
    // over there — 4&3 — even though the card carries a 16th.
    const s = cupMatchState(m("AAAA" + "H".repeat(12)));
    expect(s).toMatchObject({ points: [1, 0], status: "final", leader: "A" });
    expect(s.label).toBe("4&3");
  });

  it("a halved match is half a point each", () => {
    const s = cupMatchState(m("AB" + "H".repeat(16)));
    expect(s).toMatchObject({ points: [0.5, 0.5], status: "final", label: "A/S", leader: null });
  });

  it("in play: '2 UP thru 14' for the side in front, and no points yet", () => {
    const s = cupMatchState(m("BB" + "H".repeat(12)));
    expect(s).toMatchObject({ points: [0, 0], status: "in-play", label: "2 UP thru 14", leader: "B" });
  });

  it("level in play reads A/S thru n", () => {
    expect(cupMatchState(m("AB" + "H".repeat(7))).label).toBe("A/S thru 9");
  });

  it("a conceded match is a full point to the other side", () => {
    expect(cupMatchState(m("AA", "A"))).toMatchObject({ points: [0, 1], status: "final", leader: "B" });
  });

  it("CONTROL: an empty card is not started and worth nothing — not a halve", () => {
    expect(cupMatchState(m(""))).toMatchObject({ points: [0, 0], status: "not-started", label: "" });
  });
});

describe("the cup", () => {
  it("adds decided matches only — a lead is not a point", () => {
    const t = cupTally([m("AAAA" + "H".repeat(12)), m("AB" + "H".repeat(16)), m("BB")]);
    expect(t).toEqual({ a: 1.5, b: 0.5, total: 3, decided: 2, inPlay: 1, notStarted: 0 });
  });

  it("the target is more than half the points on offer unless the organizer sets one", () => {
    expect(pointsToWin(0, 28)).toBe(14.5);
    expect(pointsToWin(0, 12)).toBe(6.5);
    expect(pointsToWin(0, 5)).toBe(3);
    expect(pointsToWin(10, 28)).toBe(10);
    expect(pointsToWin(0, 0)).toBe(0);
  });

  it("is won the moment a team reaches the target, with matches still out", () => {
    const t = { a: 14.5, b: 9, total: 28, decided: 24, inPlay: 4, notStarted: 0 };
    expect(cupVerdict(t, 0, null)).toEqual({ kind: "won", by: "A" });
  });

  it("a holder retains on a tie; without one it is shared", () => {
    const t = { a: 14, b: 14, total: 28, decided: 28, inPlay: 0, notStarted: 0 };
    expect(cupVerdict(t, 0, "B")).toEqual({ kind: "retained", by: "B" });
    expect(cupVerdict(t, 0, null)).toEqual({ kind: "tied" });
  });

  it("while open, says what each team still needs", () => {
    const t = { a: 8.5, b: 7.5, total: 28, decided: 16, inPlay: 4, notStarted: 8 };
    expect(cupVerdict(t, 0, null)).toEqual({ kind: "open", needA: 6, needB: 7 });
  });

  it("writes halves the way a scoreboard does", () => {
    expect(cupPoints(8.5)).toBe("8½");
    expect(cupPoints(0.5)).toBe("½");
    expect(cupPoints(14)).toBe("14");
    expect(cupPoints(0)).toBe("0");
  });
});
