import { describe, expect, it } from "vitest";
import { readSource } from "./source";

/**
 * UNDER REDUCED MOTION, TRANSITIONS ARE OFF — NOT SHORTENED.
 *
 * `transition-property` defaults to `all`. So a reduced-motion rule that sets
 * only `transition-duration` on `*` does not shorten the transitions the app
 * declares: it gives one to EVERY property of EVERY element, and each change
 * is drawn a frame late.
 *
 * Measured 2026-10-06, sampling the "More about" panel per frame at 320px: its
 * first frame drew at the unplaced position, right edge 323.5, while the inline
 * transform that placed it was already set. CI read that frame twice as 324
 * against 321, and the panel then came to rest 11px off because a second
 * measurement landed in the gap. Playwright runs every test with reduced
 * motion, so the whole e2e suite was measuring a page one frame behind itself.
 *
 * The landing page's stylesheet is the site session's and is not swept here.
 */
const SHEETS = ["src/app/design-system.css", "src/app/globals.css"];

/** The body of every `@media (prefers-reduced-motion: reduce)` block. */
function reducedMotionBlocks(css: string): string[] {
  const blocks: string[] = [];
  let from = 0;
  for (;;) {
    const at = css.indexOf("prefers-reduced-motion: reduce", from);
    if (at < 0) return blocks;
    const open = css.indexOf("{", at);
    let depth = 0;
    let i = open;
    for (; i < css.length; i++) {
      if (css[i] === "{") depth++;
      if (css[i] === "}" && --depth === 0) break;
    }
    blocks.push(css.slice(open, i + 1));
    from = i;
  }
}

describe("reduced motion turns transitions off", () => {
  const blocks = SHEETS.flatMap((f) => reducedMotionBlocks(readSource(f)).map((b) => ({ f, b })));

  it("finds the reduced-motion rules at all (control)", () => {
    expect(blocks.some(({ f }) => f.endsWith("design-system.css"))).toBe(true);
  });

  it("the global rule switches transitions off", () => {
    const global = blocks.find(({ f, b }) => f.endsWith("design-system.css") && b.includes("*, *::before, *::after"));
    expect(global, "the global reduced-motion rule in design-system.css").toBeDefined();
    expect(global!.b).toMatch(/transition:\s*none\s*!important/);
  });

  it("no reduced-motion rule only shortens a transition", () => {
    for (const { f, b } of blocks) {
      expect(b, `${f} sets a transition duration under reduced motion`).not.toMatch(/transition-duration/);
    }
  });
});
