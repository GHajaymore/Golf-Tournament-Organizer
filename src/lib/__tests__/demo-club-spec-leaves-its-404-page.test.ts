import { describe, it, expect } from "vitest";
import { readSource } from "./source";

/**
 * B104: THE STRANGER'S 404 TEST LEAVES ITS PAGE BEFORE ITS CONTEXT IS CLOSED.
 *
 * `chrome-headless-shell` died (SEGV_MAPERR, cr2=0x1b0) at the `newContext` of
 * `demo-club.spec.ts` "the owner creates the demo club…" three times (21 and 22 Nov). What the
 * three have in common is not the test before the pair (commentary once, deleting-for-good once)
 * but the pair itself: the 226-294 ms "somebody who is not the owner" test, which ends on a 404
 * page and has its context closed at once, comes immediately before every crash. So that test
 * waits for the page to be idle and unloads it before it returns. Retries stay at zero.
 */
describe("demo-club.spec: the stranger's 404 test", () => {
  const src = readSource("e2e", "demo-club.spec.ts");
  const start = src.indexOf("somebody who is not the owner finds no demo button");
  const end = src.indexOf("the owner creates the demo club, then refreshes it");
  const body = src.slice(start, end);

  it("is found where this guard expects it", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });
  it("waits for the 404 page to go idle, then unloads it", () => {
    expect(body).toMatch(/waitForLoadState\(\s*"networkidle"/);
    expect(body).toMatch(/page\.goto\(\s*"about:blank"\s*\)/);
    expect(body.indexOf("about:blank")).toBeGreaterThan(body.indexOf("networkidle"));
  });
});

describe("demo-club.spec: its own browser, and a wait that cannot fail the test", () => {
  const src = readSource("e2e", "demo-club.spec.ts");
  it("changes a worker option so the file gets a fresh browser", () => {
    expect(src).toMatch(/test\.use\(\{\s*launchOptions:/);
  });
  it("never fails on the idle wait", () => {
    expect(src).toMatch(/waitForLoadState\(\s*"networkidle"[^)]*\)\s*\.catch\(/);
  });
});
