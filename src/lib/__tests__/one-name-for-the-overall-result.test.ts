import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";

/**
 * THE EVENT'S COARSE SCORING ANSWER IS CALLED THE SAME THING EVERYWHERE.
 *
 * `Event.format` holds one value for a whole tournament — match or stroke —
 * and it has been renamed twice for the same reason each time: every ROUND
 * also has a format, and every round also has a scoring basis, so any name
 * describing the golf gets read as the round's. It is "Overall result" now,
 * because what it actually decides is the table ACROSS the rounds.
 *
 * THE RENAME WAS APPLIED TO THE CONTROL AND MISSED TWO SUMMARIES, which is
 * how a screen comes to ask a question under one name and report the answer
 * under the old one a few inches lower:
 *
 *   EventSetupClient  a "Format" row in the summary beside the control itself
 *   LifecycleBar      a "Format" row TWO LINES ABOVE "Rounds", so a
 *                     tournament with eleven of them read
 *                     "Format: Stroke play / Rounds: 11"
 *
 * Both were found by sweeping rather than by walking, after fixing a third
 * instance on the public entry form. So this sweeps the class: wherever the
 * coarse pair is rendered, the label beside it must be the one name.
 */

/** Every `.ts`/`.tsx` under `src`, tests excluded. Swept, never listed. */
function sourceFiles(dir = "src", out: string[] = []): string[] {
  for (const entry of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue;
      sourceFiles(rel, out);
    } else if (/\.tsx?$/.test(entry.name) && statSync(join(process.cwd(), rel)).isFile()) {
      out.push(rel);
    }
  }
  return out;
}

/**
 * The rendered pair, e.g. `? "Stroke play" : "Match play"`. Matched on the two
 * USER-FACING strings rather than on `event.format`, because the defect is
 * what a person reads — a screen that resolves the value elsewhere and prints
 * this pair has exactly the same problem.
 */
const RENDERS_THE_PAIR = /"Stroke play"\s*:\s*"Match play"/;

/** The label this must be filed under, wherever it is printed. */
const ONE_NAME = "Overall result";

/** The names it has worn before, and must not wear again. */
const OLD_NAMES = ["Format", "Scoring", "The kind of golf"];

const FILES = sourceFiles().filter((f) => RENDERS_THE_PAIR.test(readSource(f)));

describe("the event's coarse scoring answer has one name", () => {
  it("finds the places that render it", () => {
    /**
     * THE CONTROL, and it is the half that matters. "No file labels this
     * wrongly" is satisfied perfectly by a sweep that reads nothing — a
     * broken walk, an empty `readSource` and a clean codebase all report zero
     * in identical words. This asserts the instrument found real files, and
     * names the two it must always find.
     */
    expect(FILES.length, "the sweep matched nothing — it is looking at nothing").toBeGreaterThan(0);
    expect(FILES.some((f) => f.includes("EventSetupClient"))).toBe(true);
    expect(FILES.some((f) => f.includes("LifecycleBar"))).toBe(true);
  });

  for (const file of FILES) {
    it(`${file} labels it "${ONE_NAME}"`, () => {
      const src = readSource(file);
      expect(src, `${file} renders the pair without the agreed label`).toContain(ONE_NAME);
    });

    it(`${file} does not also wear an older name`, () => {
      /**
       * An ABSENCE assertion, which is the safe direction: prose above the
       * code cannot satisfy it, because `readSource` strips comments — and
       * this file's own explanation names all three old labels, which would
       * otherwise make it its own first false positive.
       *
       * Quoted exactly as a rendered label (`"Format"`), not as a bare word,
       * so `f.format` and `formatLabel` do not trip it.
       */
      const src = readSource(file);
      for (const old of OLD_NAMES) {
        expect(src, `${file} still renders a "${old}" label for this value`).not.toContain(
          `"${old}"`,
        );
      }
    });
  }
});
