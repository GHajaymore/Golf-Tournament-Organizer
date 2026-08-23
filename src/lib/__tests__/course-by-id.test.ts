import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Every screen that resolves a card must load the course it points at.
 *
 * `Event.courseId` is what the organizer picked; `Event.course` is the name
 * kept beside it. Resolution prefers the id — but only if the query loaded the
 * row, which is what makes the migration incremental and is also exactly how
 * it can be left half-done.
 *
 * A caller that forgets falls back to the name and nothing reports it. It
 * still returns A card, so nothing throws, nothing looks broken, and the
 * scores are simply computed against a different stroke index. That is the
 * failure mode this file exists to make loud: found on real data, a
 * tournament reading "Blue Ash Golf Course" that was still scoring against
 * Pebble Beach's card.
 */

const SRC = join(process.cwd(), "src");

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

/**
 * Modules that resolve a card but legitimately need no join of their own,
 * each with the reason. An unexplained entry is how this test would quietly
 * stop protecting anything.
 */
const EXEMPT: Record<string, string> = {
  "courses.ts": "defines resolveCourse itself",
  "course-resolution.ts": "defines the resolution and the join",
};

describe("resolving a card by id, not by the name beside it", () => {
  const files = walk(SRC).filter(
    (f) => /\.tsx?$/.test(f) && !f.includes("__tests__"),
  );

  it("finds the modules that resolve a card at all", () => {
    // If the detection broke, every assertion below would pass vacuously.
    const resolvers = files.filter((f) =>
      /resolveCourse\(|courseForRound\(|courseForMatch\(/.test(readFileSync(f, "utf8")),
    );
    expect(resolvers.length).toBeGreaterThan(8);
  });

  it("every one of them loads the course, or takes it from tournament state", () => {
    const missing: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (!/resolveCourse\(|courseForRound\(|courseForMatch\(/.test(src)) continue;
      const base = f.split(/[\\/]/).pop() ?? f;
      if (EXEMPT[base]) continue;

      // Two honest ways to have the row: join it, or read an event that came
      // from tournamentState, which joins it once for everything downstream.
      const joined = /COURSE_REF|courseRef/.test(src);
      const viaState = /state\.event|\{ event \} = state/.test(src);
      if (!joined && !viaState) missing.push(f.replace(process.cwd(), ""));
    }
    expect(
      missing,
      "these resolve a card without loading the course it points at, so they " +
        "silently score against the name instead of the id",
    ).toEqual([]);
  });
});
