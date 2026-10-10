import { describe, it, expect } from "vitest";
import { missingFromRound, roundReadyToClose, roundReadyWord, type RoundReadyInput } from "../round-ready";

const base: RoundReadyInput = { unit: "cards", total: 4, certified: 4, approved: 4, needsApproval: true, closed: false };

describe("a round ready for the committee to close", () => {
  it("is ready once every card is returned and accepted", () => {
    expect(roundReadyToClose(base)).toBe(true);
  });

  it("waits for a card still out, and for one not yet accepted where the club reviews", () => {
    expect(roundReadyToClose({ ...base, certified: 3 })).toBe(false);
    expect(roundReadyToClose({ ...base, approved: 3 })).toBe(false);
    // A club that does not review: returned is enough.
    expect(roundReadyToClose({ ...base, approved: 0, needsApproval: false })).toBe(true);
  });

  it("counts a side or a match round in its own unit, where nobody accepts cards", () => {
    expect(roundReadyToClose({ ...base, unit: "sides", approved: 0 })).toBe(true);
    expect(roundReadyToClose({ ...base, unit: "matches", certified: 2, approved: 0 })).toBe(false);
  });

  it("is never ready when closed already, scored by hand, a knockout, or owed nothing (controls)", () => {
    expect(roundReadyToClose({ ...base, closed: true })).toBe(false);
    expect(roundReadyToClose({ ...base, unit: "manual" })).toBe(false);
    // A decided final ends the TOURNAMENT; there is no round to close.
    expect(roundReadyToClose({ ...base, unit: "ties", approved: 0 })).toBe(false);
    expect(roundReadyToClose({ ...base, total: 0, certified: 0, approved: 0 })).toBe(false);
  });
});

describe("what the close card calls everything being in", () => {
  it("names the round's own unit — no cards on a match round or a side's day", () => {
    expect(roundReadyWord("cards")).toBe("Every card is in");
    expect(roundReadyWord("matches")).toBe("Every match is finished");
    expect(roundReadyWord("sides")).toBe("Every side's card is in");
  });
});

/**
 * A LEAGUE WEEK WITH NO-SHOWS (2026-10-10). Twenty of 120 away: the week was
 * never "all in", never asked to be closed, and its absentees' My card stayed
 * on it into the next week. Once the next round is under way and every card
 * begun is back, the rest did not play.
 */
describe("a round whose only missing cards are players who never started", () => {
  const week: RoundReadyInput = {
    unit: "cards", total: 120, started: 100, certified: 100, approved: 100, needsApproval: true, closed: false, nextRoundReady: true,
  };

  it("is ready to close once the next round is under way, and says who has no card", () => {
    expect(roundReadyToClose(week)).toBe(true);
    expect(missingFromRound(week)).toBe(20);
  });

  it("CONTROL: not at noon on a medal day — the next round is not under way", () => {
    expect(roundReadyToClose({ ...week, nextRoundReady: false })).toBe(false);
    expect(missingFromRound({ ...week, nextRoundReady: false })).toBe(0);
  });

  it("CONTROL: not while a card begun is still out, or still waiting to be accepted", () => {
    expect(roundReadyToClose({ ...week, certified: 99 })).toBe(false);
    expect(roundReadyToClose({ ...week, approved: 99 })).toBe(false);
  });
});
