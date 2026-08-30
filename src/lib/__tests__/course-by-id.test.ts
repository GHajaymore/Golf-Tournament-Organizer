import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseHoleArray, resolveCourse, hasCourseData } from "../courses";

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

/**
 * A nine-hole course has a card.
 *
 * `parseHoleArray` is the only decoder for every stored card in the app and it
 * required exactly EIGHTEEN values. The writers deliberately emit nine for a
 * nine-hole course — `course-directory.ts` says "the import writes the card at
 * its own length rather than padding it" — so every nine-holer decoded to null
 * and read back as having no card.
 *
 * A club adding their home nine from the directory was told "The directory has
 * no usable card for this course" about a card the database was holding, and
 * on the live-API path the import reported SUCCESS and then score entry showed
 * the set-up-your-course prompt instead of the scorecard.
 *
 * Measured against the real catalogue before changing, per CLAUDE.md: 54 stored
 * courses hold a good nine-hole card that no reader could use, every one of
 * them with a distinct stroke index. A guard that refuses a real golf course is
 * worse than no guard.
 */
describe("a card is nine holes or eighteen", () => {
  const nine = (v: number) => JSON.stringify(new Array(9).fill(v));
  const eighteen = (v: number) => JSON.stringify(new Array(18).fill(v));

  it("reads a nine-hole card", () => {
    expect(parseHoleArray(nine(4))).toHaveLength(9);
  });

  it("still reads an eighteen-hole card", () => {
    expect(parseHoleArray(eighteen(4))).toHaveLength(18);
  });

  it("keeps the values exactly as stored", () => {
    // A real executive nine: 3,3,3,3,4,4,4,5,5 is a routing, not a scrambled
    // card — see the course-card notes in CLAUDE.md.
    const executive = [3, 3, 3, 3, 4, 4, 4, 5, 5];
    expect(parseHoleArray(JSON.stringify(executive))).toEqual(executive);
  });

  it("reads a nine-hole stroke index without re-ranking it", () => {
    // Ranking belongs to `cardForStage`; this only decodes.
    const si = [5, 9, 1, 3, 7, 8, 2, 4, 6];
    expect(parseHoleArray(JSON.stringify(si))).toEqual(si);
  });

  it("refuses a length that is not a golf course", () => {
    // Ten or seventeen is not a shorter course, it is a broken row.
    for (const n of [1, 8, 10, 17, 19, 36]) {
      expect(parseHoleArray(JSON.stringify(new Array(n).fill(4))), `${n} holes`).toBeNull();
    }
  });

  it("refuses an empty card", () => {
    expect(parseHoleArray("[]")).toBeNull();
    expect(parseHoleArray("")).toBeNull();
  });

  it("refuses anything that is not numbers", () => {
    expect(parseHoleArray(JSON.stringify(new Array(9).fill("4")))).toBeNull();
    expect(parseHoleArray(JSON.stringify(new Array(18).fill(null)))).toBeNull();
    expect(parseHoleArray("{\"pars\":[4,4,4]}")).toBeNull();
    expect(parseHoleArray("not json at all")).toBeNull();
  });
});

describe("a tournament played on a nine-hole course", () => {
  const nineCard = {
    pars: JSON.stringify([3, 4, 4, 3, 5, 4, 4, 3, 4]),
    yards: JSON.stringify([150, 380, 400, 165, 510, 390, 375, 140, 385]),
    strokeIndex: JSON.stringify([7, 3, 1, 8, 5, 2, 4, 9, 6]),
  };

  it("resolves to its own card rather than to an unknown course", () => {
    // It returned UNKNOWN_COURSE with empty pars, so the club was blocked from
    // scoring a stroke or Stableford round on a course it had stored.
    const resolved = resolveCourse({
      course: "The Nine",
      city: "",
      customPars: nineCard.pars,
      customYards: nineCard.yards,
      customStrokeIndex: nineCard.strokeIndex,
    });
    expect(resolved.name).toBe("The Nine");
    expect(resolved.pars).toHaveLength(9);
    expect(resolved.strokeIndex).toHaveLength(9);
  });

  it("resolves the same way from a catalogued course row", () => {
    const resolved = resolveCourse({
      courseRef: {
        id: "c1",
        name: "Catalogued Nine",
        city: "Town",
        pars: nineCard.pars,
        yards: nineCard.yards,
        strokeIndex: nineCard.strokeIndex,
      },
      course: "whatever the event typed",
      city: "",
      customPars: "",
      customYards: "",
      customStrokeIndex: "",
    });
    expect(resolved.name).toBe("Catalogued Nine");
    expect(resolved.pars).toEqual([3, 4, 4, 3, 5, 4, 4, 3, 4]);
  });

  it("counts as having course data at all", () => {
    // `hasCourseData` gates score entry: false put the CourseSetupPrompt on
    // screen instead of the card.
    expect(
      hasCourseData({
        course: "The Nine",
        customPars: nineCard.pars,
        customYards: nineCard.yards,
        customStrokeIndex: nineCard.strokeIndex,
      }),
    ).toBe(true);
  });
});
