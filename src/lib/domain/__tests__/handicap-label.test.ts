import { describe, it, expect } from "vitest";
import { indexLabel, hasIndex, NO_INDEX } from "../handicap-label";

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
