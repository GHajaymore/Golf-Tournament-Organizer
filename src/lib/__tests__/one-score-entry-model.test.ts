import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";
import { parseStroke, scoreMark, MAX_STROKES_PER_HOLE } from "@/lib/domain/score-payload";

/**
 * EVERY SCORE BOX IN THE APP IS THE SAME SCORE BOX.
 *
 * Not a style rule. A score box makes two decisions — what counts as a score,
 * and what the score means against par — and both were written once per
 * screen:
 *
 *   ScorecardTable      parseInt(...) > 0            markOf
 *   ScoreEntryClient    parseInt(...) > 0            scoreMark
 *   TeamEntryClient     parseInt(...) > 0            an inline ternary
 *   HoleByHoleCard      parseInt(...) > 0            markStyle, in INLINE
 *                                                    STYLES rather than the
 *                                                    .sc-score classes
 *
 * Four copies of a rule agree right up until they do not, and two of these had
 * already drifted: the over-par corner was 3px in `design-system.css` and 4px
 * in the inline copy. Nothing reported it and nothing could have.
 *
 * The sharper half was the BOUND. `cleanStrokes` has refused anything over
 * MAX_STROKES_PER_HOLE since it was written — and it refuses the WHOLE CARD,
 * not the hole — while not one of the four boxes knew there was a ceiling. So
 * a mis-keyed 99 was accepted into the card and added into the gross shown on
 * screen (measured on the demo data on 2026-09-13: GROSS 302) and then refused
 * at the save, as a card, with a sentence telling the scorer to reload — which
 * discards what they have just typed.
 *
 * Swept from the filesystem rather than a list, so a screen written next month
 * is covered the day it is added.
 */

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules" && e.name !== "__tests__") walk(p);
      } else if (/\.tsx?$/.test(e.name)) {
        out.push(p);
      }
    }
  };
  walk(dir);
  return out;
}

/** The one place allowed to spell the rule out. */
const HOME = join("src", "lib", "domain", "score-payload.ts");

describe("one score entry model", () => {
  /**
   * Through `readSource`, which strips comments — every one of these files
   * carries a paragraph ABOUT the marking, and a plain text search would be
   * satisfied by the prose that says the copy was removed. That is the one
   * mutation failure that looks exactly like a mutation success, and it is
   * why `source-guard.test.ts` sweeps per file.
   */
  const files = sourceFiles("src").filter((f) => !f.endsWith(HOME.split("src").pop() ?? ""));

  /**
   * A STROKE BOX, NOT MERELY A CARD GRID — and the difference was a false
   * positive on the first run of this file.
   *
   * `.sc-score` is the app's score-box styling and `CourseSetupPrompt` quite
   * correctly borrows it for the boxes that take a course's PARS, yardages and
   * stroke indexes. Those are card data, not scores: they are bounded by what
   * a golf hole can be (3 to 6) rather than by MAX_STROKES_PER_HOLE, and they
   * have their own validation with its own reasons. A sweep that flagged them
   * would be demanding they parse a par through a stroke parser, which is
   * wrong about golf as well as about the code.
   *
   * `strokes` is the discriminator because it is the name every stroke array
   * in this codebase carries. `strokeIndex` does not match it, which is the
   * whole reason for the word boundary.
   */
  const strokeBoxes = files.filter((f) => {
    const src = readSource(f);
    return /\bsc-score\b/.test(src) && /\bstrokes\b/.test(src);
  });

  it("finds the score boxes at all — the sweep's own control", () => {
    /**
     * WITHOUT THIS THE FILE PASSES VACUOUSLY. A glob that stops matching, or a
     * rename, makes "no second copy found" true and meaningless.
     *
     * This control used to name four files. It named them because four files
     * drew their own score box, and it went red the day `ScoreCell` was
     * extracted and `ScoreEntryClient` stopped drawing one — which is the
     * guard reporting the change rather than a fault. The list below is what
     * is true now, and the rule underneath it is what keeps it true.
     */
    expect(strokeBoxes.length, "no score boxes found — the sweep is broken").toBeGreaterThanOrEqual(2);
    const names = strokeBoxes.map((f) => f.split(/[\\/]/).pop());
    for (const known of ["ScorecardTable.tsx", "HoleByHoleCard.tsx"]) {
      expect(names, `${known} draws a score box and the sweep missed it`).toContain(known);
    }
  });

  it("draws a score box in three places, and each one has a reason", () => {
    /**
     * ONE CELL, everywhere a score goes into a grid.
     *
     * `ScorecardTable` was one player's card, `ScoreEntryClient` was two
     * players against shared reference rows, and `TeamEntryClient` was a
     * side's cards — three tables, three hand-written `<td><input
     * className="input sc-score">`, each with its own screen-reader name and
     * its own idea of where the shots dot goes. The TABLES are genuinely
     * different and merging them would make the match card worse; the CELL was
     * the same cell three times, and is now `ScoreCell`.
     *
     * TWO EXEMPTIONS, and neither is "it was easier".
     *
     * `HoleByHoleCard`'s "Other" box is a single control on a
     * one-hole-at-a-time screen, 76px wide and not inside a table row at all.
     * `ScoreCell` renders a `<td>`. Forcing it through would mean a cell
     * component that sometimes is not a cell.
     *
     * The `styleguide` page is DOCUMENTING `.sc-score` itself — the ring, the
     * box, the two rings. It needs the raw class on a real input, and a
     * read-only `ScoreCell` renders a `span` instead, so routing it through
     * the component would show the reader something other than the thing being
     * documented. (It is still swept by the marking rule above, which is where
     * its fifth copy of the thresholds was found.)
     *
     * Adding a fourth is meant to be uncomfortable. If a new screen needs a
     * score in a grid, it needs `ScoreCell`, and if `ScoreCell` cannot do it
     * then `ScoreCell` should learn to — that is the change worth making,
     * not another copy.
     */
    const drawsOwn = strokeBoxes
      .filter((f) => /className=\{?[`"']?(?:input )?sc-score/.test(readSource(f)))
      .map((f) => f.split(/[\\/]/).pop())
      .sort();
    expect(drawsOwn, "a score box drawn outside ScoreCell — use it instead").toEqual([
      "HoleByHoleCard.tsx",
      "ScorecardTable.tsx",
      "page.tsx",
    ]);
  });

  it("has exactly one implementation of the marking", () => {
    /**
     * The thresholds, not the name. A copy called something else is still a
     * copy — `markOf`, `scoreMark` and `markStyle` were three names for one
     * rule — so this looks for the arithmetic: a comparison against -2, -1, 1
     * or 2 in the same expression as one of the class names.
     */
    const second = files.filter((f) => {
      const src = readSource(f);
      if (!/is-eagle|is-double/.test(src)) return false;
      // Using the class names is fine; DECIDING them from a difference is not.
      return /-\s*2|===?\s*-\s*1|>=\s*2|<=\s*-\s*2/.test(src);
    });
    /**
     * The styleguide is swept too, deliberately, and it is where the fifth
     * copy was found. It is the worst place for one: this page is what
     * somebody checks a design against, so a copy that drifted here would make
     * the app look wrong when it was right.
     */
    expect(
      second.map((f) => f.replace(/\\/g, "/")),
      "this works out the mark against par for itself — call scoreMark from score-payload instead",
    ).toEqual([]);
  });

  it("lets no score box parse its own strokes", () => {
    /**
     * The bound is the reason. A box with its own `parseInt(...) > 0` accepts
     * a 99 that the save will refuse, and it refuses it as a CARD — so the
     * number is typed, totalled, shown, and lost.
     */
    const ownParser = strokeBoxes.filter((f) => /parseInt\s*\(/.test(readSource(f)));
    expect(
      ownParser.map((f) => f.replace(/\\/g, "/")),
      "this parses a stroke itself, so it does not know the ceiling — call parseStroke from score-payload",
    ).toEqual([]);
  });

  /**
   * THERE IS NO FOURTH TEST HERE, AND THAT IS A DECISION RATHER THAN AN
   * OVERSIGHT.
   *
   * A draft of this file swept for a score's ring being drawn with an inline
   * `boxShadow` — which is exactly what `HoleByHoleCard` was doing, and how
   * its over-par corner came to be 4px against the stylesheet's 3px. As a
   * TEXT search it flagged the styleguide, whose only `boxShadow` is a 1px
   * hairline on an error callout with nothing to do with a score. Narrowing it
   * to catch one and not the other meant matching on the shadow's pixel width,
   * which is a rule about this week's design rather than about scores.
   *
   * It is not needed. `scoreMark` returns a CLASS SUFFIX and the test above
   * makes it the only implementation, so a caller has nothing to draw with:
   * the marking can only come from `.sc-score.is-*` in `design-system.css`.
   * Enforcing the one rule at the place the data is built removes the need to
   * police what callers do with it — the same shape as `standingRows`
   * returning `[]` on its first line.
   */
});

describe("what one hole will take", () => {
  it("accepts a real score", () => {
    expect(parseStroke("4")).toBe(4);
    expect(parseStroke("1")).toBe(1);
    expect(parseStroke(String(MAX_STROKES_PER_HOLE))).toBe(MAX_STROKES_PER_HOLE);
  });

  it("refuses at the keystroke exactly what the save refuses", () => {
    /**
     * THE WHOLE POINT. `cleanStrokes` rejects the card for any of these, so a
     * box that accepted them was building a card that could not be saved.
     */
    expect(parseStroke("")).toBeNull();
    expect(parseStroke("0")).toBeNull();
    expect(parseStroke("-3")).toBeNull();
    expect(parseStroke("abc")).toBeNull();
    expect(parseStroke(String(MAX_STROKES_PER_HOLE + 1))).toBeNull();
    expect(parseStroke("99")).toBeNull();
  });

  it("marks against par the way a printed card does", () => {
    expect(scoreMark(2, 4)).toBe(" is-eagle");
    expect(scoreMark(3, 4)).toBe(" is-under");
    expect(scoreMark(4, 4)).toBe("");
    expect(scoreMark(5, 4)).toBe(" is-over");
    expect(scoreMark(6, 4)).toBe(" is-double");
    // No par, no claim. A card with no course behind it must not ring a 3.
    expect(scoreMark(3, null)).toBe("");
    expect(scoreMark(null, 4)).toBe("");
  });
});
