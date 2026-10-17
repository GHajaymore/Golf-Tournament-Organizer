import { describe, it, expect } from "vitest";
import { plateEntrants } from "@/lib/domain/bracket";

/**
 * A PLATE TAKES THE LOSERS OF THE FIRST-ROUND TIES ACTUALLY PLAYED (2026-10-16).
 * The Bracket screen counted the plate at the draw, where it is empty, and said
 * "To Plate 0" over sixteen qualifiers. A bye is a tie nobody loses.
 */
describe("how many go into a plate", () => {
  it("is the field less the byes, worked by hand", () => {
    expect(plateEntrants(16)).toBe(8);
    expect(plateEntrants(12)).toBe(4); // a sheet of 16: four byes, four ties
    expect(plateEntrants(9)).toBe(1); // a sheet of 16: seven byes, one tie
    expect(plateEntrants(32)).toBe(16);
    expect(plateEntrants(2)).toBe(1);
  });
  it("nobody, with nobody to lose", () => {
    expect(plateEntrants(0)).toBe(0);
    expect(plateEntrants(1)).toBe(0);
  });
});
