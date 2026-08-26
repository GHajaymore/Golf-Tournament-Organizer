import { describe, it, expect } from "vitest";
import { nameHold } from "../bet-name";

/**
 * What is holding a side bet's name — and it matters which.
 *
 * A game is keyed on (round, kind, name). So the same crew running skins AND a
 * birdie pot under one name is not a clash: it is two rows that settle
 * together, which is the point of sharing the name. Refusing it was the check
 * being too strict, and the fix has to not swing the other way — a tee-sheet
 * group name must still be held against every game, because an ad-hoc bet
 * borrowing it resolves its audience to that fourball and, in opt-out mode,
 * charges them a stake they never agreed to.
 */

const GROUP: { name: string; kind: string } = { name: "Group 1", kind: "*" };
const SKINS = { name: "Saturday sweep", kind: "skins" };
const BIRDIES = { name: "Saturday sweep", kind: "birdies" };

describe("what is holding a bet's name", () => {
  it("leaves a free name free", () => {
    expect(nameHold("Nassau crew", "skins", [GROUP, SKINS])).toBeNull();
  });

  it("holds a tee-sheet group name against EVERY game", () => {
    // The reason is the fourball, not an existing game — and the message the
    // player sees has to say so, or they go looking for a game that is not
    // there.
    for (const game of ["skins", "birdies", "eagles", "low-net", "low-gross"]) {
      expect(nameHold("Group 1", game, [GROUP]), game).toEqual(GROUP);
    }
  });

  it("holds an existing game's name against that game only", () => {
    expect(nameHold("Saturday sweep", "skins", [SKINS])).toEqual(SKINS);
  });

  it("lets the same crew add a DIFFERENT game under the same name", () => {
    // THE OVER-STRICT CASE. Four friends with a skins game called "Saturday
    // sweep" want a birdie pot too. Two rows, one name, settling together —
    // refusing this made them invent a second name for the same bet.
    expect(nameHold("Saturday sweep", "birdies", [SKINS])).toBeNull();
    expect(nameHold("Saturday sweep", "skins", [BIRDIES])).toBeNull();
  });

  it("still refuses a second game of a kind already there", () => {
    // Two birdie pots at one name would be two prices for one bet, and the
    // cards could not tell them apart.
    expect(nameHold("Saturday sweep", "birdies", [SKINS, BIRDIES])).toEqual(BIRDIES);
  });

  it("ignores case and surrounding space, the way a typed name arrives", () => {
    expect(nameHold("  group 1  ", "skins", [GROUP])).toEqual(GROUP);
    expect(nameHold("SATURDAY SWEEP", "skins", [SKINS])).toEqual(SKINS);
  });

  it("says nothing at all about an empty name", () => {
    // An error on a form nobody has filled in yet.
    expect(nameHold("", "skins", [GROUP, SKINS])).toBeNull();
    expect(nameHold("   ", "skins", [GROUP, SKINS])).toBeNull();
  });

  it("reports the FIRST holder, so the message names one reason", () => {
    // A name could be held by a group and by a game at once. The player is
    // told one thing, and the group is the stronger of the two.
    expect(nameHold("Group 1", "skins", [GROUP, { name: "Group 1", kind: "skins" }])).toEqual(GROUP);
  });

  it("holds nothing when there is nothing taken", () => {
    expect(nameHold("Group 1", "skins", [])).toBeNull();
  });
});
