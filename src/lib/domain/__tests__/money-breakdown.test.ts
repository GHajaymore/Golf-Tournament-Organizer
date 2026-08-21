import { describe, it, expect } from "vitest";
import { unitemisedGames } from "../money-breakdown";

/**
 * The part of a player's pot money that no line on the screen accounts for.
 *
 * `gameNets` settles from the skins pot, side games and contests. Only
 * contests carry a per-player figure, so the skins money — real money, won or
 * lost — sat inside a total with nothing anywhere in the player app explaining
 * it.
 */
describe("what the side-bets total does not itemise", () => {
  it("is zero when every part is shown", () => {
    expect(unitemisedGames(1500, [1000, 500])).toBe(0);
  });

  it("is the whole total when nothing is shown", () => {
    // The skins-only case: a player in the skins pot and no contest.
    expect(unitemisedGames(-750, [])).toBe(-750);
  });

  it("keeps the sign, because losing is the common case", () => {
    // A player who staked $5 and won nothing is DOWN $5. Reporting an absolute
    // value here would tell them they were owed it.
    expect(unitemisedGames(-500, [])).toBe(-500);
    expect(unitemisedGames(-500, [-200])).toBe(-300);
  });

  it("nets a win against a loss without cancelling the row away", () => {
    // Won the skins, lost the closest-to-the-pin: the remainder is the skins
    // win, and it still has to show.
    expect(unitemisedGames(800, [-200])).toBe(1000);
  });

  it("is zero when there is no pot money at all", () => {
    expect(unitemisedGames(0, [])).toBe(0);
  });

  it("works in whole cents, with no tolerance", () => {
    // Every input is already an integer number of cents. A tolerance here
    // would hide a real gap between the total and its parts — which is the
    // exact thing this function exists to expose.
    expect(unitemisedGames(1, [])).toBe(1);
    expect(unitemisedGames(333, [111, 111, 111])).toBe(0);
  });

  it("never invents a remainder from an itemised list that overshoots", () => {
    // Not expected, but if the parts exceeded the total the answer must be the
    // real (negative) difference rather than clamped to zero — a clamp would
    // hide the disagreement it is meant to reveal.
    expect(unitemisedGames(100, [400])).toBe(-300);
  });
});
