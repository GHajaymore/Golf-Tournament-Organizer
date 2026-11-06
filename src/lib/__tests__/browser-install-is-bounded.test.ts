import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { readVerbatim } from "./source";

/**
 * THE BROWSER INSTALL CANNOT SPEND A JOB'S WHOLE TIME ON ONE SLOW MIRROR.
 *
 * 2026-11-05: `playwright install --with-deps` (apt behind it) ran into its ten-minute
 * step limit three times in two days on a mirror serving a package every two minutes; the
 * shard handed in nothing and `verify` went red. The guarantee pinned here, not the
 * expression: a workflow that installs browsers with their system libraries does it through
 * `scripts/ci/install-browsers.sh` (or a loop of its own that retries), the step keeps a
 * `timeout-minutes` so a real hang still fails, and the script retries under a per-attempt
 * limit that fits inside the step's limit.
 */

const WORKFLOWS = readdirSync(".github/workflows").filter((f) => /\.ya?ml$/.test(f));

/** Steps of a workflow, as the text between `- name:` / `- uses:` lines at the steps' indent. */
export function bareWithDepsInstalls(file: string, text: string): string[] {
  const out: string[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*#/.test(l)) continue;
    if (!/npx playwright install\b[^\n]*--with-deps/.test(l)) continue;
    // A hand-written retry (round.yml) is `timeout N npx playwright install` inside a loop.
    if (/\btimeout \d+ npx playwright install/.test(l)) continue;
    out.push(`${file}:${i + 1}: ${l.trim()}`);
  }
  return out;
}

describe("the browser install is bounded and retried", () => {
  const script = readVerbatim("scripts/ci/install-browsers.sh");

  it("no workflow runs a bare `playwright install --with-deps`", () => {
    const found = WORKFLOWS.flatMap((f) => bareWithDepsInstalls(f, readVerbatim(`.github/workflows/${f}`)));
    expect(found).toEqual([]);
  });

  it("the control: the finder does see a bare install", () => {
    expect(bareWithDepsInstalls("x.yml", "        run: npx playwright install --with-deps chromium")).toHaveLength(1);
    expect(bareWithDepsInstalls("x.yml", "            if timeout 240 npx playwright install --with-deps chromium; then")).toHaveLength(0);
  });

  it("every step that calls the script keeps a time limit that fits its attempts", () => {
    let calls = 0;
    for (const f of WORKFLOWS) {
      const lines = readVerbatim(`.github/workflows/${f}`).split(/\r?\n/);
      lines.forEach((l, i) => {
        if (!/bash scripts\/ci\/install-browsers\.sh/.test(l)) return;
        calls++;
        // The step's own limit sits in the lines just above its `run:`.
        const above = lines.slice(Math.max(0, i - 25), i).join("\n");
        const limits = [...above.matchAll(/timeout-minutes:\s*(\d+)/g)];
        expect(limits.length, `${f}:${i + 1} has no timeout-minutes`).toBeGreaterThan(0);
        const minutes = Number(limits[limits.length - 1][1]);
        // two attempts of four minutes and a pause is just over eight
        expect(minutes, `${f}:${i + 1}`).toBeGreaterThanOrEqual(9);
        expect(minutes, `${f}:${i + 1}`).toBeLessThanOrEqual(15);
      });
    }
    expect(calls).toBeGreaterThanOrEqual(4);
  });

  it("the script retries, bounds each attempt, and still fails in the end", () => {
    expect(script).toMatch(/attempts=2/);
    expect(script).toMatch(/timeout 240 npx playwright install --with-deps/);
    expect(script).toMatch(/Acquire::http::Timeout/);
    expect(script).toMatch(/Acquire::Retries/);
    expect(script).toMatch(/exit 1/);
  });
});
