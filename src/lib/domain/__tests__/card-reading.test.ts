import { describe, it, expect } from "vitest";
import {
  parseCardReading,
  extractReadingJson,
  cardReadingPrompt,
  MAX_READABLE_SCORE,
} from "../card-reading";

/**
 * The boundary between a language model and a tournament's scores.
 *
 * Everything arriving here is untrusted. These tests are mostly about what
 * must NOT get through: a model can return the wrong shape, the wrong length,
 * prose where a number should be, or a confident nonsense score. None of it
 * may reach a scorecard, and the safe answer is always a blank rather than a
 * guess — a blank asks a person the question, a wrong number does not.
 */

describe("reading a value", () => {
  it("takes a plain score", () => {
    expect(parseCardReading([4, 5, 3], 3).strokes).toEqual([4, 5, 3]);
  });

  it("takes a numeric string, because models return both", () => {
    expect(parseCardReading(["4", "5"], 2).strokes).toEqual([4, 5]);
  });

  it("refuses anything that is not plainly a number", () => {
    // "4 (unsure)" is a guess about a guess. Prose in a score field means the
    // model was hedging, and the honest rendering of a hedge is a blank.
    const r = parseCardReading(["4 (unsure)", "about 5", "", "-", null, undefined], 6);
    expect(r.strokes).toEqual([null, null, null, null, null, null]);
  });

  it("refuses scores outside what a photograph can plausibly show", () => {
    // Not a rule of golf — anyone can take 21 — but 47 read off a card is a
    // misread far more often than a real score, and a blank asks rather than
    // asserting. Someone who genuinely made 21 can type it.
    const r = parseCardReading([0, -3, 47, 1.5, MAX_READABLE_SCORE + 1], 5);
    expect(r.strokes).toEqual([null, null, null, null, null]);
    // The boundary itself is accepted.
    expect(parseCardReading([MAX_READABLE_SCORE], 1).strokes).toEqual([MAX_READABLE_SCORE]);
  });

  it("refuses a number dressed as an object or an array", () => {
    expect(parseCardReading([{ score: 4 }, [4], true], 3).strokes).toEqual([null, null, null]);
  });
});

describe("reading a card", () => {
  it("always returns exactly the round's hole count", () => {
    // Length is enforced rather than trusted. A 20-hole reading of an 18-hole
    // round is a misread, and quietly taking the first 18 would put every
    // score on the wrong hole.
    expect(parseCardReading([1, 2, 3, 4, 5], 3).strokes).toHaveLength(3);
    expect(parseCardReading([1], 9).strokes).toHaveLength(9);
    expect(parseCardReading([], 18).strokes).toHaveLength(18);
  });

  it("pads a short reading with blanks rather than shifting scores", () => {
    expect(parseCardReading([4, 5], 4).strokes).toEqual([4, 5, null, null]);
  });

  it("names the holes it could not read, so the screen can point at them", () => {
    const r = parseCardReading([4, "?", 5, null], 4);
    expect(r.unreadable).toEqual([2, 4]);
  });

  it("says when it read nothing at all", () => {
    expect(parseCardReading([], 9).empty).toBe(true);
    expect(parseCardReading(["nope", null], 2).empty).toBe(true);
    expect(parseCardReading([4, null], 2).empty).toBe(false);
  });

  it("accepts the wrapper shapes models actually use", () => {
    expect(parseCardReading({ strokes: [4, 5] }, 2).strokes).toEqual([4, 5]);
    expect(parseCardReading({ scores: [4, 5] }, 2).strokes).toEqual([4, 5]);
  });

  it("gives a blank card for anything else, rather than throwing", () => {
    // A screen that errors on a bad read is worse than one that shows an
    // empty card: the organizer can still type the scores in.
    for (const junk of [null, undefined, 42, "sorry, I can't help with that", {}, { foo: 1 }]) {
      const r = parseCardReading(junk, 3);
      expect(r.strokes).toEqual([null, null, null]);
      expect(r.empty).toBe(true);
    }
  });

  it("never invents a hole for a zero-hole round", () => {
    expect(parseCardReading([4, 5], 0).strokes).toEqual([]);
  });
});

describe("finding the answer in a reply", () => {
  it("reads a bare array", () => {
    expect(extractReadingJson("[4, 5, 3]")).toEqual([4, 5, 3]);
  });

  it("reads through a code fence", () => {
    expect(extractReadingJson("```json\n[4, 5]\n```")).toEqual([4, 5]);
  });

  it("reads through surrounding prose", () => {
    // Models add commentary however firmly they are told not to.
    expect(extractReadingJson("Here is the card:\n[4, null, 5]\nHope that helps!")).toEqual([4, null, 5]);
  });

  it("returns nothing findable rather than throwing", () => {
    for (const reply of ["", "I cannot read this image", "[not json]", "["]) {
      expect(() => extractReadingJson(reply)).not.toThrow();
    }
    expect(extractReadingJson("I cannot read this image")).toEqual([]);
  });

  it("survives a refusal without producing scores", () => {
    const r = parseCardReading(extractReadingJson("I'm sorry, I can't identify people in images."), 9);
    expect(r.empty).toBe(true);
    expect(r.strokes).toHaveLength(9);
  });
});

describe("what the model is asked", () => {
  it("asks for the round's own hole count and the player by name", () => {
    const p = cardReadingPrompt(9, "Aj More");
    expect(p).toContain("9 holes");
    expect(p).toContain("Aj More");
  });

  it("asks for null rather than a guess", () => {
    // A model told to always produce a number always will, and every one of
    // those numbers looks exactly as confident as a correct reading.
    expect(cardReadingPrompt(18, "A").toLowerCase()).toContain("null");
    expect(cardReadingPrompt(18, "A").toLowerCase()).toContain("rather than guessing");
  });
});
