import { describe, it, expect } from "vitest";
import { NAV } from "@/lib/nav";
import { readSource } from "./source";

/**
 * NOBODY CALLS IT "THE FIELD" (Ajay, 2026-10-16: "I dont know what is field in
 * registrations and field"). The screen is Entries, the section is Tell players,
 * and the setup questions ask about players — the review panel's names. A word an
 * organizer has to look up does not belong in the menu or the guided steps.
 */
const FIELD = /\bfield\b/i;

describe("the menu and the setup steps speak plainly", () => {
  it("no sidebar section or item says 'field'", () => {
    const labels = NAV.flatMap((s) => [s.label, ...s.items.map((i) => i.label)]).filter(Boolean);
    expect(labels.length, "the sweep found no labels to read").toBeGreaterThan(10);
    expect(labels.filter((l) => FIELD.test(l))).toEqual([]);
  });

  it("no setup step asks about 'the field'", () => {
    const src = readSource("src", "lib", "domain", "setup-flow.ts");
    const questions = [...src.matchAll(/question:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(questions.length, "the sweep found no step questions").toBeGreaterThan(4);
    expect(questions.filter((q) => FIELD.test(q))).toEqual([]);
  });

  it("CONTROL: the sweep sees the word where it is", () => {
    expect(FIELD.test("Registration & field")).toBe(true);
    expect(FIELD.test("How is the field divided, and who plays whom?")).toBe(true);
    expect(FIELD.test("Fielding questions")).toBe(false);
  });
});
