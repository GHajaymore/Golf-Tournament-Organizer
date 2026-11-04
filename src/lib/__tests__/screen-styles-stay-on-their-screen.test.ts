import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";

/**
 * ONE SCREEN'S STYLES DO NOT RIDE IN THE SHEET EVERY PAGE DOWNLOADS (3 Nov).
 *
 * Round G438-3 failed `every-figure-explains-itself.spec` "the card is no heavier for explaining
 * itself": a player's card weighed 12,885 bytes of style against its 12,137.6. The card had not
 * changed. The Rounds & formats timeline (#994) had put 164 lines of its own rules into
 * design-system.css, which `globals.css` imports and the root layout sends to every page — 7,862
 * bytes as built, about 1.2 KB on the wire, on a screen no player ever opens.
 *
 * Those rules now live in `src/app/(app)/stages/rounds-timeline.css`, imported by that route's page,
 * so Next sends them with that route alone. This holds them there: the global sheets carry none of
 * the timeline's selectors, and the timeline's sheet is imported by the Rounds screen and by nothing
 * a player's page loads (no layout, nothing outside the route).
 */

const GLOBAL_SHEETS = ["src/app/globals.css", "src/app/design-system.css"];
const TIMELINE_SHEET = "src/app/(app)/stages/rounds-timeline.css";

/** The selectors that belong to the timeline and the docked panel only it uses. */
const TIMELINE_SELECTOR = /(^|[\s,>+~(])(\.rt-[a-z]|\.rounds-timeline\b|\.side-panel-backdrop\[data-dock\])/;

/** Every rule's selector in a sheet (at-rule preludes skipped, nested rules included). */
function selectors(css: string): string[] {
  return [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim()).filter((s) => !s.startsWith("@"));
}

function timelineSelectorsIn(css: string): string[] {
  return selectors(css).filter((s) => TIMELINE_SELECTOR.test(s));
}

/** Every source file under src that imports a stylesheet, with the sheets it imports. */
function cssImports(dir: string, out: Array<{ file: string; sheet: string }> = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "__tests__" && e.name !== "node_modules") cssImports(full, out);
    } else if (/\.(tsx?|jsx?)$/.test(e.name)) {
      const rel = full.slice(process.cwd().length + 1).split("\\").join("/");
      for (const m of readSource(rel).matchAll(/import\s+["']([^"']+\.css)["']/g)) out.push({ file: rel, sheet: m[1] });
    }
  }
  return out;
}

describe("the Rounds timeline's styles are sent with the Rounds screen only", () => {
  it("can see a timeline rule — the control", () => {
    expect(timelineSelectorsIn(".card { color: red } .rt-hero { display: grid }")).toEqual([".rt-hero"]);
    expect(timelineSelectorsIn("@media (min-width: 1280px) { .side-panel-backdrop[data-dock] > .side-panel { width: 1px } }")).toHaveLength(1);
    expect(timelineSelectorsIn("body:has(.x) .rounds-timeline .tag-neutral { color: red }")).toHaveLength(1);
    // A class that merely contains the letters is not one of them.
    expect(timelineSelectorsIn(".sort-rt-x { color: red } .start-row { color: red }")).toEqual([]);
    // And the timeline's own sheet is really full of them, so a zero below means something.
    expect(timelineSelectorsIn(readSource(TIMELINE_SHEET)).length).toBeGreaterThan(40);
  });

  it.each(GLOBAL_SHEETS)("%s carries none of the timeline's rules", (sheet) => {
    expect(timelineSelectorsIn(readSource(sheet))).toEqual([]);
  });

  it("the global sheets import nothing but each other", () => {
    for (const sheet of GLOBAL_SHEETS) {
      const imports = [...readSource(sheet).matchAll(/@import\s+(?:url\()?["']([^"']+)["']/g)].map((m) => m[1]);
      for (const i of imports) expect(["./design-system.css", "./globals.css"], `${sheet} imports ${i}`).toContain(i);
    }
  });

  it("only the Rounds screen imports the timeline's sheet, and no layout imports a screen's sheet", () => {
    const all = cssImports(join(process.cwd(), "src"));
    const timeline = all.filter((i) => i.sheet.endsWith("rounds-timeline.css"));
    expect(timeline.map((i) => i.file)).toEqual(["src/app/(app)/stages/page.tsx"]);
    // The root layout sends globals.css to every page; it must stay the only sheet a layout sends.
    const fromLayouts = all.filter((i) => /\/layout\.tsx$/.test(i.file));
    expect(fromLayouts).toEqual([{ file: "src/app/layout.tsx", sheet: "./globals.css" }]);
  });
});
