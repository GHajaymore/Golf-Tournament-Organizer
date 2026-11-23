import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { readSource } from "./source";

/**
 * NO `networkidle` (backlog B108, 23 Nov 2026).
 *
 * `page.waitForLoadState("networkidle")` hangs in this app: the service worker (sw.js) keeps the network busy, so it
 * never settles. On 23 Nov it failed four CI jobs (R8a named-side-bet, R7 members, R7 tournament-access, R12
 * match-results); each was fixed by waiting on a visible element or on the URL instead.
 *
 *   1. No `@redesign` describe block may contain it.
 *   2. Every other use is RATCHETED: the count across `e2e/**` may only fall.
 *
 * Source is read through `readSource` (comments stripped), so a comment explaining why a spec does not use it counts
 * for nothing. Existing uses are NOT converted here: that is later ratchet work.
 */

/** Uses of `networkidle` in e2e code (comments stripped), measured 23 Nov 2026. NEVER RAISE: lower it as uses go. */
export const NETWORKIDLE_CAP = 430;

const E2E = join(process.cwd(), "e2e");

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? tsFiles(p) : e.name.endsWith(".ts") ? [p] : [];
  });
}

/** Every `test.describe("@redesign…", …)` block of one source: the text up to its closing paren. */
function redesignBodies(src: string): string[] {
  const out: string[] = [];
  const START = /test\.describe(?:\.\w+)?\(\s*(["'`])@redesign(?:(?!\1).)*\1/g;
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
    out.push(src.slice(open, end === -1 ? src.length : end));
  }
  return out;
}

const files = tsFiles(E2E);
const sources = files.map((f) => {
  const rel = relative(process.cwd(), f).replace(/\\/g, "/");
  return { name: rel, src: readSource(rel) };
});
const inRedesign = () => sources.filter((s) => redesignBodies(s.src).some((b) => b.includes("networkidle"))).map((s) => s.name);

/**
 * Specs whose `@redesign` block already holds one on 23 Nov 2026 (all `.catch(() => {})`-wrapped). Found when this
 * guard was written; converting them is the later ratchet work. OWNER: Test Engineer. Capped at 3; it may only shrink.
 */
const KNOWN_IN_REDESIGN: readonly string[] = ["e2e/access.spec.ts", "e2e/club-staff.spec.ts", "e2e/tournament-access.spec.ts"];

const count = sources.reduce((n, s) => n + (s.src.match(/networkidle/g)?.length ?? 0), 0);

describe("no networkidle in e2e (the service worker keeps the network busy)", () => {
  it("finds the specs and the @redesign blocks (a broken reader would pass on none)", () => {
    expect(files.length).toBeGreaterThan(150);
    expect(sources.flatMap((s) => redesignBodies(s.src)).length).toBeGreaterThanOrEqual(30);
  });

  it("no @redesign block contains networkidle: wait on a visible element or expect(page).toHaveURL(...)", () => {
    const bad = inRedesign().filter((n) => !KNOWN_IN_REDESIGN.includes(n));
    expect(bad).toEqual([]);
  });

  it("KNOWN_IN_REDESIGN is capped and honest: it only shrinks, and names only files that still have the problem", () => {
    expect(KNOWN_IN_REDESIGN.length, "never raise the cap: fix the block instead").toBeLessThanOrEqual(3);
    for (const k of KNOWN_IN_REDESIGN) expect(inRedesign(), `${k} is clean now: take it off the list`).toContain(k);
  });

  it("CONTROL: the finder sees a planted networkidle inside a block, and not one outside", () => {
    const inside = `test.describe("@redesign x", () => {\n test("a", async ({ page }) => {\n await page.waitForLoadState("networkidle");\n });\n});`;
    const outside = `test.describe("plain", () => {\n await page.waitForLoadState("networkidle");\n});\ntest.describe("@redesign y", () => {\n});`;
    expect(redesignBodies(inside).some((b) => b.includes("networkidle"))).toBe(true);
    expect(redesignBodies(outside).some((b) => b.includes("networkidle"))).toBe(false);
  });

  it("the count of networkidle uses never rises above NETWORKIDLE_CAP", () => {
    expect(count, "a new networkidle hangs on the service worker: wait on a visible element or expect(page).toHaveURL(...). NEVER raise NETWORKIDLE_CAP").toBeLessThanOrEqual(NETWORKIDLE_CAP);
  });

  it("the cap stays honest: it is within 10% of the count", () => {
    expect(count, `only ${count} uses remain: lower NETWORKIDLE_CAP to ${count}`).toBeGreaterThanOrEqual(NETWORKIDLE_CAP * 0.9);
  });
});
