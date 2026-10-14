import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { readSource } from "./source";

/**
 * A ROUND'S CARD IS BUILT ONE WAY: `roundCard(stage, event, venue)`.
 *
 * The round's venue, then the tournament's course, narrowed to the nine played.
 * Until 2026-10-14 nine readers wrote that chain out — six as
 * `cardForStage(courseForRound(venue, event) ?? resolveCourse(event), stage)`,
 * the event state's own resolver, the skins pot and the score-entry card in
 * other words — and five once handed the TOURNAMENT's course for a round played
 * away. This refuses the fallback written anywhere but the one function.
 *
 * Callers that want NO card where the round has no real course (score entry,
 * the round-code page, the handicap record) call `courseForRound` alone and do
 * not fall back; they are a different answer and are not refused.
 */
describe("a round's card", () => {
  function sources(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name === "__tests__" || e.name === "node_modules") continue;
        sources(rel, out);
      } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(rel);
    }
    return out;
  }
  /** The fallback to the tournament's course, in any of the spellings it had. */
  const FALLBACK = /courseForRound\([^;]*\)\s*\?\?|\?\?\s*resolveCourse\(/;

  it("CONTROL: the sweep recognises the spellings it replaced, and not a caller that wants no card", () => {
    expect(FALLBACK.test("const course = cardForStage(courseForRound(roundVenue, event) ?? resolveCourse(event), stage);")).toBe(true);
    expect(FALLBACK.test("    const resolved = courseForRound(roundCourse, event) ?? course;")).toBe(true);
    expect(FALLBACK.test("  const card = applyNine(resolved ?? resolveCourse(state.event), cleanNine(stage?.nine), holes);")).toBe(true);
    expect(FALLBACK.test("      const roundCourse = courseForRound(stageCourse ?? soleVenue, state.event);")).toBe(false);
    expect(FALLBACK.test("  const card = roundCard(stage, event, roundVenue);")).toBe(false);
  });

  it("falls back to the tournament's course in one place only", () => {
    const strays = sources("src").filter((f) => !f.endsWith("services/course-resolution.ts") && FALLBACK.test(readSource(f)));
    expect(strays, "build a round's card with roundCard(stage, event, venue)").toEqual([]);
  });
});
