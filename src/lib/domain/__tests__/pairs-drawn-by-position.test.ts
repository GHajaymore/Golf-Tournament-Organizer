import { describe, it, expect } from "vitest";
import { groupBySides, orderGroups, positionLookup, sidesByStandings } from "../draw";

/**
 * PAIRS ARE DRAWN BY POSITION FROM ROUND TWO (2026-10-10).
 *
 * A 36-hole four-ball's second round is drawn off the board, as every pairs
 * championship does it: the pairs nearest each other go out together, and the
 * leaders go out last. "By position" was greyed for a pairs round, because the
 * sheet read the INDIVIDUAL board, which a pairs round does not have.
 *
 * The board here is the sides' own (each member carries the side's place), and
 * the fixture is chosen so the side order and the board order are opposite —
 * a draw that ignored the board would send the leaders out FIRST.
 */
const a = ["ann", "abe"];
const b = ["bea", "bob"];
const c = ["cat", "cal"];
const d = ["dee", "dan"];
// Sides as drawn on Teams: a, b, c, d. Board: d leads, then c, b, a.
const board = positionLookup(
  [d, c, b, a].flatMap((side, i) => side.map((playerId) => ({ playerId, position: i + 1 }))),
);

describe("a pairs round drawn by position", () => {
  it("orders the sides as they stand on the board", () => {
    expect(sidesByStandings([a, b, c, d], board)).toEqual([d, c, b, a]);
  });

  it("puts the two leading pairs in one group and sends it out last", () => {
    const groups = groupBySides(sidesByStandings([a, b, c, d], board), [], 4);
    const sheet = orderGroups(groups, "leaders-last", board).map((g) => g.playerIds);
    expect(sheet).toEqual([[...b, ...a], [...d, ...c]]);
  });

  it("keeps a side with nobody on the board after every placed side, in its drawn order", () => {
    const e = ["eli", "eva"];
    expect(sidesByStandings([e, a, b, c, d], board)).toEqual([d, c, b, a, e]);
  });

  it("CONTROL: without the board's order the leaders would share the FIRST group", () => {
    const groups = groupBySides([a, b, c, d], [], 4);
    expect(groups.map((g) => g.playerIds)).toEqual([[...a, ...b], [...c, ...d]]);
  });
});
