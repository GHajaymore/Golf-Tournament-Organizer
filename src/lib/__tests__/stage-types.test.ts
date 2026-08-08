import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  STAGE_TYPES,
  STAGE_TYPE_INFO,
  STAGE_DESCRIPTIONS,
  isStageType,
  stageTypeInfo,
  lookupStageType,
  generatesPairings,
  isPlayingRound,
} from "../stage-types";

/**
 * What a round *is*, as opposed to how it is scored.
 *
 * The picker offered four raw enum strings and was missing the single most
 * common round in club golf: a medal. The only way to run one was a round
 * robin set to Stroke Play, which drew a full set of head-to-head pairings
 * for a round in which nobody plays anybody — matches that were never played
 * and could still be scored.
 */

describe("the catalogue", () => {
  it("has unique keys, and info for every one", () => {
    expect(new Set(STAGE_TYPES).size).toBe(STAGE_TYPES.length);
    expect(STAGE_TYPE_INFO.map((t) => t.key).sort()).toEqual([...STAGE_TYPES].sort());
  });

  it("gives every type a label, a blurb and a stored description", () => {
    for (const t of STAGE_TYPE_INFO) {
      expect(t.label.length, t.key).toBeGreaterThan(2);
      expect(t.blurb.length, t.key).toBeGreaterThan(10);
      expect(t.description.length, t.key).toBeGreaterThan(10);
      expect(t.icon, t.key).toMatch(/^ph /);
    }
  });

  it("includes the medal round clubs actually play", () => {
    expect(isStageType("Stroke Play Round")).toBe(true);
    expect(lookupStageType("Stroke Play Round")).toBeTruthy();
  });

  it("draws pairings ONLY for a round robin", () => {
    // The whole reason the type exists. A medal round has no opponents, and a
    // qualification marker is not played at all.
    expect(generatesPairings("Round Robin")).toBe(true);
    for (const key of ["Stroke Play Round", "Qualification Stage", "Single Match Stage", "Bracket Stage"]) {
      expect(generatesPairings(key), key).toBe(false);
    }
  });

  it("treats a qualification cut as structural, not as a round the field plays", () => {
    expect(isPlayingRound("Qualification Stage")).toBe(false);
    for (const key of ["Round Robin", "Stroke Play Round", "Single Match Stage", "Bracket Stage"]) {
      expect(isPlayingRound(key), key).toBe(true);
    }
  });

  it("chains match points only where there are match points", () => {
    const chaining = STAGE_TYPE_INFO.filter((t) => t.chainsMatchPoints).map((t) => t.key);
    expect(chaining).toEqual(["Round Robin"]);
  });

  it("refuses an unknown type rather than inventing one", () => {
    expect(isStageType("Shotgun")).toBe(false);
    expect(isStageType("")).toBe(false);
    expect(lookupStageType("Shotgun")).toBeUndefined();
  });

  it("defaults an unknown type to no pairings — the safe direction", () => {
    // A type nobody taught the scheduler about should draw nothing, rather
    // than a full round of fabricated matches.
    expect(generatesPairings("Shotgun")).toBe(false);
    expect(isPlayingRound("Shotgun")).toBe(false);
    // Display still falls back so a legacy row can't blank a screen.
    expect(stageTypeInfo("Shotgun").key).toBe("Round Robin");
  });

  it("keeps descriptions in step with the catalogue", () => {
    for (const t of STAGE_TYPE_INFO) {
      expect(STAGE_DESCRIPTIONS[t.key]).toBe(t.description);
    }
  });

  it("lists no format as if it were a type", () => {
    // Formats are the other axis and are chosen per round. Adding "Stableford"
    // or "Four-Ball" here would force an organizer to say the same thing twice
    // and make the two pickers contradict each other.
    const keys = STAGE_TYPES.map((k) => k.toLowerCase());
    for (const format of ["stableford", "four-ball", "scramble", "skins", "nassau", "foursomes"]) {
      expect(keys.some((k) => k.includes(format)), format).toBe(false);
    }
  });
});

describe("one catalogue, not two", () => {
  const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");

  it("the picker and the server action share it", () => {
    // A type offered in the UI but missing from the validator silently becomes
    // a Round Robin on save — the drift this replaces.
    expect(read("src", "components", "StagesClient.tsx")).toMatch(/from "@\/lib\/stage-types"/);
    expect(read("src", "app", "actions", "tournament.ts")).toMatch(/from "@\/lib\/stage-types"/);
  });

  it("neither keeps a private copy of the list", () => {
    expect(read("src", "components", "StagesClient.tsx")).not.toMatch(/const STAGE_TYPES = \[/);
    expect(read("src", "app", "actions", "tournament.ts")).not.toMatch(/const STAGE_TYPES = \[/);
  });

  it("the scheduler asks the catalogue instead of naming a type", () => {
    // regroup.ts previously drew pairings for every Round Robin stage and
    // asked nothing else.
    expect(read("src", "lib", "services", "regroup.ts")).toMatch(/generatesPairings\(/);
  });

  it("score entry reaches every played round, not just the round-robin chain", () => {
    // Keying the round selector off rrStages made a medal round unreachable:
    // it has no pairings, so it never appeared, so its cards could not be
    // entered.
    expect(read("src", "app", "(app)", "entry", "page.tsx")).toMatch(/state\.playRounds/);
  });

  it("the domain union knows about it too", () => {
    expect(read("src", "lib", "domain", "types.ts")).toMatch(/"Stroke Play Round"/);
  });
});
