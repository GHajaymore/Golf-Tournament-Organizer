import { describe, it, expect } from "vitest";
import { completingRoundsCheck, roundsInWords, NOTHING_SCORED } from "../phase-gate";

/**
 * COMPLETING WITH ROUNDS NOBODY HAS PLAYED (2026-10-31). Worked from the panel's ruling, not from
 * the code: ask when some rounds have no scores (a committee may abandon a round and decide on the
 * rounds played), refuse only when nothing at all has been scored, and say nothing otherwise.
 */
const r = (number: number, hasResult: boolean, closed = false) => ({ number, hasResult, closed });

describe("completingRoundsCheck", () => {
  it("says nothing when every round has scores", () => {
    expect(completingRoundsCheck([r(1, true), r(2, true)])).toBeNull();
  });

  it("asks about the one round with no scores, in the panel's words", () => {
    expect(completingRoundsCheck([r(1, true), r(2, false)])).toEqual({
      ask: "Round 2 has no scores. Completing will close it as not played, and results will be decided on the rounds played.",
    });
  });

  it("names several unplayed rounds together", () => {
    expect(completingRoundsCheck([r(1, true), r(2, false), r(3, false)])).toEqual({
      ask: "Rounds 2 and 3 have no scores. Completing will close them as not played, and results will be decided on the rounds played.",
    });
  });

  it("does not ask about a round the committee has already closed", () => {
    expect(completingRoundsCheck([r(1, true), r(2, false, true)])).toBeNull();
  });

  it("refuses when nothing at all has been scored — there is no result", () => {
    expect(completingRoundsCheck([r(1, false), r(2, false)])).toEqual({ refuse: NOTHING_SCORED });
  });

  it("refuses an all-unplayed tournament even where its rounds were closed", () => {
    expect(completingRoundsCheck([r(1, false, true)])).toEqual({ refuse: NOTHING_SCORED });
  });

  it("says nothing about a tournament with no playing rounds", () => {
    expect(completingRoundsCheck([])).toBeNull();
  });
});

describe("roundsInWords", () => {
  it("lists rounds the way a golfer says them", () => {
    expect(roundsInWords([2])).toBe("Round 2");
    expect(roundsInWords([2, 3])).toBe("Rounds 2 and 3");
    expect(roundsInWords([2, 3, 4])).toBe("Rounds 2, 3 and 4");
  });
});
