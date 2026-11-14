import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { readSource } from "./source";

/**
 * A SPEC PRESSES THE CONTROL IT MEANS, NEVER EVERY MATCH OF A SELECTOR (CI on #1133).
 *
 * `a-guest-in-messages.spec.ts` opened Today's extender by pressing every
 * closed `<summary>` on the page: `for (const s of await …all()) await s.click()`.
 * Some were hidden, and a press on a hidden control waits for actionability
 * until the TEST times out — so on desktop, phone and small phone the run said
 * only "Test timeout of 240000ms exceeded" at the `finally`, with no step and no
 * expectation named. Name the one control (Today's is `summary` "More: …").
 */

const PRESS_EVERY = /for\s*\(\s*const\s+\w+\s+of\s+await\s+[^;]*?\.all\(\)\s*\)\s*await\s+\w+\.(click|tap|check)\(/;

describe("specs press one named control", () => {
  it("no spec presses every element a selector matches", () => {
    const files = readdirSync("e2e").filter((f) => f.endsWith(".ts"));
    const offenders = files.filter((f) => PRESS_EVERY.test(readSource("e2e", f)));
    expect(offenders, "press the one control by its role and words; a hidden match never ends the press").toEqual([]);
  });

  it("CONTROL: the shape is seen, and naming one control is not", () => {
    expect(PRESS_EVERY.test('for (const s of await g.locator("details:not([open]) > summary").all()) await s.click().catch(() => {});')).toBe(true);
    expect(PRESS_EVERY.test('const more = g.locator("summary", { hasText: /^More:/ });\nif (await more.count()) await more.first().click(PRESS);')).toBe(false);
  });
});
