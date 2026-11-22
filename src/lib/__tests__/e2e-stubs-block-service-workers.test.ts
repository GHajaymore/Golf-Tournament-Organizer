import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readSource } from "./source";

/**
 * B100: on WebKit a service worker makes fetches itself, so a Playwright
 * `page.route` / `context.route` stub never answers. A file under e2e that stubs
 * requests must block service workers (`serviceWorkers: "block"` on its context or
 * in `test.use`). Trap and rule: docs/claude/e2e-traps.md.
 */

// `.route(`, a chained `\n  .route(`, `routeFromHAR(`, `routeWebSocket(`.
const STUB = /\.\s*route(?:FromHAR|WebSocket)?\s*\(/;

function stubsWithoutBlocking(src: string): boolean {
  const blocks = /serviceWorkers\s*:\s*["']block["']/.test(src);
  return STUB.test(src) && !blocks;
}

// Every .ts under e2e: specs and helpers alike.
const files = readdirSync("e2e", { recursive: true })
  .map(String)
  .filter((f) => f.replace(/\\/g, "/").endsWith(".ts"));

describe("a file that stubs requests blocks service workers", () => {
  it("CONTROL: the guard sees the files, and sees an offending one", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => f.replace(/\\/g, "/").endsWith(".spec.ts"))).toBe(true);
    expect(stubsWithoutBlocking('await page.route("**/x", (r) => r.abort());')).toBe(true);
    expect(stubsWithoutBlocking('await context.route("**/x", (r) => r.abort());')).toBe(true);
    expect(stubsWithoutBlocking('await page\n  .route("**/x", (r) => r.abort());')).toBe(true);
    expect(stubsWithoutBlocking('await page.routeFromHAR("x.har");')).toBe(true);
    expect(stubsWithoutBlocking('await page.routeWebSocket("**/ws", () => {});')).toBe(true);
    expect(stubsWithoutBlocking('test.use({ serviceWorkers: "block" });\nawait page.route("**/x", (r) => r.abort());')).toBe(false);
    expect(stubsWithoutBlocking("await page.goto('/');")).toBe(false);
  });

  it("no e2e file calls .route( without serviceWorkers: 'block'", () => {
    const offenders = files.filter((f) => stubsWithoutBlocking(readSource("e2e", f)));
    expect(offenders, `no service worker blocked in: ${offenders.join(", ")}`).toEqual([]);
  });
});
