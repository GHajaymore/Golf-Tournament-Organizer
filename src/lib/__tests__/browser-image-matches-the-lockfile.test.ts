import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { readVerbatim } from "./source";

/**
 * THE BROWSER JOBS RUN IN PLAYWRIGHT'S IMAGE, AND THE IMAGE IS THE LOCKED VERSION'S.
 *
 * 2026-11-06: `playwright install --with-deps` went to Ubuntu's mirror on every run and timed
 * out on a slow one, daily. A job now runs in `mcr.microsoft.com/playwright:v<X>-noble`, which
 * holds the browsers and their libraries, so no apt runs. The browsers in an image are the ones
 * of ONE Playwright version; if the tag and the `@playwright/test` in package-lock.json ever
 * differ, the browsers are not the ones the runner expects and every test cannot launch. The
 * guarantee pinned here, not the expression: every image tag in a workflow is the locked version,
 * exactly (package.json says `^1.62.1`, so a bump of the lockfile alone would otherwise drift).
 */

const WORKFLOWS = readdirSync(".github/workflows").filter((f) => /\.ya?ml$/.test(f));
const IMAGE = /mcr\.microsoft\.com\/playwright:([^\s"']+)/g;

export function lockedPlaywright(): string {
  const lock = JSON.parse(readVerbatim("package-lock.json")) as { packages: Record<string, { version: string }> };
  return lock.packages["node_modules/@playwright/test"].version;
}

/** Every Playwright image tag a workflow's text names, with its line. */
export function imageTags(file: string, text: string): { at: string; tag: string }[] {
  const out: { at: string; tag: string }[] = [];
  text.split(/\r?\n/).forEach((l, i) => {
    if (/^\s*#/.test(l)) return;
    for (const m of l.matchAll(IMAGE)) out.push({ at: `${file}:${i + 1}`, tag: m[1] });
  });
  return out;
}

/** Tags that are not exactly `v<locked>-noble`. */
export function wrongTags(tags: { at: string; tag: string }[], locked: string): string[] {
  return tags.filter((t) => t.tag !== `v${locked}-noble`).map((t) => `${t.at}: ${t.tag} (locked ${locked})`);
}

describe("the Playwright image is the locked @playwright/test version", () => {
  const locked = lockedPlaywright();
  const all = WORKFLOWS.flatMap((f) => imageTags(f, readVerbatim(`.github/workflows/${f}`)));

  it("the lockfile names a plain version", () => {
    expect(locked).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("every image tag in every workflow is exactly v<locked>-noble", () => {
    expect(wrongTags(all, locked)).toEqual([]);
  });

  it("the jobs that need browsers are in it (control: the sweep is not looking at nothing)", () => {
    const files = new Set(all.map((t) => t.at.split(":")[0]));
    for (const f of ["ci.yml", "round.yml", "browsers.yml", "breaks.yml"]) expect(files, f).toContain(f);
  });

  it("the control: the checker does see a drifted tag, a floating one, and a bare version", () => {
    const text = [
      "      image: mcr.microsoft.com/playwright:v1.0.0-noble",
      "      image: mcr.microsoft.com/playwright:latest",
      "      image: mcr.microsoft.com/playwright:v" + locked,
      "      image: mcr.microsoft.com/playwright:v" + locked + "-noble",
      "      # image: mcr.microsoft.com/playwright:v0.0.1-noble",
    ].join("\n");
    const found = imageTags("x.yml", text);
    expect(found).toHaveLength(4);
    expect(wrongTags(found, locked)).toHaveLength(3);
  });

  it("a job in the image reaches its database on localhost through the setup action", () => {
    for (const f of WORKFLOWS) {
      const text = readVerbatim(`.github/workflows/${f}`);
      if (!/container:/.test(text) || !/mcr\.microsoft\.com\/playwright/.test(text)) continue;
      // The service is `postgres`, named, and the action forwards localhost to it.
      expect(text, f).toMatch(/database-host:.*postgres/);
    }
    expect(readVerbatim(".github/actions/setup/action.yml")).toMatch(/forward-postgres\.mjs/);
  });
});
