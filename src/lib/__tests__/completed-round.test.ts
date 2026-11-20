import { describe, it, expect } from "vitest";
import { holesToComplete } from "../domain/completed-round";

/**
 * WHICH ROUNDS OWE EVERY HOLE — `holesToComplete`, format by format, from the
 * Rules and not from the predicates it is built of.
 *
 * Rule 3.3c (hole out at every hole, or disqualification) is a rule of
 * individual stroke play. In four-ball, best ball and a shamble one partner's
 * score is enough at each hole (Rule 23.2b); in a scramble the side has one
 * ball and no player has a card of their own; in skins and a Nassau a player
 * out of the hole picks up. The audit cells
 * (`a-short-card-in-a-closed-round-holds-no-place`,
 * `a-short-card-is-judged-by-its-own-format`) prove what the boards do with
 * the answer; this proves the answer for the formats they do not seed.
 */
const round = (format: string, holes = 18, type = "Stroke Play Round") => ({ type, format, holes });

describe("how many holes a closed round's card must hold", () => {
  it("individual stroke play owes the round: eighteen, or nine of a nine-hole round", () => {
    expect(holesToComplete(round("Stroke Play"))).toBe(18);
    expect(holesToComplete(round("Stroke Play", 9))).toBe(9);
  });

  it.each(["Four-Ball", "Best Ball", "Shamble", "Scramble", "Texas Scramble"])(
    "%s: a partner's own card owes no more than having played (Rule 23.2b)",
    (format) => {
      expect(holesToComplete(round(format))).toBe(1);
    },
  );

  it.each(["Skins", "Nassau"])("%s: a player out of the hole picks up", (format) => {
    expect(holesToComplete(round(format))).toBe(1);
  });

  it("THE CONTROL: the formats differ, so the answer is not a constant", () => {
    expect(new Set(["Stroke Play", "Four-Ball", "Skins"].map((f) => holesToComplete(round(f)))).size).toBe(2);
  });
});
