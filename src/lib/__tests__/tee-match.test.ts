import { describe, it, expect } from "vitest";
import { matchTee } from "../domain/tee-match";

/**
 * What a golfer typed, turned into the set they play from.
 *
 * The assertions that matter here are the REFUSALS. Matching "white" to White
 * is the easy half; the half that decides whether this feature is safe is
 * that an answer the app cannot pin down becomes null rather than a guess.
 * A guessed tee is a wrong Course Handicap, and a wrong Course Handicap looks
 * exactly like a right one on every screen in the app.
 */
const TEES = [
  { id: "blue", name: "Blue" },
  { id: "white", name: "White" },
  { id: "red", name: "Red" },
];

describe("matching a typed tee to a real one", () => {
  it("takes the name as written", () => {
    expect(matchTee("White", TEES)).toBe("white");
    expect(matchTee("Blue", TEES)).toBe("blue");
  });

  it("does not care how it was typed", () => {
    // Nobody copies the name off the card.
    expect(matchTee("white", TEES)).toBe("white");
    expect(matchTee("  WHITE  ", TEES)).toBe("white");
    expect(matchTee("the whites", TEES)).toBe("white");
    expect(matchTee("White tees", TEES)).toBe("white");
    expect(matchTee("the blue tee", TEES)).toBe("blue");
  });

  it("REFUSES what it cannot pin down", () => {
    // Not a tee on this course. The round's set, not the nearest guess.
    expect(matchTee("Championship", TEES)).toBeNull();
    expect(matchTee("Yellow", TEES)).toBeNull();
    expect(matchTee("", TEES)).toBeNull();
    expect(matchTee("   ", TEES)).toBeNull();
    expect(matchTee(null, TEES)).toBeNull();
    expect(matchTee(undefined, TEES)).toBeNull();
    // A course with no tees on file can match nothing at all.
    expect(matchTee("White", [])).toBeNull();
  });

  it("REFUSES when two sets answer to the same thing", () => {
    // A card problem, not something to settle by taking the first row. The
    // order tees happen to be in is not evidence about what a golfer meant.
    const twins = [
      { id: "a", name: "White" },
      { id: "b", name: "white" },
    ];
    expect(matchTee("White", twins)).toBeNull();
    // And loosely, too: "Blue" and "Blues" both normalise to the same thing,
    // so neither can be chosen over the other.
    const near = [
      { id: "a", name: "Blue" },
      { id: "b", name: "Blues" },
    ];
    expect(matchTee("the blues", near)).toBeNull();
  });

  it("prefers an exact name over a loose one", () => {
    // A set genuinely called "Reds" is matched by "Reds" exactly, even though
    // "Red" is also present and would match it once the plural is stripped.
    const both = [
      { id: "red", name: "Red" },
      { id: "reds", name: "Reds" },
    ];
    expect(matchTee("Reds", both)).toBe("reds");
    expect(matchTee("Red", both)).toBe("red");
  });

  it("handles the sets a real card actually carries", () => {
    const real = [
      { id: "champ", name: "Championship" },
      { id: "med", name: "Medal" },
      { id: "soc", name: "Society" },
      { id: "fwd", name: "Forward" },
    ];
    expect(matchTee("medal", real)).toBe("med");
    expect(matchTee("the society tees", real)).toBe("soc");
    expect(matchTee("Forward", real)).toBe("fwd");
    // "champ" is not "Championship" — close is not a match, and a golfer who
    // abbreviated gets the round's tees and a visible row to correct.
    expect(matchTee("champ", real)).toBeNull();
  });
});
