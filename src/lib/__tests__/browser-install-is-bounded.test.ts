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
 *
 * Since 2026-11-06 a job that needs Playwright's own engines runs in Playwright's container image
 * and installs nothing (browser-image-matches-the-lockfile.test.ts); this guard stays for every
 * job that still installs (round.yml's parts that drive the installed Chrome or Edge).
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

/** Lines (1-based) of a workflow that install a browser, comments left out. */
export function installLines(text: string): number[] {
  return text
    .split(/\r?\n/)
    .flatMap((l, i) => (/^\s*#/.test(l) ? [] : /playwright install\b|install-browsers\.sh/.test(l) ? [i + 1] : []));
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
    for (const f of WORKFLOWS) {
      const lines = readVerbatim(`.github/workflows/${f}`).split(/\r?\n/);
      lines.forEach((l, i) => {
        if (!/bash scripts\/ci\/install-browsers\.sh/.test(l)) return;
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
  });

  it("a workflow in Playwright's image installs nothing, except round.yml's parts that cannot use it", () => {
    const inImage = WORKFLOWS.filter((f) => /mcr\.microsoft\.com\/playwright:/.test(readVerbatim(`.github/workflows/${f}`)));
    expect(inImage.sort()).toEqual(["breaks.yml", "browsers.yml", "ci.yml", "round.yml"]);
    for (const f of inImage) {
      const text = readVerbatim(`.github/workflows/${f}`);
      const installs = installLines(text);
      if (f !== "round.yml") {
        expect(installs, `${f} runs in the image and must not install`).toEqual([]);
        continue;
      }
      // round.yml keeps its bounded loop for the parts that drive the installed Chrome or Edge, and the
      // step's own condition says a part in the image skips it.
      expect(installs.length, "round.yml still installs for its channel parts").toBeGreaterThan(0);
      const step = text.slice(text.indexOf("- name: Install the browser this part drives"));
      const condition = /\n\s*if: (.*)\n/.exec(step)?.[1] ?? "";
      expect(condition, "the install step must skip a part that runs in the image").toMatch(/!contains\(fromJSON/);
    }
  });

  it("the control: the install finder sees an install and ignores a comment", () => {
    expect(installLines("run: npx playwright install chromium")).toEqual([1]);
    expect(installLines("run: bash scripts/ci/install-browsers.sh chromium")).toEqual([1]);
    expect(installLines("# npx playwright install chromium")).toEqual([]);
  });

  it("the script retries, bounds each attempt, and still fails in the end", () => {
    expect(script).toMatch(/attempts=2/);
    expect(script).toMatch(/timeout 240 npx playwright install --with-deps/);
    expect(script).toMatch(/Acquire::http::Timeout/);
    expect(script).toMatch(/Acquire::Retries/);
    expect(script).toMatch(/exit 1/);
  });
});
