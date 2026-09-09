import { describe, it, expect } from "vitest";
import { hasStandingToShow } from "../player-standing";

/**
 * Whether the player screen's hero card has anything to put in it.
 *
 * See the file header for the screen this was written from: before a ball was
 * struck it printed "Not started" twice, over two em-dashes, in the largest
 * type on the phone.
 */

describe("before anybody has played", () => {
  it("has nothing to show", () => {
    expect(hasStandingToShow(undefined)).toBe(false);
    expect(hasStandingToShow(null)).toBe(false);
    expect(hasStandingToShow({ position: "", thru: 0 })).toBe(false);
  });
});

describe("once there is something", () => {
  it("shows a position", () => {
    expect(hasStandingToShow({ position: "1", thru: 18 })).toBe(true);
    // A shared position is still a position.
    expect(hasStandingToShow({ position: "T2", thru: 18 })).toBe(true);
  });

  it("shows a card that stopped short, which holds NO position", () => {
    /**
     * THE ASSERTION THAT MATTERS, and the reason this is two tests rather
     * than one.
     *
     * `isRanked` refuses to rank a card that stopped short — a match won 5&4,
     * four holes conceded and never played — deliberately, because ranking a
     * fourteen-hole card against an eighteen-hole one presents two numbers as
     * comparable when they are not. So this player has holes and no position.
     *
     * Asking about the position alone would hide the card of somebody who has
     * actually played: they have something to see and the app would show them
     * nothing, which is the opposite failure and the worse one.
     */
    expect(hasStandingToShow({ position: "", thru: 14 })).toBe(true);
  });

  it("counts a single hole", () => {
    // The card appears the moment the first hole goes in, which is what the
    // sentence it replaces promises.
    expect(hasStandingToShow({ position: "", thru: 1 })).toBe(true);
  });

  it("and treats a missing thru as none rather than as some", () => {
    // `thru` is optional on the summary, and undefined means nothing has been
    // returned — reading it as truthy would put an empty card back.
    expect(hasStandingToShow({ position: "" })).toBe(false);
    expect(hasStandingToShow({})).toBe(false);
  });
});
