import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isManualFormat,
  GOLF_FORMATS,
  FORMAT_NAMES,
  SCORED_FORMAT_NAMES,
  PLAYABLE_FORMAT_NAMES,
  isPlayable,
  TEAM_FORMAT_NAMES,
  findFormat,
  lookupFormat,
  isKnownFormat,
  needsTeams,
  boardKind,
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

  it("never claims a format is playable without an engine", () => {
    // playable is the stronger claim: engine *and* score entry *and* a
    // leaderboard. The reverse is allowed and currently common.
    //
    // The one exemption is a MANUAL format, which is playable precisely
    // because it makes no scoring claim at all — the app holds the round and
    // the committee works out the result. It is exempt from needing an engine
    // and only from that; the tests below stop the exemption from becoming a
    // way to ship a half-built format.
    for (const f of GOLF_FORMATS) {
      if (f.playable && !f.manual) expect(f.scored, `${f.name} is playable but unscored`).toBe(true);
    }
  });

  it("keeps the manual escape hatch to exactly one format", () => {
    // "We can't score this" is an escape hatch, not a category. A second one
    // would mean somebody used it to avoid writing an engine.
    const manual = GOLF_FORMATS.filter((f) => f.manual);
    expect(manual).toHaveLength(1);
    expect(manual[0].name).toBe("Other (scored by hand)");
  });

  it("keeps the manual format out of the scored list", () => {
    // If it ever appeared here, something would try to rank it.
    expect(SCORED_FORMAT_NAMES).not.toContain("Other (scored by hand)");
    expect(findFormat("Other (scored by hand)").scored).toBe(false);
  });

  it("gives a reason for every format that is scored but not playable", () => {
    // Without one the picker greys an option out and says nothing, which reads
    // as a bug rather than as a roadmap.
    for (const f of GOLF_FORMATS) {
      if (f.scored && !f.playable) {
        expect(f.pendingReason, `${f.name} needs a pendingReason`).toBeTruthy();
      }
    }
  });

  it("offers only what can be run end to end", () => {
    // The narrower list is what the round picker reads. Match play and stroke
    // play are wired through entry and the leaderboard; nothing else is yet.
    // Every format in the catalog is now runnable end to end, bar one.
    expect(PLAYABLE_FORMAT_NAMES).toContain("Match Play");
    expect(PLAYABLE_FORMAT_NAMES).toContain("Stroke Play");
    expect(isPlayable("Scramble")).toBe(true);
    expect(isPlayable("Four-Ball")).toBe(true);
    expect(isPlayable("Skins")).toBe(true);
    expect(isPlayable("Nassau")).toBe(true);
    expect(isPlayable("Modified Stableford")).toBe(true);
    // The exception, and deliberately so: Stableford is reachable as a scoring
    // basis on a Stroke Play round, which is how the engine models it. Two
    // doors to one room, one of them locked, would be worse than one door.
    expect(isPlayable("Stableford")).toBe(false);
    expect(isPlayable("Some Future Format")).toBe(false);
    expect(isPlayable("Some Future Format")).toBe(false);
  });

  it("keeps playable a strict subset of scored, bar the manual hatch", () => {
    for (const name of PLAYABLE_FORMAT_NAMES) {
      if (isManualFormat(name)) continue;
      expect(SCORED_FORMAT_NAMES, `${name} must also be scored`).toContain(name);
    }
    // Some formats have an engine but no way to run them yet, so the scored
    // list stays ahead of the playable one. Counted without the manual hatch,
    // which is playable while deliberately unscored and would otherwise mask
    // the day those two lists converge.
    const playableScored = PLAYABLE_FORMAT_NAMES.filter((n) => !isManualFormat(n));
    expect(playableScored.length).toBeLessThan(SCORED_FORMAT_NAMES.length);
  });

  it("stops a manual round reaching a scoring engine", () => {
    // The failure this prevents: a hand-scored round falling through to the
    // stroke engine and producing a leaderboard that ranks the field on
    // strokes nobody was playing for — indistinguishable, on screen, from a
    // real result. So the check has to come FIRST, before the team branch and
    // before anything reads .engine.
    //
    // The ordering used to live inline in the leaderboard, which is why this
    // test read that file. It now lives in `boardKind` — because Reports and
    // /live have to make the same decision and made it differently (D8) — so
    // the ordering is asserted where it is, plus behaviourally below.
    const formats = readFileSync(join(process.cwd(), "src/lib/formats.ts"), "utf8");
    const fn = formats.slice(formats.indexOf("export function boardKind"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    const manualAt = body.indexOf("isManualFormat");
    const teamsAt = body.indexOf("needsTeams");
    const engineAt = body.indexOf(".engine");
    expect(manualAt).toBeGreaterThan(-1);
    expect(manualAt, "manual check must precede the team branch").toBeLessThan(teamsAt);
    expect(manualAt, "manual check must precede any engine read").toBeLessThan(engineAt);
  });

  it("calls a manual round manual whatever else it looks like", () => {
    // The behavioural half of the check above, which no amount of moving the
    // code around can quietly break.
    for (const name of PLAYABLE_FORMAT_NAMES) {
      if (!isManualFormat(name)) continue;
      expect(boardKind(name), `${name} must never reach a scoring board`).toBe("manual");
    }
  });

  it("sends every scored format to a board that can read it", () => {
    // The other half: nothing playable may fall through to the standard board
    // unless the standard board is actually right for it.
    for (const name of PLAYABLE_FORMAT_NAMES) {
      const kind = boardKind(name);
      if (isManualFormat(name)) continue;
      if (needsTeams(name)) expect(kind, name).toBe("team");
      else expect(["skins", "nassau", "modified-stableford", "standard"]).toContain(kind);
    }
  });

  it("stops the weekly league sheet ranking a manual round either", () => {
    // Found the hard way: the leaderboard refused to rank a hand-scored round
    // while /week happily aggregated the same cards and ranked a Flag day on
    // net strokes. Every surface that produces an ordering needs the check,
    // not just the one named "leaderboard".
    const week = readFileSync(join(process.cwd(), "src/lib/services/week-view.ts"), "utf8");
    expect(week).toMatch(/isManualFormat\(stage\.format\)/);
    // The cards must not be aggregated at all for such a round.
    expect(week).toMatch(/manual \? \[\] : parseStrokeCards/);
  });

  it("points Stableford at the scoring basis rather than the format", () => {
    // Stableford is already runnable as a basis on a Stroke Play round, which
    // is how the engine models it. Offering it as a format too would be two
    // doors to the same room, one of which doesn't open.
    const s = findFormat("Stableford");
    expect(s.playable).toBe(false);
    expect(s.pendingReason).toMatch(/stroke play/i);
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
