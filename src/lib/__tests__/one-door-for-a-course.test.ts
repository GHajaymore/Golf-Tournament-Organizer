import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";

/**
 * A COURSE IS CREATED IN ONE PLACE.
 *
 * `services/course-library.ts` explains why. This is what stops it drifting
 * back: four paths created a Course and two of them checked for a duplicate,
 * which is how a club ends up with two rows for the same golf course and picks
 * the one without the real stroke index.
 *
 * The rule is enforced where the row is written, so a fifth path written next
 * year is correct without its author knowing the rule exists — but only for as
 * long as the fifth path goes through the door. That is what this asserts.
 *
 * Comments are stripped (`readSource`): the paragraph above names the call it
 * forbids, and a raw search would find this file's own prose and the door's
 * documentation and call them violations.
 */

const SRC = join(process.cwd(), "src");
const DOOR = join("lib", "services", "course-library.ts");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry) && !full.includes("__tests__")) out.push(full.slice(process.cwd().length + 1));
  }
  return out;
}

const FILES = sourceFiles(SRC);
const BODIES = new Map(FILES.map((f) => [f, readSource(f)]));

// `includes`, not a regex: a sweep built from string search cannot be silently
// disarmed by a shell eating a backslash, which CLAUDE.md has three examples of.
const CREATE = "prisma.course.create";

describe("one door into the course library", () => {
  it("has files to search and finds the door itself", () => {
    // The control, and it is the whole reason this test is trustworthy: if the
    // sweep were broken, or `readSource` returned nothing, the assertion below
    // would pass by finding no violations anywhere.
    expect(FILES.length).toBeGreaterThan(200);
    const door = [...BODIES].find(([f]) => f.endsWith(DOOR));
    expect(door, "the door itself is missing — did the file move?").toBeTruthy();
    expect(door?.[1] ?? "", `${DOOR} no longer creates a Course`).toContain(CREATE);
  });

  it("is the only place a Course is created", () => {
    const offenders = [...BODIES]
      .filter(([f, body]) => !f.endsWith(DOOR) && body.includes(CREATE))
      .map(([f]) => f);

    expect(
      offenders,
      `${offenders.join(", ")} creates a Course directly. Go through addCourseToLibrary: ` +
        `the duplicate check lives there, and so will the plan limit, so a caller that ` +
        `writes the row itself is a club with two identical courses and no way to tell them apart.`,
    ).toEqual([]);
  });

  it("every origin the door offers is actually used", () => {
    /**
     * Same trap as a dead plan feature: `CourseOrigin` reads as a list of the
     * ways a course can arrive, so the next person reasons from it. One that
     * nothing passes is a path that does not exist.
     */
    const door = readSource(join("src", DOOR));
    const origins = [...door.matchAll(/\| "([a-z-]+)"/g)].map((m) => m[1]);
    expect(origins.length, "no origins parsed out of the door — the union changed shape").toBeGreaterThanOrEqual(4);

    const callers = [...BODIES].filter(([f]) => !f.endsWith(DOOR)).map(([, b]) => b);
    const unused = origins.filter((o) => !callers.some((b) => b.includes(`origin: "${o}"`)));
    expect(unused, `${unused.join(", ")} is offered as an origin and nothing passes it`).toEqual([]);
  });
});
