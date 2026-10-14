import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { readSource } from "./source";

/**
 * "AUTO-CONFIRMED" IS WORKED OUT, NEVER STORED.
 *
 * `effectiveScoreStatus` says a result is auto-confirmed when it has been left
 * pending long enough where players approve; nothing writes that word into
 * `Match.scoreStatus`. So a guard that compares the COLUMN with it can never be
 * true, and a result that has confirmed itself reads as pending through it.
 * `disputeMatch` had exactly that guard until 2026-10-14
 * (`an-auto-confirmed-result-is-not-disputed-by-a-player.audit.test.ts`).
 * Ask `effectiveScoreStatus(match, allowsAutoConfirm(settings))`.
 */
describe("the auto-confirmed status", () => {
  function sources(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name === "__tests__" || e.name === "node_modules") continue;
        sources(rel, out);
      } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(rel);
    }
    return out;
  }
  const COLUMN_ASKED = /scoreStatus\s*[!=]==?\s*["']auto-confirmed["']/;
  const WRITTEN = /scoreStatus:\s*["']auto-confirmed["']/;

  it("CONTROL: the sweep recognises the guard it replaced, and not the effective status", () => {
    expect(COLUMN_ASKED.test('    if (match.scoreStatus === "confirmed" || match.scoreStatus === "auto-confirmed") {')).toBe(true);
    expect(COLUMN_ASKED.test('    if (status === "confirmed" || status === "auto-confirmed") {')).toBe(false);
    expect(WRITTEN.test('    data: { scoreStatus: "auto-confirmed" },')).toBe(true);
  });

  it("is never compared with the stored column, and never written into it", () => {
    const files = sources("src");
    expect(files.length).toBeGreaterThan(400);
    const asked = files.filter((f) => COLUMN_ASKED.test(readSource(f)));
    const written = files.filter((f) => WRITTEN.test(readSource(f)));
    expect(asked, "ask effectiveScoreStatus(match, allowsAutoConfirm(settings))").toEqual([]);
    expect(written).toEqual([]);
  });
});
