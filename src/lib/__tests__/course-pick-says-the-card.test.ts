import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { readSource } from "./source";

/**
 * EVERY COURSE PICKER IS HANDED WHAT TO SAY ABOUT THE CARD (Ajay, 2026-10-03:
 * "when organizer/player select a course, warn them if the scorecard is not
 * complete or verified").
 *
 * The picker prints `cardNote` for the chosen course, and falls back to the
 * no-card line on `hasCard: false`. So a screen that forgets to pass the note
 * does not break — it just goes quiet about an unchecked or incomplete card,
 * which is the invisible failure the request is about. Swept from the
 * filesystem so a seventh picker is noticed the day it is added.
 */
const ROOT = join(process.cwd(), "src");

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "__tests__" ? [] : filesUnder(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

/** Where each picker's courses come from, and what proves they carry the note. */
const FED_BY: Record<string, Array<[file: string[], proof: string]>> = {
  "components/NewMatchForm.tsx": [[["src", "app", "match", "new", "page.tsx"], "cardNote: pickedCardNote(c)"]],
  "components/CourseLibrary.tsx": [[["src", "components", "CourseLibrary.tsx"], "cardNote: c.cardNote"]],
  "components/EventSetupClient.tsx": [
    [["src", "components", "EventSetupClient.tsx"], "cardNote: c.cardNote"],
    [["src", "app", "(app)", "event", "page.tsx"], "cardNote: c.cardNote"],
  ],
  "components/StagesClient.tsx": [[["src", "app", "(app)", "stages", "page.tsx"], "cardNote: pickedCardNote(v)"]],
  "components/RoundVenue.tsx": [
    [["src", "app", "(app)", "entry", "page.tsx"], "cardNote: pickedCardNote(v)"],
    [["src", "app", "(app)", "entry", "page.tsx"], "cardNote: c.cardNote"],
  ],
  "components/ScoreEntryClient.tsx": [
    [["src", "app", "(app)", "entry", "page.tsx"], "cardNote: pickedCardNote(v)"],
    [["src", "app", "(app)", "entry", "page.tsx"], "cardNote: c.cardNote"],
  ],
};

describe("a course picker says what is wrong with the chosen card", () => {
  const pickers = filesUnder(ROOT)
    .filter((f) => readSource(relative(process.cwd(), f)).includes("<CoursePicker"))
    .map((f) => relative(ROOT, f).split("\\").join("/"));

  it("finds the pickers at all (the control — an empty sweep proves nothing)", () => {
    expect(pickers).toContain("components/NewMatchForm.tsx");
    expect(pickers.length).toBeGreaterThanOrEqual(6);
  });

  it("knows where every picker's courses come from", () => {
    // A new picker lands here first: say where its courses are read and
    // attach `pickedCardNote` there.
    expect(pickers.filter((p) => !FED_BY[p])).toEqual([]);
  });

  for (const [picker, sources] of Object.entries(FED_BY)) {
    it(`${picker} is handed the card note`, () => {
      for (const [file, proof] of sources) expect(readSource(...file), file.join("/")).toContain(proof);
    });
  }

  it("the club's course reads attach it, so every screen built on them does", () => {
    const services = readSource("src", "lib", "services", "courses.ts");
    expect(services.split("cardNote: pickedCardNote(").length - 1).toBe(2);
  });
});
