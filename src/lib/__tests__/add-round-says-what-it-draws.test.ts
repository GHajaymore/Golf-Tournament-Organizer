import { describe, it, expect } from "vitest";
import { STAGE_TYPES, addRoundConsequence, isHeadToHead, generatesPairings } from "@/lib/stage-types";

/**
 * THE LINE UNDER "ADD ROUND" IS TRUE OF THE TYPE BEING ADDED.
 *
 * Found 2026-09-26 setting up a club knockout from scratch: with Bracket
 * chosen, the Rounds screen said "No pairings are drawn — the field returns
 * cards" — the stroke-play sentence, because the screen split on
 * `generatesPairings` alone. Enumerated over every stage type, so a type added
 * later is checked the day it exists.
 */
describe("addRoundConsequence", () => {
  const types = STAGE_TYPES.map((t) => (typeof t === "string" ? t : (t as { key: string }).key));

  it("covers the types (control)", () => {
    expect(types).toContain("Bracket Stage");
    expect(types).toContain("Stroke Play Round");
  });

  it.each(types)("%s: never tells a head-to-head round that the field returns cards", (type) => {
    const line = addRoundConsequence(type);
    if (isHeadToHead(type)) expect(line).not.toMatch(/returns cards/);
    else expect(line).not.toMatch(/head to head/);
  });

  it.each(types)("%s: promises pairings exactly when the scheduler draws them", (type) => {
    expect(/full set of pairings/.test(addRoundConsequence(type))).toBe(generatesPairings(type));
  });

  it("calls a bracket a knockout", () => {
    expect(addRoundConsequence("Bracket Stage")).toMatch(/knockout/);
  });

  it("says a stroke round returns cards", () => {
    expect(addRoundConsequence("Stroke Play Round")).toMatch(/returns cards/);
  });

  it("promises nothing head to head for a type nobody taught it", () => {
    expect(addRoundConsequence("Something New")).toMatch(/returns cards/);
  });
});
