import { describe, it, expect } from "vitest";
import { readSource } from "./source";
import { GOLF_FORMATS, SAME_GAME_AS, SCORED_GAME_LABELS, distinctScoredGames, SCORED_GAME_COUNT } from "@/lib/formats";
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
    // The alias table must not be empty, or the loop below proves nothing.
    expect(SAME_GAME_AS["Alternate Shot"]).toBe("Foursomes");
    for (const [alias, of] of Object.entries(SAME_GAME_AS)) expect(distinctScoredGames, alias).toContain(of);
  });

  it("only calls two entries one game when the table scores them identically", () => {
    for (const [alias, of] of Object.entries(SAME_GAME_AS)) {
      const a = GOLF_FORMATS.find((f) => f.name === alias)!;
      const b = GOLF_FORMATS.find((f) => f.name === of)!;
      for (const k of ["family", "engine", "ball", "sideSize", "allowance", "scored"] as const) {
        expect(a[k], `${alias} vs ${of}: ${k}`).toEqual(b[k]);
      }
    }
  });

  it("is what the landing list shows: one label per game, the alias inside its game's, then Other", () => {
    expect(SCORED_GAME_LABELS).toHaveLength(SCORED_GAME_COUNT);
    expect(SCORED_GAME_LABELS).toContain("Foursomes (Alternate Shot)");
    expect(FORMAT_NAMES).toEqual([...SCORED_GAME_LABELS, "Other, scored by hand"]);
  });

  it("is rendered from the shared list in the guide, not typed there", () => {
    const guide = readSource("src/app/(app)/guide/page.tsx");
    expect(guide).toMatch(/SCORED_GAME_LABELS/);
    expect(guide).not.toMatch(/"Stableford"|"Greensomes"|"Alternate Shot"/);
    // The import sits with the others, not in the middle of the file.
    expect(guide.indexOf("@/lib/formats")).toBeLessThan(guide.indexOf("const P = "));
  });

  it("is never typed in a landing file (control: the sweep sees number words and digits)", () => {
    const n = String.raw`(?:\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)`;
    const typed = new RegExp(String.raw`\b${n}\b[^.\n<>{}]{0,20}\bformats?\b|\bformats?\s*[:=(]\s*${n}\b`, "i");
    for (const bad of ["Sixteen formats, one leaderboard", "16 formats settle", "fifteen scored formats", "formats: 14"]) {
      expect(typed.test(bad), bad).toBe(true);
    }
    expect(typed.test("{SCORED_GAME_COUNT} formats settle onto one leaderboard")).toBe(false);
    for (const f of ["src/app/page.tsx", "src/lib/landing/faq.tsx", "src/lib/landing/features.ts", "src/app/(app)/guide/page.tsx"]) {
      expect(typed.test(readSource(f)), f).toBe(false);
    }
  });
});
