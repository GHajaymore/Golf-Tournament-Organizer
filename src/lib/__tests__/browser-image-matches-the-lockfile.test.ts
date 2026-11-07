import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { readVerbatim } from "./source";
import { jobsOf } from "./workflow-jobs";

/**
 * THE BROWSER JOBS RUN IN PLAYWRIGHT'S IMAGE, AND THE IMAGE IS THE LOCKED VERSION'S.
 *
 * 2026-11-06: `playwright install --with-deps` went to Ubuntu's mirror on every run and timed
 * out on a slow one, daily. A job now runs in `mcr.microsoft.com/playwright:v<X>-noble@sha256:…`,
 * which holds the browsers and their libraries, so no apt runs. The browsers in an image are the
 * ones of ONE Playwright version; if the tag and the `@playwright/test` in package-lock.json ever
 * differ, the browsers are not the ones the runner expects and every test cannot launch. The
 * guarantee pinned here, not the expression: EVERY JOB that names the image names exactly the
 * locked version, pins a digest, runs as user 1001 (Firefox refuses to start as root when $HOME is
 * owned by the runner's uid 1001) and reaches its database through the setup action's forwarder.
 * (package.json says `^1.62.1`, so a bump of the lockfile alone would otherwise drift.)
 */

const WORKFLOWS = readdirSync(".github/workflows").filter((f) => /\.ya?ml$/.test(f));
const IMAGE = /mcr\.microsoft\.com\/playwright:([^\s"',}]+)/g;

export function lockedPlaywright(): string {
  const lock = JSON.parse(readVerbatim("package-lock.json")) as { packages: Record<string, { version: string }> };
  return lock.packages["node_modules/@playwright/test"].version;
}

/** Image tags a job's text names, comments left out. */
export function imageTags(job: string): string[] {
  const out: string[] = [];
  for (const l of job.split(/\r?\n/)) {
    if (/^\s*#/.test(l)) continue;
    for (const m of l.matchAll(IMAGE)) out.push(m[1]);
  }
  return out;
}

/** Why a job's image is not acceptable; empty means it is. */
export function imageProblems(job: string, locked: string): string[] {
  const problems: string[] = [];
  const tags = imageTags(job);
  for (const t of tags) {
    if (!new RegExp(`^v${locked.replace(/\./g, "\\.")}-noble@sha256:[0-9a-f]{64}$`).test(t)) {
      problems.push(`tag ${t} is not v${locked}-noble@sha256:<digest>`);
    }
  }
  const code = job.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join("\n");
  if (tags.length > 0) {
    if (!/--user 1001\b/.test(code)) problems.push("the container options lack --user 1001");
    if (!/database-host:.*postgres/.test(code)) problems.push("no database-host: postgres for the setup action");
    if (/\bcontainer:[^\n]*\|\| null/.test(code)) problems.push("`|| null` where '' is the documented no-container value");
  }
  return problems;
}

describe("the Playwright image is the locked @playwright/test version", () => {
  const locked = lockedPlaywright();
  const perJob = WORKFLOWS.flatMap((f) =>
    Object.entries(jobsOf(readVerbatim(`.github/workflows/${f}`))).map(([name, text]) => ({ id: `${f}:${name}`, text })),
  );
  const inImage = perJob.filter((j) => imageTags(j.text).length > 0);

  it("the lockfile names a plain version", () => {
    expect(locked).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("exactly these jobs run in the image (control: the sweep is not looking at nothing)", () => {
    expect(inImage.map((j) => j.id).sort()).toEqual([
      "breaks.yml:baseline",
      "breaks.yml:break",
      "browsers.yml:suite",
      "ci.yml:e2e",
      "round.yml:part",
    ]);
  });

  it("every one of them: locked version, a digest, user 1001, its database forwarded", () => {
    for (const j of inImage) expect(imageProblems(j.text, locked), j.id).toEqual([]);
  });

  it("a name in a comment or another job does not stand in for the job's own (per job, not per file)", () => {
    const job = ["  e2e:", "    container:", "      image: mcr.microsoft.com/playwright:v" + locked + "-noble@sha256:" + "a".repeat(64), "      options: --ipc=host"].join("\n");
    expect(imageProblems(job, locked)).toEqual(["the container options lack --user 1001", "no database-host: postgres for the setup action"]);
  });

  it("the control: the checker sees a drifted tag, a floating one, a missing digest and `|| null`", () => {
    const ok = `v${locked}-noble@sha256:${"b".repeat(64)}`;
    const wrap = (tag: string, extra = "") => `    container: x ${extra}\n      image: mcr.microsoft.com/playwright:${tag}\n      options: --user 1001\n      database-host: postgres`;
    expect(imageProblems(wrap(ok), locked)).toEqual([]);
    expect(imageProblems(wrap(`v1.0.0-noble@sha256:${"b".repeat(64)}`), locked)).toHaveLength(1);
    expect(imageProblems(wrap("latest"), locked)).toHaveLength(1);
    expect(imageProblems(wrap(`v${locked}-noble`), locked)).toHaveLength(1);
    expect(imageProblems(wrap(ok, "|| null"), locked)).toHaveLength(1);
    expect(imageTags("      # image: mcr.microsoft.com/playwright:v0.0.1-noble")).toEqual([]);
  });

  it("the setup action starts the forwarder, with the host passed through the environment", () => {
    const action = readVerbatim(".github/actions/setup/action.yml");
    expect(action).toMatch(/forward-postgres\.mjs/);
    expect(action).toMatch(/DATABASE_HOST:\s*\$\{\{ inputs\.database-host \}\}/);
    // never spliced into the script text
    expect(action.split(/\r?\n/).filter((l) => /run:|^\s+(nohup|echo|git)/.test(l) && /inputs\.database-host/.test(l))).toEqual([]);
  });

  it("round.yml reads one field, `image`, that layers.mjs sets (not four copies of a list)", () => {
    const part = jobsOf(readVerbatim(".github/workflows/round.yml")).part;
    expect(part).not.toMatch(/contains\(fromJSON/);
    expect((part.match(/matrix\.part\.image/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
});
