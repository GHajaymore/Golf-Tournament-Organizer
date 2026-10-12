import { describe, it, expect } from "vitest";
import { indexFigure, indexLabel, hasIndex, NO_INDEX, parseStrokesInput, STROKES_MIN, STROKES_MAX } from "../handicap-label";
import { parseHandicapInput, STAFF_HANDICAP_REFUSAL } from "../registration-intake";

/**
 * The one rule five screens share. Every cell is a version of the same
 * question: can a reader tell "nobody has claimed an index" from "plays off
 * scratch"?
 */

describe("what an index says on a screen", () => {
  it("prints a real figure", () => {
    expect(indexLabel({ handicap: 12.4, handicapSource: "ghin" })).toBe("12.4");
    expect(indexLabel({ handicap: 8, handicapSource: "manual" })).toBe("8");
  });

  it("keeps the nine-hole marker, which is a different figure", () => {
    expect(indexLabel({ handicap: 9.2, handicapType: "9", handicapSource: "manual" })).toBe("9.2 (9)");
  });

  it("says so when nobody has claimed one", () => {
    expect(indexLabel({ handicap: 0, handicapSource: "none" })).toBe(NO_INDEX);
    // And the zero is not smuggled back in by the nine-hole branch.
    expect(indexLabel({ handicap: 0, handicapType: "9", handicapSource: "none" })).toBe(NO_INDEX);
  });

  it("still calls a genuine scratch player scratch", () => {
    /**
     * The direction a careless fix breaks. A club that keeps its own
     * handicaps and has recorded somebody at 0 means it — hiding that figure
     * would be a different lie, told to the same organizer.
     */
    expect(indexLabel({ handicap: 0, handicapSource: "manual" })).toBe("0");
    expect(indexLabel({ handicap: 0, handicapSource: "ghin" })).toBe("0");
  });

  it("treats an absent source as a claimed figure", () => {
    // Every caller that has not been taught about sources yet keeps its old
    // behaviour rather than silently hiding everybody's handicap — the same
    // default the schema uses.
    expect(indexLabel({ handicap: 5.5 })).toBe("5.5");
    expect(indexLabel({ handicap: 5.5, handicapSource: null })).toBe("5.5");
  });
});

describe("a handicap better than scratch", () => {
  /**
   * Stored below zero, written with a plus. Found 2026-10-13: a member
   * imported as "+2.4" stood on the club's own list as "-2.4", and on every
   * other screen that prints an index through `indexLabel`.
   */
  it("is written with a plus sign, never a minus", () => {
    expect(indexFigure(-2.4)).toBe("+2.4");
    expect(indexFigure(-0.1)).toBe("+0.1");
    expect(indexFigure(-10)).toBe("+10");
    expect(indexLabel({ handicap: -2.4, handicapSource: "manual" })).toBe("+2.4");
    expect(indexLabel({ handicap: -3, handicapSource: "ghin" })).toBe("+3");
    expect(indexLabel({ handicap: -1.5, handicapType: "9", handicapSource: "manual" })).toBe("+1.5 (9)");
    // Over the whole range a plus handicap takes: no label has a minus in it.
    for (let tenths = -100; tenths < 0; tenths += 1) {
      const label = indexLabel({ handicap: tenths / 10, handicapSource: "manual" });
      expect(label.startsWith("+"), label).toBe(true);
      expect(label, label).not.toContain("-");
    }
  });

  it("leaves everybody else's figure exactly as it was", () => {
    expect(indexFigure(0)).toBe("0");
    expect(indexFigure(12.4)).toBe("12.4");
    expect(indexFigure(54)).toBe("54");
    expect(indexLabel({ handicap: 12.4, handicapSource: "manual" })).toBe("12.4");
    expect(indexLabel({ handicap: 0, handicapSource: "manual" }), "scratch is not a plus handicap").toBe("0");
    expect(indexLabel({ handicap: 7, handicapType: "9" })).toBe("7 (9)");
  });

  it("reads back as the number it was written from", () => {
    // What the screen shows is what the entry box and the importer take (`parseHandicapInput`):
    // a figure copied off a screen and typed into a form must not change sign on the way.
    for (const stored of [-10, -2.4, -0.1, 0, 0.1, 12.4, 54]) {
      const shown = indexFigure(stored);
      const typed = shown.startsWith("+") ? -Number(shown.slice(1)) : Number(shown);
      expect(typed, shown).toBe(stored);
      expect(parseHandicapInput(shown)).toMatchObject({ ok: true, value: stored });
    }
  });

  it("still says nothing has been claimed, whatever number is stored beside it", () => {
    expect(indexLabel({ handicap: -2.4, handicapSource: "none" })).toBe(NO_INDEX);
  });
});

describe("a round's handicap, as somebody types it", () => {
  it("reads a plus handicap as strokes GIVEN — the one notation arithmetic gets backwards", () => {
    /**
     * `Number("+2")` is 2. The round's editor read its box that way, so the
     * figure the screen prints for a plus-two player — "+2" — typed back into
     * the box beside it, saved a player RECEIVING two.
     */
    expect(parseStrokesInput("+2")).toEqual({ ok: true, value: -2 });
    expect(parseStrokesInput(" +10 ")).toEqual({ ok: true, value: -10 });
    expect(parseStrokesInput("-2")).toEqual({ ok: true, value: -2 });
    expect(parseStrokesInput("12")).toEqual({ ok: true, value: 12 });
  });

  it("reads back, as the number it came from, every figure the editor opens on", () => {
    for (let stored = STROKES_MIN; stored <= STROKES_MAX; stored += 1) {
      const shown = indexFigure(stored);
      expect(parseStrokesInput(shown), shown).toEqual({ ok: true, value: stored });
    }
  });

  it("reads the word the screen prints for nought", () => {
    expect(parseStrokesInput("scratch")).toEqual({ ok: true, value: 0 });
    expect(parseStrokesInput("Scratch")).toEqual({ ok: true, value: 0 });
    expect(parseStrokesInput("0")).toEqual({ ok: true, value: 0 });
    expect(Object.is(parseStrokesInput("+0").ok && (parseStrokesInput("+0") as { value: number }).value, 0)).toBe(true);
  });

  it("refuses, in words, what it used to change quietly", () => {
    // An empty box was zero to arithmetic: Save on a cleared box made the player scratch.
    const empty = parseStrokesInput("");
    expect(empty.ok).toBe(false);
    expect(parseStrokesInput("   ").ok).toBe(false);
    // 12.4 was rounded on the server without a word; this figure is whole strokes.
    const index = parseStrokesInput("12.4");
    expect(index).toMatchObject({ ok: false });
    expect((index as { error: string }).error).toMatch(/whole strokes/);
    // 77 was cut down to 54, +11 to +10.
    for (const beyond of ["55", "77", "+11", "-11", "1e9"]) {
      expect(parseStrokesInput(beyond), beyond).toMatchObject({ ok: false });
    }
    for (const nonsense of ["two", "12abc", "1 2", "--3", "+", "+-2", "Infinity", "NaN"]) {
      expect(parseStrokesInput(nonsense), nonsense).toMatchObject({ ok: false });
    }
  });

  it("takes both ends of the range", () => {
    expect(parseStrokesInput("+10")).toEqual({ ok: true, value: STROKES_MIN });
    expect(parseStrokesInput("54")).toEqual({ ok: true, value: STROKES_MAX });
  });
});

describe("a handicap refused, said to an organizer", () => {
  it("is said about somebody else's handicap, for both reasons the reader gives", () => {
    const notANumber = parseHandicapInput("two and a bit");
    const beyond = parseHandicapInput("77");
    expect(notANumber).toMatchObject({ ok: false, why: "not-a-number" });
    expect(beyond).toMatchObject({ ok: false, why: "out-of-range" });
    for (const why of ["not-a-number", "out-of-range"] as const) {
      expect(STAFF_HANDICAP_REFUSAL[why]).not.toMatch(/your/i);
    }
    // The plus is offered where it can be mistyped, because it is the case this exists for.
    expect(STAFF_HANDICAP_REFUSAL["not-a-number"]).toContain("+2.4");
  });
});

describe("whether a figure may be played off", () => {
  it("is false only when nobody has claimed one", () => {
    expect(hasIndex({ handicap: 0, handicapSource: "none" })).toBe(false);
    expect(hasIndex({ handicap: 0, handicapSource: "manual" })).toBe(true);
    expect(hasIndex({ handicap: 12.4, handicapSource: "ghin" })).toBe(true);
    expect(hasIndex({ handicap: 12.4 })).toBe(true);
  });

  it("is a different question from what to print", () => {
    /**
     * Kept apart on purpose: a screen sorting a field by handicap, balancing
     * flights or pairing a fourball is making a decision, and a missing index
     * is not a small number — it is nothing at all. The label answers what a
     * person reads; this answers what the code may compute with.
     */
    const missing = { handicap: 0, handicapSource: "none" };
    expect(indexLabel(missing)).toBe(NO_INDEX);
    expect(hasIndex(missing)).toBe(false);
  });
});
