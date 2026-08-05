import { describe, it, expect } from "vitest";
import { needsCourseData, type ScoringShape } from "../courses";

const round = (format: string, scoringBasis = "gross"): ScoringShape => ({ format, scoringBasis });

describe("when a tournament needs course data", () => {
  it("does not need one for gross match play", () => {
    // A community league has no fixed venue — opponents play wherever suits
    // them before the deadline. "Who won this hole" needs no par or index.
    expect(needsCourseData([round("Match Play")])).toBe(false);
    expect(needsCourseData([round("Individual Match Play")])).toBe(false);
  });

  it("needs one for net match play, which allocates strokes by index", () => {
    expect(needsCourseData([round("Match Play", "net")])).toBe(true);
    expect(needsCourseData([round("Match Play", "both")])).toBe(true);
  });

  it("needs one for stroke play and Stableford, which score against par", () => {
    expect(needsCourseData([round("Stroke Play")])).toBe(true);
    expect(needsCourseData([round("Individual Stroke Play")])).toBe(true);
    expect(needsCourseData([round("Stableford")])).toBe(true);
    expect(needsCourseData([round("Modified Stableford")])).toBe(true);
  });

  it("needs one if any single round needs one", () => {
    // A multi-stage event that ends in stroke play still needs the data.
    expect(needsCourseData([round("Match Play"), round("Stroke Play")])).toBe(true);
    expect(needsCourseData([round("Match Play"), round("Match Play", "net")])).toBe(true);
  });

  it("does not demand one from a tournament with no rounds yet", () => {
    expect(needsCourseData([])).toBe(false);
  });

  it("matches format names case-insensitively", () => {
    expect(needsCourseData([round("match play")])).toBe(false);
    expect(needsCourseData([round("MATCH PLAY")])).toBe(false);
  });

  it("treats an unrecognized format as needing course data", () => {
    // Safer default: an unknown format is assumed to score against par.
    expect(needsCourseData([round("Some Future Format")])).toBe(true);
  });
});
