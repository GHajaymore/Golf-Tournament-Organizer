import { describe, it, expect } from "vitest";
import { holesUnplayedIn } from "../skins-pot";

/**
 * A SKINS POT IS NOT SETTLED WHILE ANYBODY IN IT IS STILL PLAYING.
 *
 * Found on 2026-09-19 on a seeded club's Money screen: the round's own panel
 * said "Nothing settled yet — a round's pots are worked out once every hole is
 * in", and two cards below it the skins pot had settled, fed "You're owed" and
 * offered four handovers to mark settled. Fifteen entrants had finished and one
 * was on the 12th tee.
 *
 * The cause was the definition of a played hole: the service asked whether ANY
 * entrant had a score there. A skin is decided BETWEEN the entrants, so that is
 * the wrong question — `money-layout.ts` says to ask whether the amount can
 * still change, and a player with six holes left can win one and change what
 * everybody else holds.
 */

describe("holes still out in a skins pot", () => {
  it("counts a hole nobody has played", () => {
    expect(holesUnplayedIn([[4, 4, null], [5, 4, null]], 3)).toBe(1);
  });

  it("counts a hole ONE entrant has still to play — the defect", () => {
    // Everybody home but one, who is two holes short. Under the old rule this
    // was zero and the pot paid out.
    const finished = [4, 4, 4, 4];
    const stillOut = [4, 4, null, null];
    expect(holesUnplayedIn([finished, finished, finished, stillOut], 4)).toBe(2);
  });

  it("is zero only when every card is complete", () => {
    expect(holesUnplayedIn([[4, 5], [3, 6]], 2)).toBe(0);
  });

  it("does not hold the pot open on an entrant who never teed off", () => {
    /**
     * The exception `roundMoneyFinality` documents beside its own check: a
     * player with no card at all has no row, team formats file one card for
     * several players, and holding every pot open for ever on an absent card
     * is a different wrong answer. The organizer closing the tournament is the
     * backstop.
     */
    expect(holesUnplayedIn([[4, 4], [5, 4], [null, null]], 2)).toBe(0);
  });

  it("treats a pot where nobody has played as entirely out", () => {
    // Not "settled because there is nothing outstanding" — the whole round is.
    expect(holesUnplayedIn([[null, null], [null, null]], 2)).toBe(2);
    expect(holesUnplayedIn([], 18)).toBe(18);
  });

  it("counts against the holes asked for, not the length of a card", () => {
    // A nine-hole pot on an eighteen-hole card: the service slices the range
    // first, and a short row must read as unplayed rather than as finished.
    expect(holesUnplayedIn([[4, 4, 4]], 9)).toBe(6);
  });
});
