import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";

/**
 * A SPEC CLOSES EVERY BROWSER CONTEXT IT OPENS, ONE AT A TIME.
 *
 * `chrome-headless-shell` has died between two desktop tests (SEGV_MAPERR, cr2=0x1b0) with
 * `demo-club.spec.ts:81` the victim, straight after `commentary.spec.ts`, which opens three contexts
 * with live pages. The browser is one process for the whole worker, so how a spec leaves it is
 * the one thing a spec controls. Two refusals:
 *
 *   1. a context a spec makes for itself (`browser.newContext(`) is named in a `.close()` or in
 *      `closeAll(...)` (from `e2e/coverage.ts`: pages, then context, awaited in turn);
 *   2. closes are never raced in a `Promise.all([...].map(... close()))`.
 *
 * A request context (`playwright.request.newContext`) has no page and is not in scope.
 */

const E2E = join(process.cwd(), "e2e");

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : files(p);
    return e.name.endsWith(".ts") ? [p] : [];
  });
}

/** What is wrong with this source, each in a sentence. */
export function contextRefusals(src: string): string[] {
  const out: string[] = [];
  if (/Promise\.all\([^;]*\.close\(/.test(src)) out.push("closes are raced in a Promise.all; use closeAll(...)");
  const made = [...src.matchAll(/(?:const|let)\s+(\w+)\s*=\s*await\s+[\w.()!]*?(?<!request)\.newContext\(/g)].map((m) => m[1]);
  const closeAllArgs = [...src.matchAll(/closeAll\(([^)]*)\)/g)].map((m) => m[1]).join(",");
  for (const name of new Set(made)) {
    // A factory hands the context back and its callers close it (the sweep does not follow them).
    const handedBack = new RegExp(`return\\s+${name}\\b`).test(src);
    const closed = handedBack || new RegExp(`\\b${name}\\.close\\(`).test(src) || new RegExp(`\\b${name}\\b`).test(closeAllArgs);
    if (!closed) out.push(`context "${name}" is opened and never closed`);
  }
  return out;
}

describe("every browser context a spec opens is closed, in turn", () => {
  const all = files(E2E).filter((f) => !f.endsWith("coverage.ts")).map((f) => f.slice(process.cwd().length + 1));

  it("CONTROL: a spec that forgets one, or races the closes, is refused", () => {
    expect(contextRefusals(`const a = await browser.newContext({});\nconst b = await browser.newContext({});\nawait closeAll(a);`)).toEqual(['context "b" is opened and never closed']);
    expect(contextRefusals(`const a = await browser.newContext({});\nawait Promise.all([a].map((c) => c.close()));`).length).toBeGreaterThan(0);
    expect(contextRefusals(`const a = await browser.newContext({});\ntry {} finally { await closeAll(a); }`)).toEqual([]);
    expect(contextRefusals(`const a = await playwright.request.newContext({});`)).toEqual([]);
  });

  it("CONTROL: the sweep reads the specs at all, and finds contexts opened by hand", () => {
    expect(all.length).toBeGreaterThan(100);
    const opening = all.filter((f) => /\.newContext\(/.test(readSource(f)));
    expect(opening.length).toBeGreaterThan(20);
  });

  it("no spec leaves a context open or races its closes", () => {
    const bad = all.flatMap((f) => contextRefusals(readSource(f)).map((r) => `${f.slice(4)}: ${r}`));
    expect(bad).toEqual([]);
  });
});
