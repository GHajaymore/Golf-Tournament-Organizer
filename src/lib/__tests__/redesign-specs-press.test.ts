import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readSource, stripComments } from "./source";

/**
 * A `@redesign` BLOCK PRESSES SOMETHING THAT WRITES, AND LOOKS AGAIN (G1, from R4's review).
 *
 * R4's first `@redesign` blocks opened the screen and asserted text; the review sent them back. "A screen that
 * every walk opens and nobody uses is not a tested screen" (CLAUDE.md, End-to-end). So every
 * `test.describe("@redesign…")` in `e2e/*.spec.ts` must hold, as a person would do it:
 *   - at least one WRITE press: `.click(`, `.fill(`, `.check(`, `.selectOption(` or `.press(` that is not on a
 *     link and not a fold opener (opening a section writes nothing), and
 *   - a `reload()` or `goto(` AFTER the first such press, so the changed value is seen on a fresh load.
 *
 * Blocks are read through `readSource` (comments stripped), so a press written in a comment counts for nothing.
 * A block that fails is listed by name in `KNOWN_READ_ONLY` with a date and sent to the QA Director; the list is
 * never padded to make the test pass. The number of blocks found has a floor, so a broken reader cannot pass on none.
 */

/**
 * Blocks that do not press-then-look, 23 Nov 2026: nine of R2's and R9a's, and six of R4's (#1218, merged). Each is `file :: describe title`.
 * OWNER: QA Director with the Test Engineer; backlog item "G1b": give every listed block a press-then-reload and
 * empty this list, test-only, before the R2, R4 and R9a switch-on flips. A screen's PR that adds a block must not
 * add to this list: the list is CAPPED at KNOWN_READ_ONLY_CAP below and may only shrink; the test refuses a name
 * that now passes or no longer exists.
 *   "no press that writes": the block reads the screen (R9a's day-of, round-day, replace and print blocks);
 *   "never looks again": the press is proved from the database (poll) or by re-opening through a helper, not by a
 *   reload or goto (R2's two course blocks, R9a's draw, moves and handicap blocks, R4's six).
 * The rule is per describe BLOCK, not per test: a block whose one test presses and reloads passes though its
 * other tests only read. Two blocks with one title in one file would share an entry.
 */
export const KNOWN_READ_ONLY: readonly string[] = [];

/** The list's size today (0, dated 24 Nov 2026, owner G1b): B105 parts 1 and 2 gave all fourteen blocks a press and a reload. NEVER RAISE: every @redesign block now presses and looks again. */
export const KNOWN_READ_ONLY_CAP = 0;

/** The least number of `@redesign` blocks there are today (59: measured on this head, B106's 58 plus B123's one). Raise it as screens land, never lower it. */
export const MIN_BLOCKS = 59;

const WRITE_PRESS = /\.(click|fill|check|selectOption|press)\(/;
const NOT_A_WRITE = /getByRole\(\s*["']link["']|openSection\(|openFold\(|sectionLine\(|aria-expanded|\.locator\(\s*["']a\b/;
const LOOK_AGAIN = /\.reload\(|\.goto\(/;

export interface RedesignBlock {
  file: string;
  title: string;
  body: string;
}

/** Every `test.describe("@redesign…", …)` block of one spec source: the title, and the text up to its closing paren. */
export function redesignBlocks(file: string, src: string): RedesignBlock[] {
  const out: RedesignBlock[] = [];
  const START = /test\.describe(?:\.\w+)?\(\s*(["'`])(@redesign(?:(?!\1).)*)\1/g;
  for (const m of src.matchAll(START)) {
    const open = src.indexOf("(", m.index!);
    let depth = 0;
    let end = -1;
    let quote: string | null = null;
    for (let i = open; i < src.length; i++) {
      const c = src[i];
      if (quote) {
        if (c === "\\") i++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "(") depth++;
      else if (c === ")" && --depth === 0) {
        end = i;
        break;
      }
    }
    out.push({ file, title: m[2], body: src.slice(open, end === -1 ? src.length : end) });
  }
  return out;
}

/** Why a block does not press and look again, or null when it does. */
export function pressProblem(body: string): string | null {
  const lines = body.split("\n");
  const first = lines.findIndex((l) => WRITE_PRESS.test(l) && !NOT_A_WRITE.test(l));
  if (first === -1) return "it holds no press that writes (a click, fill, check, selectOption or press that is not a link or a fold opener)";
  if (!lines.slice(first + 1).some((l) => LOOK_AGAIN.test(l))) return "it never reloads or goes to the page again after its first write press";
  return null;
}

const SPEC_DIR = join(process.cwd(), "e2e");
const specs = readdirSync(SPEC_DIR).filter((f) => f.endsWith(".spec.ts"));
const blocks = specs.flatMap((f) => redesignBlocks(f, readSource("e2e", f)));
const nameOf = (b: RedesignBlock) => `${b.file} :: ${b.title}`;

describe("every @redesign block presses something that writes, and looks again", () => {
  it("finds the blocks (a broken reader would make the sweep pass on none)", () => {
    expect(blocks.length).toBeGreaterThanOrEqual(MIN_BLOCKS);
  });

  it("each block holds a write press and a reload or goto after it", () => {
    const bad = blocks.filter((b) => !KNOWN_READ_ONLY.includes(nameOf(b))).flatMap((b) => {
      const why = pressProblem(b.body);
      return why ? [`${nameOf(b)}: ${why}`] : [];
    });
    expect(bad).toEqual([]);
  });

  it("KNOWN_READ_ONLY is capped: it may only shrink, never grow", () => {
    expect(KNOWN_READ_ONLY.length, "never raise KNOWN_READ_ONLY_CAP; give the new block a press and a reload instead").toBeLessThanOrEqual(KNOWN_READ_ONLY_CAP);
  });

  it("KNOWN_READ_ONLY names only blocks that exist and are still read-only", () => {
    const names = new Map(blocks.map((b) => [nameOf(b), b]));
    for (const k of KNOWN_READ_ONLY) {
      expect(names.has(k), `${k} is not a @redesign block any more: take it off the list`).toBe(true);
      expect(pressProblem(names.get(k)!.body), `${k} now presses: take it off the list`).not.toBeNull();
    }
  });

  it("CONTROL: a planted read-only block is refused", () => {
    const planted = `test.describe("@redesign reads only", () => {\n  test("opens", async ({ page }) => {\n    await page.goto("/x");\n    await expect(page.getByText("Hello")).toBeVisible();\n    await page.getByRole("link", { name: "More" }).click();\n    await section.getByRole("button").first().click(); // aria-expanded\n  });\n});`;
    const [b] = redesignBlocks("planted.spec.ts", planted);
    expect(b.title).toBe("@redesign reads only");
    expect(pressProblem(b.body)).toMatch(/no press that writes/);
  });

  it("CONTROL: a press with no look afterwards is refused, and a press then a reload passes", () => {
    const press = `test.describe("@redesign presses", () => {\n  test("a", async () => {\n    await page.goto("/x");\n    await box.fill("a");\n    await save.click();\n  });\n});`;
    expect(pressProblem(redesignBlocks("p.spec.ts", press)[0].body)).toMatch(/never reloads/);
    const fixed = press.replace("await save.click();", "await save.click();\n    await page.reload();");
    expect(pressProblem(redesignBlocks("p.spec.ts", fixed)[0].body)).toBeNull();
  });

  it("CONTROL: a press written only in a comment does not count (the spec is read through readSource)", () => {
    const commented = 'test.describe("@redesign c", () => {\n  test("a", async () => {\n    await page.goto("/x");\n    // await save.click();\n    // await page.reload();\n  });\n});';
    expect(pressProblem(redesignBlocks("c.spec.ts", commented)[0].body), "unstripped, the comment would pass").toBeNull();
    expect(pressProblem(redesignBlocks("c.spec.ts", stripComments(commented))[0].body)).toMatch(/no press that writes/);
  });
});
