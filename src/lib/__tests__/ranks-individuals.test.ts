import { describe, it, expect } from "vitest";
import { ranksIndividuals, boardKind, usesStandardBoard, GOLF_FORMATS } from "@/lib/formats";

/**
 * Which rounds give a player a POSITION.
 *
 * `/me` printed one for every round, in forty-point type, by calling
 * `standingRows` unconditionally — so a skins player was told "Position T1"
 * beside a leaderboard that refuses to rank a skins round at all, and a Nassau
 * player the same. A skins round pays holes and a Nassau is three separate
 * bets; neither has a finishing order to be first in.
 */
describe("rounds that rank individuals", () => {
  it("ranks an ordinary stroke or match round", () => {
    expect(ranksIndividuals("Stroke Play")).toBe(true);
    expect(ranksIndividuals("Match Play")).toBe(true);
  });

  it("ranks a Modified Stableford round, which is why this is not usesStandardBoard", () => {
    /**
     * The distinction that makes this a separate reader. Modified Stableford
     * has its own points table, so `usesStandardBoard` is false for it — but a
     * player in one very much has a position, and gating on the narrower
     * question would have taken it away from them.
     */
    const modified = GOLF_FORMATS.find((f) => boardKind(f.name) === "modified-stableford");
    expect(modified, "no modified-stableford format to check").toBeTruthy();
    expect(usesStandardBoard(modified!.name)).toBe(false);
    expect(ranksIndividuals(modified!.name)).toBe(true);
  });

  it("refuses the four kinds no board will rank", () => {
    for (const kind of ["skins", "nassau", "team", "manual"] as const) {
      const format = GOLF_FORMATS.find((f) => boardKind(f.name) === kind);
      expect(format, `no ${kind} format to check`).toBeTruthy();
      expect(ranksIndividuals(format!.name), `${format!.name} (${kind})`).toBe(false);
    }
  });

  it("agrees with boardKind for every format in the catalogue", () => {
    // Swept rather than listed, so a format added later is judged the day it
    // arrives instead of whenever somebody remembers this file.
    for (const f of GOLF_FORMATS) {
      const kind = boardKind(f.name);
      const expected = kind === "standard" || kind === "modified-stableford";
      expect(ranksIndividuals(f.name), `${f.name} is ${kind}`).toBe(expected);
    }
  });

  it("treats an unknown format as rankable, which is what it already did", () => {
    // `boardKind` returns "standard" for anything it does not recognise, and
    // this must not quietly become a refusal — a round the app cannot name is
    // still a round somebody is playing.
    expect(ranksIndividuals("")).toBe(true);
    expect(ranksIndividuals(null)).toBe(true);
    expect(ranksIndividuals("Something New")).toBe(true);
  });
});
