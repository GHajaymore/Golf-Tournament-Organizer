import { describe, it, expect } from "vitest";
import { fieldEnteringRound, describeCut } from "../domain/cut";
import type { RoundCutFields } from "../domain/cut";
import { readSource } from "./source";

/**
 * Fixes from the round-1 audit that live in less-swept corners. The bracket
 * split-flight fix has its own file (bracket-finish-order-combined); this covers
 * the cut denominator/description, and pins the money and free-text bounds that
 * are enforced at a server-action sink a unit test can't reach directly.
 */

const round = (o: Partial<RoundCutFields> = {}): RoundCutFields => ({
  cutEnabled: false,
  cutMode: "count",
  cutCount: 0,
  cutPercent: 0,
  cutScope: "overall",
  ...o,
});

describe("fieldEnteringRound: a per-flight cut after an overall cut errs high, never over 100%", () => {
  it("keeps the remaining field rather than collapsing to min(count, total)", () => {
    const rounds = [
      round(),
      round({ cutEnabled: true, cutScope: "overall", cutMode: "count", cutCount: 4 }),
      round({ cutEnabled: true, cutScope: "perFlight", cutMode: "count", cutCount: 2 }),
    ];
    // Overall cut leaves 4 and erases the flight split. The per-flight cut's true
    // size is 2 × (surviving flights); unknown here, so the denominator must not
    // drop below the survivors or the progress bar reads "cards in 4/2" — over
    // 100%. It now errs high (keeps 4) rather than low (2).
    expect(fieldEnteringRound(rounds, 2, { total: 8, flights: [4, 4] })).toBe(4);
  });

  it("still sizes a per-flight cut correctly while the flights are known", () => {
    const rounds = [
      round(),
      round({ cutEnabled: true, cutScope: "perFlight", cutMode: "count", cutCount: 2 }),
    ];
    // Top 2 of each of two flights of four = 4 — unchanged by the fix.
    expect(fieldEnteringRound(rounds, 1, { total: 8, flights: [4, 4] })).toBe(4);
  });
});

describe("describeCut clamps a per-flight total to the field", () => {
  it("never claims more advance than exist", () => {
    const line = describeCut({ scope: "perFlight", mode: "count", count: 16, percent: 0 }, 16, 2);
    expect(line).toContain("16 in total");
    expect(line).not.toContain("32 in total");
  });
  it("leaves an honest total alone", () => {
    const line = describeCut({ scope: "perFlight", mode: "count", count: 2, percent: 0 }, 16, 2);
    expect(line).toContain("4 in total");
  });
});

describe("the money and free-text bounds are in place at their sinks", () => {
  it("caps the skins buy-in by the shared ceiling, like side-games and contests", () => {
    expect(readSource("src/app/actions/skins.ts")).toContain("MAX_EXPENSE_CENTS");
  });
  it("computes a side's playing handicap off the players who are not withdrawn", () => {
    const src = readSource("src/lib/services/teams.ts");
    expect(src).toContain("const playing = members.filter");
    expect(src).toContain("forHandicap");
  });
  it("length-bounds the quick-match player name and match title", () => {
    const src = readSource("src/lib/domain/quick-match.ts");
    expect(src).toContain("PLAYER_NAME_MAX");
    expect(src).toContain("MATCH_TITLE_MAX");
  });
});
