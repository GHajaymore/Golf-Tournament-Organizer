import { describe, it, expect } from "vitest";
import {
  computeStrokeCard,
  expandDigitRuns,
  parseStrokesTranscript,
  rankStrokeIndex,
  readScoreToken,
  strokesReceivedOnHolesPlayed,
  transcriptTokens,
} from "@/lib/domain/stroke";

/**
 * WHAT `stroke.ts` COUNTS IS WHAT WAS PLAYED, AND WHAT WAS SAID (2026-11-02).
 *
 * Written against the mutation ratchet: the nightly round of 2 Nov (run 41417115128) put
 * `stroke.ts` at 76.38% against a floor of 76.75% — one mutant of 271. Stryker's report named
 * forty-odd others that no test noticed: a figure that is not a number counted as a hole played,
 * a stray figure past the end of a nine-hole game counted towards it, and nearly all of golf's
 * words for a score ("triple bogey", "eagle", "albatross") read by nothing a test asserts.
 *
 * Every expectation here is worked by hand, from the Rules or from the meaning of the word, by a
 * route the code does not take: strokes are counted off a list of stroke indexes, not allocated.
 */

// A real card's stroke index, in hole order (holes 1-18).
const SI_18 = [7, 13, 1, 15, 3, 11, 5, 17, 9, 8, 14, 2, 16, 4, 12, 6, 18, 10];

describe("strokes received are counted on the holes actually played (WHS Rule 6.2, Appendix E)", () => {
  /**
   * Handicap Index 12.4, slope 125, Course Rating 71.2, par 72:
   *   Course Handicap = 12.4 x 125 / 113 + (71.2 - 72) = 13.717 - 0.8 = 12.917, which rounds to 13.
   * At 100% (match play) the playing handicap is 13: one stroke on each hole of stroke index 1-13.
   */
  const PLAYING = 13;

  it("a figure that is not a number (NaN, Infinity) is not a hole played, any more than a blank", () => {
    const strokes: Array<number | null> = SI_18.map(() => 5);
    strokes[2] = Number.NaN; // hole 3, SI 1
    strokes[4] = Number.POSITIVE_INFINITY; // hole 5, SI 3
    strokes[6] = null; // hole 7, SI 5
    // Counted by hand: the holes of SI 1-13 are thirteen; three of them (SI 1, 3, 5) have no real
    // figure, so the strokes received so far are ten.
    const played = SI_18.filter((_, h) => h !== 2 && h !== 4 && h !== 6);
    expect(played.filter((si) => si <= PLAYING)).toHaveLength(10);
    expect(strokesReceivedOnHolesPlayed(PLAYING, strokes, SI_18, 18)).toBe(10);
  });

  it("a nine-hole game reads nine holes of an eighteen-hole card, and no tenth", () => {
    /**
     * A plus handicap on a nine: Index +3.8 (that is, -3.8), slope 130, nine-hole Course Rating
     * 36.4, par 36. Nine-hole Course Handicap = (-3.8 / 2) x 130 / 113 + (36.4 - 36)
     * = -2.186 + 0.4 = -1.786, which rounds to +2 (i.e. -2).
     *
     * A plus handicap gives strokes BACK, starting on the easiest hole (Appendix E): on a nine
     * ranked 1-9, that is ranked index 9 and 8 — two strokes back over the nine, whatever else
     * is on the card.
     */
    const frontNineRanked = rankStrokeIndex(SI_18.slice(0, 9));
    expect(frontNineRanked).toEqual([4, 7, 1, 8, 2, 6, 3, 9, 5]);
    const wholeCard = SI_18.map(() => 4);
    expect(strokesReceivedOnHolesPlayed(-2, wholeCard, frontNineRanked, 9)).toBe(-2);
  });
});

describe("a stroke card skips a figure that is not a number (Rule 3.1c / Definitions: a hole's score is the strokes made on it)", () => {
  it("a blank and a NaN are holes not yet scored, not holes of nought", () => {
    const card = computeStrokeCard([4, null, Number.NaN, 5], [4, 4, 4, 4], 0, [1, 2, 3, 4]);
    // Two holes scored: 4 + 5 = 9 strokes, on two par-4s (8), so one over.
    expect(card.gross).toBe(9);
    expect(card.played).toBe(2);
    expect(card.toPar).toBe(1);
    expect(card.net).toBe(9);
  });
});

describe("golf's words for a score read as strokes relative to the hole's par", () => {
  // Not the Rules' words — the game's: an albatross is three under par, an eagle two, a birdie
  // one; a bogey one over, a double bogey two, a triple bogey three. "Double" said alone is a
  // double bogey, the way a player reads a card aloud.
  const cases: Array<[string[], number, number, { value: number; next: number } | null]> = [
    [["triple", "bogey"], 0, 4, { value: 7, next: 2 }],
    [["double", "bogey"], 0, 3, { value: 5, next: 2 }],
    [["four", "triple", "bogey"], 1, 5, { value: 8, next: 3 }],
    [["double"], 0, 5, { value: 7, next: 1 }],
    [["double", "four"], 0, 4, { value: 6, next: 1 }],
    [["triple"], 0, 3, { value: 6, next: 1 }],
    [["triple", "four"], 0, 4, { value: 7, next: 1 }],
    [["bogey"], 0, 5, { value: 6, next: 1 }],
    [["par"], 0, 3, { value: 3, next: 1 }],
    [["par", "bogey"], 0, 4, { value: 4, next: 1 }],
    [["birdie"], 0, 5, { value: 4, next: 1 }],
    [["eagle"], 0, 5, { value: 3, next: 1 }],
    [["albatross"], 0, 5, { value: 2, next: 1 }],
    [["seven"], 0, 4, { value: 7, next: 1 }],
    [["6"], 0, 4, { value: 6, next: 1 }],
    // Not a score: a filler word, an ordinal, a figure with something stuck to it, nothing at all.
    [["and"], 0, 4, null],
    [["4th"], 0, 4, null],
    [["#4"], 0, 4, null],
    [[], 0, 4, null],
  ];
  for (const [tokens, j, par, expected] of cases) {
    it(`"${tokens.join(" ")}" at ${j} on a par ${par} reads ${expected ? expected.value : "as no score"}`, () => {
      expect(readScoreToken(tokens, j, par)).toEqual(expected);
    });
  }

  it("a whole card said aloud skips the words between the scores", () => {
    // Pars 4, 3, 5, 4, 5: four; a triple bogey on the par 3 is 6; an eagle on the par 5 is 3;
    // "then" and "and" are nothing; bogey on the par 4 is 5; albatross on the par 5 is 2.
    expect(parseStrokesTranscript("four and triple bogey then eagle, bogey and albatross", [4, 3, 5, 4, 5], 0)).toEqual([
      4, 6, 3, 5, 2,
    ]);
  });

  it("\"on the 18th\" is not three more holes", () => {
    expect(parseStrokesTranscript("five on the 18th", [4, 4, 4, 4], 0)).toEqual([5]);
    expect(expandDigitRuns(["18th"])).toEqual(["18th"]);
    expect(expandDigitRuns(["#18"])).toEqual(["#18"]);
  });

  it("a transcript is read in lower case, a hyphen is a space, and punctuation separates", () => {
    expect(transcriptTokens("Double-Bogey, par. Four")).toEqual(["double", "bogey", "par", "four"]);
    // Punctuation at either end leaves no empty word behind.
    expect(transcriptTokens(" Four, five. ")).toEqual(["four", "five"]);
    expect(parseStrokesTranscript("Double-Bogey, Par.", [4, 3], 0)).toEqual([6, 3]);
  });
});

describe("a re-ranked stroke index keeps the club's order among equal numbers", () => {
  it("four holes given the same index rank in the order they are played", () => {
    expect(rankStrokeIndex([9, 9, 9, 9, 1])).toEqual([2, 3, 4, 5, 1]);
    expect(rankStrokeIndex([3, 3, 1, 3, 3, 2])).toEqual([3, 4, 1, 5, 6, 2]);
  });
});
