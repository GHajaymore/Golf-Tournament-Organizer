import { describe, it, expect } from "vitest";
import { LANDING_CSS } from "@/lib/landing/styles";
import { HOME_CSS } from "@/lib/landing/home-styles";
import { readSource, stripComments } from "./source";

/**
 * A CLASS THE QUESTIONS PAGE WRITES IS ONE THE SHARED SHEET STYLES.
 *
 * Three of the FAQ's answers carry a block of their own: the worked handicap
 * sum (`.hc`), the list of formats (`.fmts`) and the three prices (`.tierlist`).
 * When the shared stylesheet was rewritten for the front door's redesign (#700)
 * their rules were left out, and the answers went on printing the blocks with
 * nothing to lay them out. Each drew as one run-on line —
 *
 *     Handicap index12.4Course rating / slope71.5 / 140Course handicap15…
 *
 * — on a public page, under the heading "How are course handicaps calculated?",
 * until 2026-10-13. Found by opening the page to read a figure that had just
 * been corrected. `landing-home-sheet.test.ts` holds the front door's own sheet
 * to the classes its page writes, in both directions; nothing held this one.
 *
 * So: every class written, as plain text in a `className`, by the files that
 * the shared sheet dresses is a class that sheet (or the front door's, for the
 * chrome they share) has a rule for — or is a NAMED hook, with its reason.
 *
 * What it cannot see: a class name put together at run time, a rule that
 * matches and no longer does anything worth having, and whether the block
 * LOOKS right — `e2e/faq-blocks.spec.ts` measures the three in a browser.
 */

const FILES = [
  "src/lib/landing/faq.tsx",
  "src/lib/landing/compare.tsx",
  "src/lib/landing/dialect.tsx",
  "src/components/landing/chrome.tsx",
  "src/components/landing/FaqSearch.tsx",
  "src/components/landing/FeatureSearch.tsx",
  "src/components/landing/EditionSwitch.tsx",
  "src/app/faq/page.tsx",
  "src/app/privacy/page.tsx",
  "src/app/terms/page.tsx",
];

/** Classes written for a script or a test to find, which no rule needs to match. */
const HOOKS: Record<string, string> = {
  "fq-head": "a group's heading row; the sheet reaches it as `details.fq-group > summary`",
};

/** Every class named in a plain `className="…"` in this source. */
function classesIn(code: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const at = code.indexOf('className="', from);
    if (at < 0) break;
    const start = at + 'className="'.length;
    const end = code.indexOf('"', start);
    from = end + 1;
    for (const c of code.slice(start, end).split(" ")) if (c) out.push(c);
  }
  return out;
}

const sheet = stripComments(LANDING_CSS) + stripComments(HOME_CSS);
/** A rule that names the class: `.name` followed by something that ends a class name. */
const styled = (name: string) => {
  let from = 0;
  for (;;) {
    const at = sheet.indexOf(`.${name}`, from);
    if (at < 0) return false;
    const next = sheet[at + name.length + 1] ?? " ";
    const isNameChar = (next >= "a" && next <= "z") || (next >= "A" && next <= "Z") || (next >= "0" && next <= "9") || next === "-" || next === "_";
    if (!isNameChar) return true;
    from = at + 1;
  }
};

describe("what the questions page writes, the shared sheet styles", () => {
  it("CONTROL: reads the pages, and tells a styled class from an unstyled one", () => {
    const faq = classesIn(readSource("src/lib/landing/faq.tsx"));
    expect(faq).toEqual(expect.arrayContaining(["hc", "fmts", "tierlist", "t"]));
    expect(styled("ans")).toBe(true);
    expect(styled("zz-no-such-class")).toBe(false);
    // `.h` must not be satisfied by `.hc`, nor `.tier` by `.tierlist`.
    expect(styled("hc")).toBe(true);
    expect(classesIn('<div className="a b"><span className="c" /></div>')).toEqual(["a", "b", "c"]);
  });

  it("the three blocks an answer carries have their rules", () => {
    for (const rule of [".thq .hc {", ".thq .hc span.t", ".thq .fmts span", ".thq .tierlist {", ".thq .tierlist small"]) {
      expect(sheet, rule).toContain(rule);
    }
    // Laid out, not merely mentioned: a grid of label and figure, a wrapping row, three columns.
    expect(sheet).toMatch(/\.thq \.hc \{ display: grid; grid-template-columns: minmax\(0, 1fr\) auto;/);
    expect(sheet).toMatch(/\.thq \.fmts \{ display: flex; flex-wrap: wrap;/);
    expect(sheet).toMatch(/\.thq \.tierlist \{ display: grid; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
  });

  it("no class a page writes is left without a rule", () => {
    const bare: string[] = [];
    for (const file of FILES) {
      for (const name of new Set(classesIn(readSource(file)))) {
        if (name in HOOKS) continue;
        if (!styled(name)) bare.push(`${file}: .${name}`);
      }
    }
    expect(bare, "give it a rule in lib/landing/styles.ts, or name it in HOOKS with its reason").toEqual([]);
  });
});
