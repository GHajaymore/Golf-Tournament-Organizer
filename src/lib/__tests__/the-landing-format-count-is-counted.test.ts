import { describe, it, expect } from "vitest";
import { readSource } from "./source";
import { GOLF_FORMATS, SAME_GAME_AS, distinctScoredGames, SCORED_GAME_COUNT } from "@/lib/formats";
import { FORMAT_NAMES } from "@/lib/landing/faq";

/**
 * "N formats" on the landing page, the FAQ, the features list and the guide is
 * ONE computed count (B45). It used to be typed as "sixteen" / "fifteen",
 * which counted "Alternate Shot" (Foursomes by another name) and
 * "Other (scored by hand)" as games the app scores.
 */
describe("the number of formats the landing claims", () => {
  it("is the hand-counted list of distinct games the app scores by itself", () => {
    // Counted by hand: Stroke Play, Stableford, Modified Stableford, Match Play,
    // Four-Ball, Best Ball, Foursomes, Greensomes, Chapman / Pinehurst, Shamble,
    // Scramble, Texas Scramble, Skins, Nassau. Alternate Shot is Foursomes under
    // another name; Other is scored by hand.
    const byHand = [
      "Stroke Play", "Stableford", "Modified Stableford", "Match Play", "Four-Ball", "Best Ball",
      "Foursomes", "Greensomes", "Chapman / Pinehurst", "Shamble", "Scramble", "Texas Scramble", "Skins", "Nassau",
    ];
    expect([...distinctScoredGames].sort()).toEqual([...byHand].sort());
    expect(SCORED_GAME_COUNT).toBe(14);
  });

  it("leaves out the alias and the hand-scored entry, and says so in the table", () => {
    expect(GOLF_FORMATS.length).toBe(16);
    expect(distinctScoredGames).not.toContain("Alternate Shot");
    expect(GOLF_FORMATS.filter((f) => !f.scored).map((f) => f.name)).toEqual(["Other (scored by hand)"]);
    for (const [alias, of] of Object.entries(SAME_GAME_AS)) expect(distinctScoredGames, alias).toContain(of);
  });

  it("is what the landing list shows: the scored games, then Other", () => {
    expect(FORMAT_NAMES).toHaveLength(SCORED_GAME_COUNT + 1);
  });

  it("is never typed in a landing file (control: the sweep sees the old words)", () => {
    const words = /\b(sixteen|fifteen)\b[^.\n]{0,30}formats?|formats?[^.\n]{0,20}\b(sixteen|fifteen)\b/i;
    expect(words.test("Sixteen formats, one leaderboard")).toBe(true);
    for (const f of ["src/app/page.tsx", "src/lib/landing/faq.tsx", "src/lib/landing/features.ts", "src/app/(app)/guide/page.tsx"]) {
      expect(words.test(readSource(f)), f).toBe(false);
    }
  });
});
