import { describe, it, expect } from "vitest";
import {
  GOLF_FORMATS,
  FORMAT_NAMES,
  SCORED_FORMAT_NAMES,
  TEAM_FORMAT_NAMES,
  findFormat,
  lookupFormat,
  isKnownFormat,
  needsTeams,
  sharesOneCard,
  sideSizeRange,
  playingHandicap,
} from "../formats";

describe("the catalog", () => {
  it("has unique names", () => {
    expect(new Set(FORMAT_NAMES).size).toBe(FORMAT_NAMES.length);
  });

  it("gives every format a description someone could act on", () => {
    for (const f of GOLF_FORMATS) {
      expect(f.desc.length, `${f.name} needs a real description`).toBeGreaterThan(20);
    }
  });

  it("keeps sideSize and ball format coherent", () => {
    for (const f of GOLF_FORMATS) {
      // An individual format cannot share a ball with anyone.
      if (f.sideSize === 1) expect(f.ball, `${f.name}`).toBe("individual");
      // A team format that shares one ball must have more than one player.
      if (f.ball === "single") expect(f.sideSize, `${f.name}`).toBeGreaterThan(1);
      if (f.maxSideSize) expect(f.maxSideSize, `${f.name}`).toBeGreaterThanOrEqual(f.sideSize);
    }
  });

  it("uses a plausible allowance for every format", () => {
    for (const f of GOLF_FORMATS) {
      expect(f.allowance, `${f.name}`).toBeGreaterThan(0);
      expect(f.allowance, `${f.name}`).toBeLessThanOrEqual(100);
    }
  });

  it("marks conventions as conventions", () => {
    // The scramble family has no published WHS allowance. Presenting a local
    // custom as a standard would be a quiet factual error in the UI.
    expect(findFormat("Scramble").allowanceIsConvention).toBe(true);
    expect(findFormat("Texas Scramble").allowanceIsConvention).toBe(true);
    // Foursomes does have one.
    expect(findFormat("Foursomes").allowanceIsConvention).toBeUndefined();
  });

  it("derives the scored list rather than hand-maintaining it", () => {
    // The old list was two hardcoded names, which let the picker advertise
    // formats with no engine behind them.
    expect(SCORED_FORMAT_NAMES).toEqual(GOLF_FORMATS.filter((f) => f.scored).map((f) => f.name));
    expect(SCORED_FORMAT_NAMES).toContain("Scramble");
    expect(SCORED_FORMAT_NAMES).toContain("Stableford");
  });

  it("names every team format as needing teams", () => {
    for (const name of TEAM_FORMAT_NAMES) expect(needsTeams(name), name).toBe(true);
    expect(needsTeams("Stroke Play")).toBe(false);
    expect(needsTeams("Skins")).toBe(false);
  });
});

describe("lookup", () => {
  it("resolves a known name", () => {
    expect(findFormat("Scramble").name).toBe("Scramble");
  });

  it("is case and whitespace insensitive", () => {
    // Names arrive from stored rows and CSV imports, not only the picker.
    expect(lookupFormat("match play")!.name).toBe("Match Play");
    expect(lookupFormat("  FOUR-BALL  ")!.name).toBe("Four-Ball");
  });

  it("maps retired names to what they became", () => {
    // These were duplicates — every format is individual unless sideSize says
    // otherwise — but rounds created under the old names must not drift.
    expect(lookupFormat("Individual Match Play")!.name).toBe("Match Play");
    expect(lookupFormat("Individual Stroke Play")!.name).toBe("Stroke Play");
  });

  it("distinguishes unknown from the fallback", () => {
    // findFormat falling back to Match Play once made needsCourseData answer
    // "no course needed" for a format it had never heard of.
    expect(lookupFormat("Some Future Format")).toBeUndefined();
    expect(isKnownFormat("Some Future Format")).toBe(false);
    expect(findFormat("Some Future Format").name).toBe("Match Play");
  });
});

describe("what a format implies", () => {
  it("knows which formats share one card", () => {
    // This decides the scorecard shape: one card for the side, or one each.
    expect(sharesOneCard("Foursomes")).toBe(true);
    expect(sharesOneCard("Scramble")).toBe(true);
    expect(sharesOneCard("Four-Ball")).toBe(false); // everyone plays their own ball
    expect(sharesOneCard("Shamble")).toBe(false);
    expect(sharesOneCard("Stroke Play")).toBe(false);
  });

  it("reports side size as a range", () => {
    expect(sideSizeRange("Stroke Play")).toEqual({ min: 1, max: 1 });
    expect(sideSizeRange("Four-Ball")).toEqual({ min: 2, max: 2 });
    expect(sideSizeRange("Best Ball")).toEqual({ min: 2, max: 4 });
    expect(sideSizeRange("Scramble")).toEqual({ min: 4, max: 4 });
  });
});

describe("playingHandicap", () => {
  it("applies the format's allowance", () => {
    expect(playingHandicap(20, "Stroke Play")).toBe(19); // 95%
    expect(playingHandicap(20, "Match Play")).toBe(20); // 100%
    expect(playingHandicap(20, "Four-Ball")).toBe(18); // 90%
  });

  it("honours a committee override", () => {
    // Allowances are recommendations; a committee may set its own.
    expect(playingHandicap(20, "Stroke Play", 100)).toBe(20);
    expect(playingHandicap(20, "Stroke Play", 0)).toBe(0);
  });

  it("rounds to whole strokes", () => {
    expect(playingHandicap(9, "Stroke Play")).toBe(9); // 8.55 -> 9
    expect(playingHandicap(7, "Four-Ball")).toBe(6); // 6.3 -> 6
  });

  it("handles a scratch player", () => {
    expect(playingHandicap(0, "Scramble")).toBe(0);
  });
});
