import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { globSync } from "glob";
import { join } from "node:path";
import { NAV } from "../nav";
import { stripComments } from "./source";

/**
 * Nothing calls a screen by a name the sidebar does not use.
 *
 * `screenName()` exists for this, and its own doc records why: writing a
 * screen's name out a second time is how the app came to have a checklist row
 * reading "Rounds & format" and a flow list reading "Prizes & Reports",
 * neither of which is a screen. Both were fixed where they were found.
 *
 * Three more survived in exactly the same words — a link on Qualification, the
 * empty state on Teams & pairs, and the Round Codes panel — because the fix
 * was applied to the two sites somebody happened to be looking at rather than
 * swept. A reader sent to "Rounds & format" hunts a sidebar that says "Rounds
 * & formats", and the difference is one character at the end of a word.
 *
 * So this sweeps. Comments are stripped first: the note above a fix routinely
 * quotes the wrong name to explain what was wrong with it, and a guard that
 * cannot tell prose from a string would fail on its own explanation.
 */

const SRC = join(process.cwd(), "src");

/**
 * The near-misses, by the real name they are a near-miss FOR.
 *
 * A general rule is not available here — "Flights" is a screen and also an
 * ordinary English word, so anything matching every screen name loosely would
 * refuse half the copy in the app. These are the specific wrong spellings that
 * have actually appeared, which is the same basis `source-guard` works on.
 */
const WRONG: Array<{ wrong: RegExp; right: string }> = [
  { wrong: /Rounds\s*(?:&amp;|&)\s*format(?!s)/, right: "Rounds & formats" },
  { wrong: /Prizes\s*(?:&amp;|&)\s*Reports/, right: "Prizes & payouts" },
];

const files = globSync("**/*.{ts,tsx}", { cwd: SRC, absolute: true }).filter(
  (f) => !f.includes("__tests__"),
);

describe("every screen is called what the sidebar calls it", () => {
  it("finds the source files, so this cannot pass vacuously", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("names the real screens, so the list above cannot go stale", () => {
    // If "Rounds & formats" is ever renamed, this fails and whoever renamed it
    // is told that a guard is still policing the old spelling.
    const labels = NAV.flatMap((s) => s.items).map((i) => i.label);
    for (const { right } of WRONG) {
      expect(labels, `${right} is still a screen`).toContain(right);
    }
  });

  for (const { wrong, right } of WRONG) {
    it(`nothing writes a near-miss for "${right}"`, () => {
      const offenders = files.filter((f) => wrong.test(stripComments(readFileSync(f, "utf8"))));
      expect(
        offenders.map((f) => f.slice(SRC.length + 1)),
        `these call it something the sidebar does not: use screenName() instead`,
      ).toEqual([]);
    });
  }
});
