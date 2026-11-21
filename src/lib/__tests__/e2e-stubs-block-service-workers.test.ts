import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readSource } from "./source";

/**
 * B100: on WebKit a service worker makes fetches itself, so a Playwright
 * `page.route` / `context.route` stub never answers. A spec that stubs requests
 * must block service workers (`serviceWorkers: "block"` on its context or in
 * `test.use`). Trap and rule: docs/claude/e2e-traps.md.
 */

function stubsWithoutBlocking(src: string): boolean {
  const stubs = /\b[A-Za-z_$][\w$]*\.route\(/.test(src);
  const blocks = /serviceWorkers\s*:\s*["']block["']/.test(src);
  return stubs && !blocks;
}

const specs = readdirSync("e2e", { recursive: true })
  .map(String)
  .filter((f) => f.replace(/\\/g, "/").endsWith(".spec.ts"));

describe("a spec that stubs requests blocks service workers", () => {
  it("CONTROL: the guard sees the specs, and sees an offending one", () => {
    expect(specs.length).toBeGreaterThan(50);
    expect(stubsWithoutBlocking('await page.route("**/x", (r) => r.abort());')).toBe(true);
    expect(stubsWithoutBlocking('await context.route("**/x", (r) => r.abort());')).toBe(true);
    expect(stubsWithoutBlocking('test.use({ serviceWorkers: "block" });\nawait page.route("**/x", (r) => r.abort());')).toBe(false);
    expect(stubsWithoutBlocking("await page.goto('/');")).toBe(false);
  });

  it("no spec calls .route( without serviceWorkers: 'block'", () => {
    const offenders = specs.filter((f) => stubsWithoutBlocking(readSource("e2e", f)));
    expect(offenders, `no service worker blocked in: ${offenders.join(", ")}`).toEqual([]);
  });
});
