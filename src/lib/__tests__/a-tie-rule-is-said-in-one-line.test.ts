import { describe, it, expect } from "vitest";
import { matchTieInWords, tableTieInWords } from "@/lib/domain/tie-words";
import { STANDARD_COUNTBACK, STANDARD_COUNTBACK_9, MATCH_TIEBREAK_KEYS } from "@/lib/domain/match-tiebreak";
import { DEFAULT_TIEBREAKERS, FIXED_TIEBREAKER_KEYS } from "@/lib/domain";

/**
 * EACH TIE RULE IN ONE LINE (2026-10-16). The Ties group under a round's
 * Customize says the rule in use for each question; these are those words,
 * held to the chains the engine stores.
 */
describe("a match all square after the last hole", () => {
  it("stays halved when nothing is chosen — correct match play", () => {
    expect(matchTieInWords([], 18)).toBe("stays halved");
    expect(matchTieInWords(["halved"], 18)).toBe("stays halved");
  });
  it("names the standard card countback, over 18 and over 9", () => {
    expect(matchTieInWords(STANDARD_COUNTBACK, 18)).toBe("card countback: last 9, 6, 3, then the last hole");
    expect(matchTieInWords(STANDARD_COUNTBACK_9, 9)).toBe("card countback: last 6, 3, then the last hole");
  });
  it("names a play-off, and any other ladder step by step", () => {
    expect(matchTieInWords(["sudden-death"], 18)).toBe("a sudden-death play-off — you record the winner");
    expect(matchTieInWords(["toughest-6", "last-1"], 18)).toBe("toughest 6 holes, then last hole; still level, it stays halved");
  });
  it("has words for every step the engine knows", () => {
    for (const k of MATCH_TIEBREAK_KEYS) expect(matchTieInWords([k], 18)).not.toMatch(/undefined/);
  });
});

describe("players level in the table", () => {
  it("names the first two steps and counts the rest", () => {
    expect(tableTieInWords(DEFAULT_TIEBREAKERS)).toMatch(/^head-to-head, then hole difference, \+\d+ more$/);
    expect(tableTieInWords(["most-wins"])).toBe("most wins");
    expect(tableTieInWords(["toughest-9", "toughest-1"])).toBe("toughest 9 holes, then the toughest hole");
  });
  it("says players share the place when nothing separates them", () => {
    expect(tableTieInWords([])).toBe("players level share the place");
  });
  it("has words for every fixed step", () => {
    // In words, not as a stored key with a hyphen-joined name (head-to-head is its own word).
    for (const k of FIXED_TIEBREAKER_KEYS) expect(tableTieInWords([k]), k).toMatch(/^[a-z]+([ -][a-z]+)*$/);
    expect(tableTieInWords(["holes-won-ratio"])).toBe("hole difference");
  });
});
