import { describe, it, expect } from "vitest";
import { startHint } from "@/components/NewMatchForm";
import { readSource } from "./source";

/**
 * THE LINE BESIDE THE START BUTTON NEVER CONTRADICTS THE RED LINE ABOVE IT.
 *
 * Walked at 393px on 2026-10-04: Match Play, two names typed, Skins chosen,
 * no stake. Above the disabled button, in red: "How much is the skins for?
 * Put a stake in…". Beside it: "2 names, and you're away." Both on screen at
 * once, and the second sends somebody back to the names they had already
 * typed — while the stake box showed a grey "5" that looked filled in.
 */
const base = { blocker: "", ready: false, roundName: "", courseChosen: false, formatChosen: true, exact: 2 };

describe("startHint", () => {
  it("says nothing while a blocker is showing — the blocker is the step left", () => {
    expect(startHint({ ...base, blocker: "How much is the skins for? Put a stake in." })).toBe("");
    // Whatever else is true: even a ready round with a course says nothing over a blocker.
    expect(startHint({ ...base, blocker: "x", ready: true, courseChosen: true, roundName: "A v B" })).toBe("");
  });

  it("names the step that IS left when nothing is blocking", () => {
    expect(startHint({ ...base, formatChosen: false })).toBe("Pick what you're playing, then who's in it.");
    expect(startHint(base)).toBe("2 names, and you're away.");
    expect(startHint({ ...base, exact: null })).toBe("Two names is enough to start.");
    expect(startHint({ ...base, ready: true })).toBe("Say where you're playing.");
    expect(startHint({ ...base, ready: true, courseChosen: true, roundName: "A v B" })).toBe("Opens the card for A v B.");
  });

  it("an example in a box says it is an example, so it cannot pass for an entry", () => {
    const form = readSource("src", "components", "NewMatchForm.tsx");
    expect(form).toContain('placeholder="e.g. 5"');
    expect(form).toContain('placeholder="e.g. 12.4"');
    expect(form).not.toMatch(/placeholder="\d/);
  });
});
