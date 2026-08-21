import { describe, it, expect } from "vitest";
import { pasteSummary, type PasteCounts } from "../card-paste";

/**
 * What a pasted scorecard produced, said out loud.
 *
 * Pasting a card off the club's website is the fastest way a course gets set up,
 * and it had two silences: a SUCCESSFUL paste said nothing at all (the boxes it
 * fills are folded shut unless the paste went wrong), and a one-row paste
 * returned early with no state written and no problem reported.
 */

const counts = (over: Partial<PasteCounts> = {}): PasteCounts => ({
  rowCount: 2,
  pars: 18,
  strokeIndex: 18,
  yards: 0,
  problems: 0,
  ...over,
});

describe("what a pasted card produced", () => {
  it("says nothing before anything is pasted", () => {
    expect(pasteSummary(counts({ rowCount: 0, pars: 0, strokeIndex: 0 }))).toBe("");
  });

  it("explains a one-row paste instead of ignoring it", () => {
    // The silent no-op: applyPaste returns early below two rows, so the screen
    // did not react and had nothing to read.
    const s = pasteSummary(counts({ rowCount: 1, pars: 0, strokeIndex: 0 }));
    expect(s).toContain("one row");
    expect(s).toContain("stroke index on the second");
  });

  it("confirms a good paste, with the counts", () => {
    expect(pasteSummary(counts())).toBe("Read 18 pars, 18 stroke indexes.");
  });

  it("includes yardages when the third row was there", () => {
    expect(pasteSummary(counts({ yards: 18 }))).toBe("Read 18 pars, 18 stroke indexes, 18 yardages.");
  });

  it("stays quiet when the parser already reported problems", () => {
    // Those are listed individually right below. A summary on top of them is
    // noise that says less than the thing it sits on.
    expect(pasteSummary(counts({ problems: 2 }))).toBe("");
  });

  it("does not congratulate itself on two rows that parsed to nothing", () => {
    const s = pasteSummary(counts({ pars: 0, strokeIndex: 0, yards: 0 }));
    expect(s).toContain("Nothing recognisable");
    expect(s).not.toContain("Read ");
  });

  it("flags a short card even when the parser is happy", () => {
    // Nine holes pasted into an eighteen-hole course leaves half the boxes
    // empty, and the save then refuses hole by hole with no hint of why.
    const s = pasteSummary(counts({ pars: 9, strokeIndex: 9 }));
    expect(s).toContain("Read 9 pars, 9 stroke indexes.");
    expect(s).toContain("fewer than 18 holes");
  });

  it("does not flag a full card as short", () => {
    expect(pasteSummary(counts())).not.toContain("fewer than");
  });

  it("does not call a missing yardage row a short card", () => {
    // Yardage is optional — the paste takes two rows or three. A zero there is
    // "not pasted", not "nine holes".
    expect(pasteSummary(counts({ yards: 0 }))).not.toContain("fewer than");
  });

  it("reports each count honestly when they disagree", () => {
    // A card whose par row is complete and whose stroke index is not: both
    // numbers shown, because which one is short is what the reader has to fix.
    const s = pasteSummary(counts({ pars: 18, strokeIndex: 12 }));
    expect(s).toContain("18 pars");
    expect(s).toContain("12 stroke indexes");
    expect(s).toContain("fewer than 18 holes");
  });
});
