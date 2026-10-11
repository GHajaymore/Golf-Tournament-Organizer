import { describe, it, expect } from "vitest";
import { FORMATION_RULES, formGroups, formationReadsHandicap, type Player } from "../domain";
import { readSource } from "./source";

/**
 * THE DRAW WARNING KNOWS EVERY DRAW THAT READS HANDICAPS (sweep 1, b13,
 * 2026-10-10).
 *
 * Flights drawn on handicap are drawn on COURSE handicaps, so tees with no
 * Course Rating or Slope make them quietly uneven — and Flights & groups
 * warns about it. It warned under "Spread by handicap" only. Two more rules
 * read handicaps: "Handicap divisions", which is what a medal starts on, and
 * "Balanced skills". A club dividing its medal into divisions off unrated
 * tees was told nothing.
 *
 * The warning named one rule by its spelling. `formationReadsHandicap` is
 * pinned here to what `formGroups` actually does: for every rule there is,
 * the same field with its handicaps turned upside down draws differently
 * exactly when the rule is said to read them.
 */

const field = (handicaps: number[]): Player[] =>
  handicaps.map((handicap, i) => ({ id: `p${i + 1}`, name: `p${i + 1}`, handicap, seed: i + 1, groupId: "" }));

// Twelve players; seeds 1..12 in both. Only the handicaps differ.
const RISING = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24];
const FALLING = [...RISING].reverse();

/** A fixed "shuffle", so Random draws the same way twice. */
const steady = () => 0.37;
const drawn = (handicaps: number[], rule: (typeof FORMATION_RULES)[number]) =>
  JSON.stringify(formGroups(field(handicaps), rule, { mode: "count", value: 3 }, (i) => `g${i}`, steady).map((g) => g.playerIds));

describe("which flight rules read handicaps", () => {
  it("CONTROL: the sweep covers every rule the save accepts, by reading the save's own list", () => {
    // The action validates against this very array, so a rule cannot be
    // saveable and unswept.
    expect(readSource("src/app/actions/tournament.ts")).toContain("(FORMATION_RULES as string[]).includes(rule)");
    expect(FORMATION_RULES.length).toBeGreaterThanOrEqual(6);
    expect(drawn(RISING, "divisions"), "the fixture drew one flight, so nothing could differ").toContain("],[");
  });

  for (const rule of FORMATION_RULES) {
    it(`"${rule}": said to read handicaps exactly when the draw changes with them`, () => {
      const changes = drawn(RISING, rule) !== drawn(FALLING, rule);
      expect(formationReadsHandicap(rule)).toBe(changes);
    });
  }

  it("CONTROL: some rules do and some do not", () => {
    expect(new Set(FORMATION_RULES.map((r) => formationReadsHandicap(r))).size).toBe(2);
  });

  it("the unrated-tees warning asks that, and no longer names one rule", () => {
    const src = readSource("src/lib/services/handicaps.ts");
    const body = src.slice(src.indexOf("export async function unratedFlightWarning"));
    expect(body.slice(0, 500)).toContain("formationReadsHandicap(formationRule)");
    expect(body.slice(0, 500)).not.toContain('formationRule !== "handicap"');
  });

  it("and the save accepts the one list rather than a copy of it", () => {
    const saved = readSource("src/app/actions/tournament.ts");
    expect(saved).not.toContain('const FORMATION_RULES = [');
  });
});
