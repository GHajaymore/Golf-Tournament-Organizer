import { describe, it, expect } from "vitest";
import { roundUnit } from "../round-unit";

/**
 * A STABLEFORD ROUND IS NOT WON BY THE LOWEST SCORE.
 *
 * The case that produced this, read off the seeded club's Thursday league on
 * 2026-09-19: seven rounds of format "Stableford" with `scoringBasis: "net"`.
 * A reader that asks the BASIS sees "net" and ranks ascending — so the winner
 * of a points competition was whoever scored fewest. The board two lines above
 * said "Ranked by Stableford points" and was right.
 *
 * Asserted against golf, not against the code: points are won by the most,
 * strokes by the fewest, and no basis can change which.
 */

describe("what a round is ranked in", () => {
  it("is points for a Stableford round, however its basis is filed", () => {
    for (const basis of ["net", "gross", "stableford", "", undefined]) {
      const u = roundUnit({ format: "Stableford", scoringBasis: basis });
      expect(u.label, String(basis)).toBe("pts");
      expect(u.higherWins, String(basis)).toBe(true);
    }
  });

  it("is points for modified Stableford too", () => {
    const u = roundUnit({ format: "Modified Stableford", scoringBasis: "net" });
    expect(u.label).toBe("pts");
    expect(u.higherWins).toBe(true);
  });

  it("is strokes for a medal, and the basis decides which strokes", () => {
    expect(roundUnit({ format: "Stroke Play", scoringBasis: "net" })).toEqual({
      label: "net",
      higherWins: false,
    });
    expect(roundUnit({ format: "Stroke Play", scoringBasis: "gross" })).toEqual({
      label: "gross",
      higherWins: false,
    });
  });

  it("treats a missing basis as net, which is what every club plays", () => {
    expect(roundUnit({ format: "Stroke Play" }).label).toBe("net");
    expect(roundUnit({ format: "Stroke Play", scoringBasis: null }).label).toBe("net");
  });

  it("ranks a team round by points only when it is played for points", () => {
    // A four-ball is a match or a medal depending on its round; the basis is
    // what says which, and `standingsUnit` already draws that line.
    expect(roundUnit({ format: "Four-Ball", scoringBasis: "stableford" }).higherWins).toBe(true);
    expect(roundUnit({ format: "Four-Ball", scoringBasis: "net" }).higherWins).toBe(false);
  });

  it("never says a round is won by the fewest points", () => {
    // The invariant the whole file exists for, over every format the app
    // offers: a points unit and an ascending sort cannot both be true.
    for (const format of ["Stableford", "Modified Stableford", "Stroke Play", "Four-Ball", "Best Ball"]) {
      for (const basis of ["net", "gross", "stableford"]) {
        const u = roundUnit({ format, scoringBasis: basis });
        expect(u.label === "pts" ? u.higherWins : !u.higherWins, `${format}/${basis}`).toBe(true);
      }
    }
  });
});
