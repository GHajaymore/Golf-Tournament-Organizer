import { describe, it, expect } from "vitest";
import { plural } from "../format";

describe("counting things in a sentence", () => {
  it("agrees with the count", () => {
    expect(plural(1, "flight")).toBe("1 flight");
    expect(plural(2, "flight")).toBe("2 flights");
    // The two must differ, or a function that ignores the count entirely
    // satisfies both assertions above.
    expect(plural(1, "flight")).not.toBe(plural(2, "flight"));
  });

  it("says none rather than one", () => {
    // Zero is plural in English — "0 flights", never "0 flight" — and it is
    // the commonest count on a screen that has just been opened.
    expect(plural(0, "player")).toBe("0 players");
  });

  it("takes an irregular plural rather than guessing one", () => {
    // English has no rule this function could implement. A caller with a
    // "match" passes "matches"; anything else takes an "s".
    expect(plural(2, "match", "matches")).toBe("2 matches");
    expect(plural(1, "match", "matches")).toBe("1 match");
    // And the guess it would have made is wrong, which is why the parameter
    // exists at all.
    expect(plural(2, "match", "matches")).not.toBe("2 matchs");
  });
});
