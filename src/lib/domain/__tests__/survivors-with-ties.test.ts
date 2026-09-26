import { describe, it, expect } from "vitest";
import { survivorsWithTies, type CutRule } from "../cut";

/**
 * "TOP N AND TIES" — Ajay's call for a stroke-play cut, 2026-09-26.
 *
 * Everybody level on the last surviving place goes through. "Level" is the
 * standings' own rank, which the countback has already separated where it
 * can — so these fixtures give tied players the SAME rank, as the engine does.
 */
const top = (count: number, scope: CutRule["scope"] = "overall"): CutRule => ({ scope, mode: "count", count, percent: 50 });
const row = (id: string, rank: number, groupId: string | null = null) => ({ id, rank, groupId });

describe("survivorsWithTies", () => {
  it("takes exactly N when nobody is level on the last place (control)", () => {
    const field = [row("a", 1), row("b", 2), row("c", 3), row("d", 4)];
    expect([...survivorsWithTies(field, top(2))]).toEqual(["a", "b"]);
  });

  it("takes everybody level on the last surviving place", () => {
    // Top 2 of a field where 2nd is shared three ways: four go through.
    const field = [row("a", 1), row("b", 2), row("c", 2), row("d", 2), row("e", 5)];
    expect([...survivorsWithTies(field, top(2))].sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("does not stretch to a tie BELOW the last place", () => {
    // 3rd and 4th are level, but the cut is to 2: they are both out.
    const field = [row("a", 1), row("b", 2), row("c", 3), row("d", 3)];
    expect([...survivorsWithTies(field, top(2))]).toEqual(["a", "b"]);
  });

  it("never sends through a player without a position", () => {
    const field = [row("a", 1), row("b", 0), row("c", 2)];
    expect([...survivorsWithTies(field, top(2))].sort()).toEqual(["a", "c"]);
  });

  it("applies per flight inside each flight", () => {
    const field = [row("a", 1, "f1"), row("b", 2, "f2"), row("c", 3, "f1"), row("d", 3, "f2"), row("e", 5, "f2")];
    // Top 1 of each flight: a from f1; in f2, b holds the place alone.
    expect([...survivorsWithTies(field, top(1, "perFlight"))].sort()).toEqual(["a", "b"]);
  });
});
