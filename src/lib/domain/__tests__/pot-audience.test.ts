import { describe, it, expect } from "vitest";
import { potAudience } from "../pot-audience";

/**
 * Who a pot may charge.
 *
 * In OPT-OUT mode the audience IS the membership — nobody ticks anything, so
 * everyone offered the pot is in it and pays the stake. That makes this rule
 * the difference between a fourball's £5 birdie pot costing four people £5 and
 * costing every player in the tournament £5, for a bet they never heard of.
 *
 * Group side games were refused outright until this function existed, because
 * the reader could not answer the question.
 */

const FIELD = ["dave", "ann", "rob", "sam"];

const sheet = (groups: Array<{ name: string; playerIds: string[] }>) =>
  JSON.stringify({
    savedAt: "",
    startType: "tee",
    groups: groups.map((g) => ({ ...g, startHole: 1, time: "8:00 AM" })),
  });

const TWO_GROUPS = sheet([
  { name: "Group 1", playerIds: ["dave", "ann"] },
  { name: "Group 2", playerIds: ["rob", "sam"] },
]);

describe("who a pot is offered to", () => {
  it("offers the club's own game to the whole field", () => {
    // An empty key is the club's pot, and opt-out on it means everybody —
    // which is the entire point of opt-out for a weekly league.
    expect(potAudience("", TWO_GROUPS, FIELD)).toEqual(FIELD);
  });

  it("offers a group's game to that group and nobody else", () => {
    // THE BUG THIS PREVENTS: resolved against the field, rob and sam are
    // entered into Group 1's bet and charged a stake they never agreed to.
    expect(potAudience("Group 1", TWO_GROUPS, FIELD)).toEqual(["dave", "ann"]);
    expect(potAudience("Group 2", TWO_GROUPS, FIELD)).toEqual(["rob", "sam"]);
  });

  it("drops somebody who has left the field since the sheet was published", () => {
    // A player who withdrew is still named on the sheet. Staking them would
    // put a debt on somebody who is not playing.
    const withDeparted = sheet([{ name: "Group 1", playerIds: ["dave", "ann", "gone"] }]);
    expect(potAudience("Group 1", withDeparted, FIELD)).toEqual(["dave", "ann"]);
  });

  it("falls back to the field when a redraw has renamed the group", () => {
    // Stranding the pot is the worse failure: it still has to settle to
    // somebody or the ledger does not balance, and money nobody can reach
    // simply disappears. Too many people is visible and arguable.
    expect(potAudience("Group 9", TWO_GROUPS, FIELD)).toEqual(FIELD);
  });

  it("falls back to the field when every member of the group has gone", () => {
    const allGone = sheet([{ name: "Group 1", playerIds: ["ghost-a", "ghost-b"] }]);
    expect(potAudience("Group 1", allGone, FIELD)).toEqual(FIELD);
  });

  it("falls back when there is no tee sheet at all", () => {
    // A casual round with no draw published. The bet is still real.
    expect(potAudience("Saturday sweep", "", FIELD)).toEqual(FIELD);
    expect(potAudience("Saturday sweep", "not json", FIELD)).toEqual(FIELD);
  });

  it("handles a two-player bet, which is the commonest side bet there is", () => {
    const pair = sheet([{ name: "The 10:20", playerIds: ["dave", "rob"] }]);
    expect(potAudience("The 10:20", pair, FIELD)).toEqual(["dave", "rob"]);
  });

  it("treats whitespace as no group rather than as a group named nothing", () => {
    expect(potAudience("   ", TWO_GROUPS, FIELD)).toEqual(FIELD);
  });
});
