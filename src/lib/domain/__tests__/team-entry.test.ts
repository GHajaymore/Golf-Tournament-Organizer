import { describe, it, expect } from "vitest";
import {
  teamEntryChoices,
  declaredTeamEntry,
  resolveTeamEntry,
  sideOnlyCost,
  TEAM_ENTRY_MODES,
} from "../team-entry";
import { GOLF_FORMATS, needsTeams, findFormat } from "@/lib/formats";

/**
 * Whose card a team round is written on.
 *
 * Asserted against the Rules — foursomes is Rule 22, four-ball is Rule 23 —
 * and against the decision in docs/requirement-team-score-entry.md, never
 * against what the code happens to do.
 */

describe("one ball, one card", () => {
  // Rule 22: the side plays ONE ball, alternating strokes. There is no such
  // thing as a player's gross for the hole; there is the side's.
  const oneBall = ["Foursomes", "Alternate Shot", "Greensomes", "Chapman / Pinehurst", "Scramble", "Texas Scramble"];

  it("offers only the side's card, for every shared-ball format", () => {
    for (const f of oneBall) {
      expect(teamEntryChoices(f), f).toEqual(["side-only"]);
    }
  });

  it("does not offer per-player entry — the choice does not exist", () => {
    // Not a restriction. Recording "player A had a 5" in foursomes would
    // invent a round nobody played, which match-cards.ts already refuses to do.
    for (const f of oneBall) {
      expect(teamEntryChoices(f).includes("per-player"), f).toBe(false);
    }
  });

  it("warns about nothing, because nothing is given up", () => {
    // A foursomes round is not an individual round and never was a counting
    // score. A warning here would imply something had been lost.
    for (const f of oneBall) {
      expect(sideOnlyCost(f), f).toBeNull();
    }
  });
});

describe("two balls, two cards", () => {
  // Rule 23: each player plays their own ball throughout. Both scores are real
  // and both are on the paper card.
  const twoBall = ["Four-Ball", "Best Ball"];

  it("takes each player's own card as the natural shape", () => {
    for (const f of twoBall) {
      expect(declaredTeamEntry(f), f).toBe("per-player");
    }
  });

  it("still allows the side's score alone, because that only loses detail", () => {
    // The override may REDUCE detail; it may never invent it. A club in a
    // hurry recording the better ball has typed nothing that is not real.
    for (const f of twoBall) {
      expect(teamEntryChoices(f), f).toEqual(["per-player", "side-only"]);
    }
  });

  it("says what that costs, in the words a committee needs", () => {
    // Under WHS a four-ball counts for handicapping when the player's own ball
    // is recorded. Choosing team-only gives that up for the whole field, and
    // nothing about the entry screen afterwards looks any different.
    for (const f of twoBall) {
      const cost = sideOnlyCost(f)!;
      expect(cost, f).toContain("handicap");
      expect(cost, f).toContain("whole field");
    }
  });
});

describe("formats with no side at all", () => {
  it("asks nothing of an individual format", () => {
    for (const f of ["Stroke Play", "Match Play", "Stableford", "Skins"]) {
      expect(teamEntryChoices(f), f).toEqual([]);
      expect(declaredTeamEntry(f), f).toBeNull();
      expect(resolveTeamEntry(f, "side-only"), f).toBeNull();
    }
  });
});

describe("an override the format does not offer", () => {
  it("falls back rather than being honoured", () => {
    // A stored "per-player" on a foursomes round — set before somebody changed
    // the format, or posted straight at the endpoint — must not open a screen
    // asking for two scores where one ball was played.
    expect(resolveTeamEntry("Foursomes", "per-player")).toBe("side-only");
    expect(resolveTeamEntry("Foursomes", "nonsense")).toBe("side-only");
    expect(resolveTeamEntry("Foursomes", "")).toBe("side-only");
    expect(resolveTeamEntry("Foursomes", null)).toBe("side-only");
  });

  it("honours one the format does offer", () => {
    expect(resolveTeamEntry("Four-Ball", "side-only")).toBe("side-only");
    expect(resolveTeamEntry("Four-Ball", null)).toBe("per-player");
  });
});

describe("swept across the whole catalogue", () => {
  // Per CLAUDE.md this is the combinations class: a format added tomorrow is
  // answered the day it is added, because the rule reads `ball` rather than a
  // list somebody has to remember to extend.
  it("gives every team format a shape, and every individual one none", () => {
    for (const f of GOLF_FORMATS) {
      const choices = teamEntryChoices(f.name);
      if (needsTeams(f.name)) {
        expect(choices.length, f.name).toBeGreaterThan(0);
        // Whatever else is on offer, the side's card always is: it is the one
        // shape that exists for every team format.
        expect(choices.includes("side-only"), f.name).toBe(true);
      } else {
        expect(choices, f.name).toEqual([]);
      }
    }
  });

  it("offers per-player exactly when each player played their own ball", () => {
    // The rule and the fact, checked against each other across the catalogue
    // rather than trusted.
    for (const f of GOLF_FORMATS.filter((x) => needsTeams(x.name))) {
      const offersIndividual = teamEntryChoices(f.name).includes("per-player");
      expect(offersIndividual, f.name).toBe(findFormat(f.name).ball === "individual");
    }
  });

  it("warns exactly where there is a choice to regret", () => {
    for (const f of GOLF_FORMATS) {
      const hasChoice = teamEntryChoices(f.name).length > 1;
      expect(sideOnlyCost(f.name) !== null, f.name).toBe(hasChoice);
    }
  });

  it("has a label and a blurb for every mode it can return", () => {
    for (const mode of ["per-player", "side-only"] as const) {
      const entry = TEAM_ENTRY_MODES.find((m) => m.key === mode);
      expect(entry, mode).toBeTruthy();
      expect(entry!.blurb.length, mode).toBeGreaterThan(20);
    }
  });
});

describe("sharing Stage.scoreInput with the match-play axis", () => {
  it("never honours a value belonging to the other axis", async () => {
    // Both overrides live in one column, because a round is either a match
    // round or a team round and never both. What makes that safe is that each
    // resolver is TOTAL: handed a value it does not offer, it falls back to
    // its own natural shape rather than returning something the screen cannot
    // render. Asserted rather than assumed — this is the reason there is no
    // migration for this feature.
    const { resolveScoreInput } = await import("@/lib/formats");
    expect(resolveScoreInput("Match Play", "side-only")).toBe("hole-results");
    expect(resolveScoreInput("Stroke Play", "per-player")).toBe("gross-cards");
    expect(resolveTeamEntry("Four-Ball", "match-result")).toBe("per-player");
    expect(resolveTeamEntry("Foursomes", "gross-cards")).toBe("side-only");
  });
});
