import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { readSource } from "./source";

/**
 * THE TYPE FLOOR, ACROSS THE CONSOLE — Ajay, 2026-10-05: "I just want a clean
 * user experience", after a screen-by-screen measure found 34% to 81% of the
 * organizer screens' text under 13px, on phone and desktop alike.
 *
 * Labels 13px, sentences 14px. Swept from the filesystem rather than listed,
 * so a component added next month is covered the day it is written.
 *
 * Exempt, each for a reason a reviewer can check:
 */
const EXEMPT: Record<string, string> = {
  "src/components/ScorecardTable.tsx": "the 18-hole grid keeps its density — eighteen columns on a phone",
  "src/components/TeeSheetPrint.tsx": "a print sheet, laid out for paper",
  "src/components/LandingAuth.tsx": "the landing pages belong to the site session",
  "src/components/LandingEffects.tsx": "the landing pages belong to the site session",
  "src/components/OwnerPricing.tsx": "the owner's pricing page, not the console",
  "src/components/SiteAnalytics.tsx": "draws no text",
};

const ROOT = process.cwd();
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "__tests__") walk(p, out);
    } else if (p.endsWith(".tsx")) out.push(relative(ROOT, p).split("\\").join("/"));
  }
  return out;
}
const FILES = [...walk(join(ROOT, "src", "components")), ...walk(join(ROOT, "src", "app", "(app)"))];
const sizes = (src: string) => [...src.matchAll(/fontSize:\s*(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));

describe("no console text is set under 13px", () => {
  it("is reading something — the control", () => {
    expect(FILES.length).toBeGreaterThan(100);
    expect(sizes("style={{ fontSize: 11.5 }}")).toEqual([11.5]);
    // The exempt grid really does still carry small type, so the exemption is
    // doing something rather than excusing a file that would pass anyway.
    expect(sizes(readSource("src/components/ScorecardTable.tsx")).some((n) => n < 13)).toBe(true);
  });

  it("names every exemption that exists", () => {
    for (const f of Object.keys(EXEMPT)) expect(FILES, `${f} is exempt but gone`).toContain(f);
  });

  it.each(FILES.filter((f) => !(f in EXEMPT)))("%s", (file) => {
    const small = sizes(readSource(file)).filter((n) => n < 13);
    expect(small, `${file} sets text at ${small.join(", ")}px`).toEqual([]);
  });
});

describe("the shared classes hold the floor", () => {
  // Through `readSource`, comments stripped: a comment naming a size must not
  // satisfy the rule it describes (source-guard.test.ts).
  const css = readSource("src/app/design-system.css") + readSource("src/app/globals.css");
  const sizeOf = (selector: string) => {
    const at = css.indexOf(`${selector} {`);
    expect(at, `${selector} not found`).toBeGreaterThan(-1);
    const block = css.slice(at, css.indexOf("}", at));
    return Number(/font-size:\s*(\d+(?:\.\d+)?)px/.exec(block)?.[1]);
  };

  it.each([".card-kicker", ".page-kicker", ".tag", ".card-meta", ".match-row-meta", ".mini-row", ".rank-badge", ".mode-opt-blurb", ".mode-opt-why", ".field > label", ".table th", ".sb-head", ".sb-hole-n"])(
    "%s is at least 13px",
    (selector) => {
      expect(sizeOf(selector)).toBeGreaterThanOrEqual(13);
    },
  );

  it("keeps its one deliberate exception at 12px, and no lower", () => {
    // The tab bar, where the icon carries the meaning — said in globals.css
    // beside the rule. Table heads were the second exception until
    // 2026-10-06: on a player's Board they are what is read.
    expect(sizeOf(".m-tab")).toBe(12);
  });
});
