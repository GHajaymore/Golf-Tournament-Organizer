import { describe, it, expect } from "vitest";
import { matchStandingText, resolveMatch } from "../match";
import { initials } from "@/lib/format";
import { distinctLabels } from "@/lib/format";
import type { HoleResult } from "../types";

/**
 * Where a match stands, said the way a player on the tee would say it.
 *
 * "Alex 2 up" is a fact and half a sentence. The question a match-play player
 * actually asks is how many holes are LEFT — two up with two to play is a
 * match somebody can still save, two up with one to play is over bar the
 * handshake — and live scoring is the exact moment that difference matters.
 */

/** A card from a string: A won, B won, H halved, . not played. */
const card = (s: string): HoleResult[] =>
  s.split("").map((c) => (c === "." ? null : (c as "A" | "B" | "H")));

const standing = (s: string) => matchStandingText(resolveMatch(card(s)), "Alex", "Bo");

describe("a match in progress", () => {
  it("says how many holes are left", () => {
    // Two up, and sixteen still to play — a match nobody has won.
    expect(standing("AA..............")).toBe("Alex 2 up with 14 to play");
  });

  it("names the leader rather than a letter", () => {
    expect(standing("BB..............")).toContain("Bo");
    expect(standing("BB..............")).not.toContain("Alex");
  });

  it("carries the count on all square too", () => {
    /**
     * Level with two left is a different match from level with fourteen, and
     * "All square" alone says neither. The one state with no leader to name is
     * still a state with holes remaining.
     */
    expect(standing("AB..............")).toBe("All square with 14 to play");
  });

  it("says DORMIE when the lead equals what is left", () => {
    /**
     * Golf has a word for it and the word carries the meaning: leading by
     * exactly as many holes as remain is a match that cannot now be LOST.
     * "3 up with 3 to play" is true and says that without saying it.
     *
     * Fifteen holes played, three won by A and twelve halved, three to play.
     */
    expect(standing("AAAHHHHHHHHHHHH...")).toBe("Alex dormie 3");
  });

  it("and nothing at all before a ball is struck", () => {
    expect(standing("..................")).toBe("Not started");
  });
});

describe("a match that is over", () => {
  it("says what it finished by", () => {
    /**
     * The closeout notation comes from `resolveMatch`, which owns the rule —
     * Rule 3.2a(3), a match ends when one side leads by more holes than
     * remain. Nothing here recomputes it.
     *
     * A wins 1, 2 and 3, everything else halved to the 16th: 3 up with 2 to
     * play is 3&2.
     */
    expect(standing("AAAHHHHHHHHHHHHH..")).toBe("Alex 3&2");
  });

  it("calls a halved match halved, and names nobody", () => {
    const all = matchStandingText(resolveMatch(card("HHHHHHHHHHHHHHHHHH")), "Alex", "Bo");
    expect(all).toBe("Halved");
  });

  it("stops counting holes down once it is decided", () => {
    // THE ASSERTION THAT SEPARATES THIS FROM "always append the remainder".
    // A finished match has no holes to play, and saying it does would be the
    // sentence contradicting the result beside it.
    expect(standing("AAAHHHHHHHHHHHHH..")).not.toContain("to play");
  });
});

describe("the two-letter labels the hole picker wears", () => {
  /**
   * The picker's columns are about two characters wide on a phone, which is
   * why they read "A" and "B" — and A and B are not the two people playing.
   */
  it("takes a name down to two letters", () => {
    expect(initials("Alex Rourke")).toBe("AR");
    // First and last, not first two: "Jean-Paul Sartre" is JS to anyone who
    // knows him.
    expect(initials("Jean-Paul Sartre")).toBe("JS");
    // One name gives two letters, because one letter in a two-letter slot
    // reads as a mistake.
    expect(initials("Bo")).toBe("BO");
    expect(initials("  spaced   out  ")).toBe("SO");
  });

  it("and widens when two players would print the same two letters", () => {
    /**
     * THE CASE THAT MATTERS, and the reason this goes through
     * `distinctLabels` rather than being called directly. Two letters that
     * look like a name and name the WRONG person are worse than A and B,
     * which at least admit they mean nothing.
     */
    const [a, b] = distinctLabels(["Alex Rourke", "Adam Reid"], initials);
    expect(a).not.toBe(b);
    /**
     * To `shortName`, which is the ladder's next rung — not to a first name.
     * Asserted by value rather than by "they differ", because which rung it
     * lands on has a consequence the picker feels: "Alex R." is far wider than
     * "AR" in a column sized for two characters, so a clash visibly widens
     * that hole. That is the right trade — an ambiguous label is worse than a
     * wide one — but it is a trade, and a test that only checked they differed
     * would not have said so.
     */
    expect(a).toBe("Alex R.");
    expect(b).toBe("Adam R.");
  });

  it("and leaves an ordinary pair as initials", () => {
    // Widening everybody to fix a clash in two is the failure `distinctLabels`
    // was written to avoid.
    expect(distinctLabels(["Alex Rourke", "Bo Kite"], initials)).toEqual(["AR", "BK"]);
  });
});
