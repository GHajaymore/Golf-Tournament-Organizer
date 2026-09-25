import { describe, it, expect } from "vitest";
import { holdsPosition, positionLabel } from "@/lib/domain/shared-position";

/**
 * A ROW HOLDS A POSITION IFF IT HAS BOTH A RESULT AND A PLACE.
 *
 * `holdsPosition` is the one rule the scoreboard tiles, both leaderboard tables
 * and the player's own row all read, so the four cannot disagree about whether
 * a player has a position. The states that matter, and where they come from:
 *
 *   stroke, thru 0        ranked false, started false   `isRanked` needs a hole
 *   stroke, card in       ranked true,  started true    the ordinary case
 *   match, played 3-0-0   ranked true,  started true    a match row is ranked
 *   match, not teed off   ranked true,  started false   THE ONE THIS FIXES —
 *                                                        a place before a result
 *   card won 5&4          ranked false, started true    a result, but no place
 *
 * Only the fourth changed behaviour: a match row is unconditionally `ranked`,
 * so a board gating on `ranked` alone painted a not-yet-started player a
 * position the hero on `/me` refused. In stroke play `ranked` implies `started`
 * (see `isRanked`), so the extra `started` term is a no-op there.
 */
describe("holdsPosition", () => {
  it("requires both a result and a place", () => {
    expect(holdsPosition({ ranked: false, started: false })).toBe(false); // stroke, no card
    expect(holdsPosition({ ranked: true, started: true })).toBe(true); // has both
    expect(holdsPosition({ ranked: true, started: false })).toBe(false); // match, not teed off
    expect(holdsPosition({ ranked: false, started: true })).toBe(false); // 5&4 card, no place
  });

  it("is the gate the player's own position label reads", () => {
    // A player level on rank 1 with a rival who has not teed off is not tied —
    // the rival holds no position, so it is a solo lead, not "T1".
    const rows = [
      { id: "me", rank: 1, ranked: true, started: true },
      { id: "rival", rank: 1, ranked: true, started: false },
    ];
    expect(positionLabel(rows, "me")).toBe("1");
    expect(positionLabel(rows, "rival")).toBe("");
  });
});
