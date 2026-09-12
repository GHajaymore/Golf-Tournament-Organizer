import { describe, it, expect } from "vitest";
import { readSource } from "./source";
import {
  STAGE_TYPES,
  STAGE_TYPE_INFO,
  STAGE_DESCRIPTIONS,
  isStageType,
  stageTypeInfo,
  lookupStageType,
  generatesPairings,
  isPlayingRound,
  nextPlayingStage,
  isStructuralStage,
  STRUCTURAL_STAGE_TYPES,
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

describe("the next round the field plays", () => {
  // A Round Robin followed by a stroke-play final has a next round, of a
  // different format. Looking only for the next Round Robin missed it, so the
  // round reported "No round after this yet" and could not be cut into.
  const stages = [
    { position: 0, type: "Round Robin" },
    // An unknown type, which is what a stage row written by an older build
    // looks like once a type is retired — "Qualification Stage" was one until
    // 2026-09-11. nextPlayingStage must step over it rather than stop at it.
    { position: 1, type: "Retired Stage Type" },
    { position: 2, type: "Stroke Play Round" },
    { position: 3, type: "Bracket Stage" },
  ];

  it("finds a following round of a different format", () => {
    // Steps over the retired type (unknown, so not a playing round) and lands
    // on the stroke-play final.
    expect(nextPlayingStage(stages, 0)?.type).toBe("Stroke Play Round");
  });

  it("finds the next playing round after the stroke final too", () => {
    expect(nextPlayingStage(stages, 2)?.type).toBe("Bracket Stage");
  });

  it("reports none when nothing playable follows", () => {
    expect(nextPlayingStage(stages, 3)).toBeUndefined();
  });

  it("ignores play order in the array, going by position", () => {
    const shuffled = [stages[2], stages[0], stages[3], stages[1]];
    expect(nextPlayingStage(shuffled, 0)?.type).toBe("Stroke Play Round");
  });
});

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
    for (const key of ["Stroke Play Round", "Single Match Stage", "Bracket Stage"]) {
      expect(generatesPairings(key), key).toBe(false);
    }
  });

  it("counts every type as a round the field plays", () => {
    /**
     * TRUE OF ALL FOUR SINCE 2026-09-11, and it was not before. A
     * "Qualification Stage" was a cut rather than a round — the one type with
     * `isPlayingRound: false` — and every sweep in the app carried that
     * exception. It was removed (see `STAGE_TYPES` for why) and a good deal of
     * code got simpler with it, including the fallback `loadEventState` needed
     * for the case where no stage was a playing round.
     *
     * The FLAG stays, and so does this test, because another structural stage
     * is a plausible thing to add. What must not happen is one being added
     * without every reader learning about it — this goes red on the day.
     */
    for (const t of STAGE_TYPE_INFO) {
      expect(isPlayingRound(t.key), t.key).toBe(true);
    }
    // And a type nobody has taught the app about is never played, which is the
    // safe direction for a stage row written by an older build.
    expect(isPlayingRound("Qualification Stage")).toBe(false);
    expect(isPlayingRound("Shotgun")).toBe(false);
  });

  it("puts every type in exactly one group of the picker", () => {
    /**
     * THE FAILURE THIS CATCHES is a type appearing in BOTH groups of the "add a
     * round" picker, or in neither — which is what the old code invited: the
     * two groups were inverse conditions naming the same two types twice, and
     * editing one without the other silently duplicates or loses a type.
     *
     * One set decides both now. This asserts the partition rather than the
     * membership, so it holds however the set changes — and it is what a
     * mutation dropping Bracket Stage from `STRUCTURAL_STAGE_TYPES` failed to
     * trip before it existed.
     */
    const structural = STAGE_TYPE_INFO.filter((t) => isStructuralStage(t.key)).map((t) => t.key);
    const plays = STAGE_TYPE_INFO.filter((t) => !isStructuralStage(t.key)).map((t) => t.key);
    expect([...structural, ...plays].sort()).toEqual([...STAGE_TYPES].sort());
    expect(structural.filter((k) => plays.includes(k)), "in both groups").toEqual([]);
    // And neither group is empty, or the picker shows a heading over nothing.
    expect(structural.length).toBeGreaterThan(0);
    expect(plays.length).toBeGreaterThan(0);
  });

  it("counts a single match and a bracket as structure, and the rest as rounds", () => {
    /**
     * The membership itself, stated once. A single match is two players and a
     * bracket is a draw; neither is a round the whole field turns up for, which
     * is the distinction the picker's two headings make.
     */
    expect([...STRUCTURAL_STAGE_TYPES].sort()).toEqual(["Bracket Stage", "Single Match Stage"]);
    expect(isStructuralStage("Round Robin")).toBe(false);
    expect(isStructuralStage("Stroke Play Round")).toBe(false);
    // An unknown type is an ordinary round, which keeps a legacy row in the
    // group an organizer is actually looking at rather than hiding it.
    expect(isStructuralStage("Shotgun")).toBe(false);
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
  const read = (...p: string[]) => readSource(...p);

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
