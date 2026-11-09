import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { readVerbatim } from "./source";
import { jobsOf } from "./workflow-jobs";

/**
 * A BROWSER INSTALL CANNOT SPEND A JOB'S WHOLE TIME ON ONE SLOW MIRROR, AND A JOB IN PLAYWRIGHT'S
 * IMAGE INSTALLS NOTHING.
 *
 * 2026-11-05: `playwright install --with-deps` (apt behind it) ran into its ten-minute
 * step limit three times in two days on a mirror serving a package every two minutes; the
 * shard handed in nothing and `verify` went red. Since 2026-11-06 every job that needs
 * Playwright's own engines runs in Playwright's container image
 * (browser-image-matches-the-lockfile.test.ts) and installs none. The guarantees pinned here,
 * not the expressions:
 *  - no job that runs in the image has an install line (per JOB, not per file);
 *  - the one install that remains (round.yml's parts that drive the INSTALLED Chrome or Edge,
 *    which the image does not hold) is a bounded, retried loop, and is skipped by a part in the image;
 *  - nobody runs a bare `playwright install --with-deps`.
 */

const WORKFLOWS = readdirSync(".github/workflows").filter((f) => /\.ya?ml$/.test(f));

/** Lines of a workflow that run a bare `--with-deps` install (a bounded `timeout N` loop is fine). */
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

/** Install lines of a text, comments left out. */
export function installLines(text: string): number[] {
  return text.split(/\r?\n/).flatMap((l, i) => (/^\s*#/.test(l) ? [] : /playwright install\b/.test(l) ? [i + 1] : []));
}

const IN_IMAGE = /mcr\.microsoft\.com\/playwright:/;

describe("the browser install is bounded, retried, and absent from a job in the image", () => {
  it("no workflow runs a bare `playwright install --with-deps`", () => {
    const found = WORKFLOWS.flatMap((f) => bareWithDepsInstalls(f, readVerbatim(`.github/workflows/${f}`)));
    expect(found).toEqual([]);
  });

  it("the control: the finder does see a bare install", () => {
    expect(bareWithDepsInstalls("x.yml", "        run: npx playwright install --with-deps chromium")).toHaveLength(1);
    expect(bareWithDepsInstalls("x.yml", "            if timeout 240 npx playwright install --with-deps chromium; then")).toHaveLength(0);
  });

  it("the old script is gone, so nothing calls an unbounded one by another name", () => {
    for (const f of WORKFLOWS) expect(readVerbatim(`.github/workflows/${f}`), f).not.toMatch(/install-browsers\.sh/);
  });

  it("a job that runs in the image has no install line, except round.yml's part, which skips it there", () => {
    let seen = 0;
    for (const f of WORKFLOWS) {
      for (const [name, text] of Object.entries(jobsOf(readVerbatim(`.github/workflows/${f}`)))) {
        if (!IN_IMAGE.test(text)) continue;
        seen++;
        const installs = installLines(text);
        if (`${f}:${name}` !== "round.yml:part") {
          expect(installs, `${f}:${name} runs in the image and must not install`).toEqual([]);
          continue;
        }
        expect(installs.length, "round.yml:part still installs for its Chrome and Edge parts").toBeGreaterThan(0);
        const step = text.slice(text.indexOf("- name: Install the browser this part drives"));
        const condition = /\n\s*if: (.*)\n/.exec(step)?.[1] ?? "";
        expect(condition, "the install step must skip a part that runs in the image").toMatch(/!matrix\.part\.image/);
        // and that remaining install is bounded and retried
        expect(step).toMatch(/for attempt in 1 2 3/);
        expect(step).toMatch(/timeout 240 npx playwright install --with-deps/);
        expect(step).toMatch(/timeout-minutes:\s*14/);
      }
    }
    expect(seen, "the sweep found the image jobs").toBeGreaterThanOrEqual(5);
  });

  it("the control: a per-job sweep does not let another job's install excuse this one", () => {
    const text = ["jobs:", "  a:", "    container:", "      image: mcr.microsoft.com/playwright:v1", "  b:", "    steps:", "      - run: npx playwright install chromium"].join("\n");
    const jobs = jobsOf(text);
    expect(installLines(jobs.a)).toEqual([]);
    expect(installLines(jobs.b)).toEqual([7 - 4]);
    expect(installLines("# npx playwright install chromium")).toEqual([]);
  });
});
