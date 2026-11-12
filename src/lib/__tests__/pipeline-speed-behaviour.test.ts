import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * THE TWO NEW GUARANTEES, RUN (2026-11-12), not read as text:
 *
 *  - the round's verdict (scripts/qa/merge.mjs) is only CLEAN when the database suite's own job said
 *    `success`; a missing result is not a pass, a cancelled job is the machine's (INCOMPLETE, re-run) and a
 *    failed or skipped one is NOT CLEAN;
 *  - a CI shard (scripts/ci/check-prebuilt.mjs) refuses a bundle that is missing or of another commit.
 */
const ROOT = resolve(__dirname, "../../..");
const TAGS: string[] = [];

function merge(tagSuffix: string, audit: string | null, extra: string[] = ["--expect-parts"]) {
  const tag = `zz-pipeline-speed-${tagSuffix}`;
  TAGS.push(tag);
  const args = ["scripts/qa/merge.mjs", tag, "--schedule=pr", "--round=1", "--countries=trio", ...extra];
  if (audit !== null) args.push(`--audit=${audit}`);
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8" });
  const file = join(ROOT, ".qa", "rounds", tag, "verdict.json");
  const verdict = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")).verdict as string) : "";
  return { status: r.status, verdict, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

afterAll(() => {
  for (const tag of TAGS) rmSync(join(ROOT, ".qa", "rounds", tag), { recursive: true, force: true });
});

describe("the round's verdict binds to the database suite's result", () => {
  it("a failed or skipped suite is NOT CLEAN", () => {
    for (const result of ["failure", "skipped"]) {
      const r = merge(`audit-${result}`, result);
      expect(r.verdict, `audit ${result}: ${r.out.slice(0, 300)}`).toBe("NOT CLEAN");
      expect(r.status).not.toBe(0);
    }
  });

  it("an absent result is NOT CLEAN in a real round, not a pass", () => {
    const r = merge("audit-absent", null);
    expect(r.verdict).toBe("NOT CLEAN");
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("database suite");
  });

  it("a cancelled suite (a lost runner) is INCOMPLETE, so the waiter re-runs it, and is not NOT CLEAN", () => {
    const r = merge("audit-cancelled", "cancelled");
    expect(r.verdict).toBe("INCOMPLETE — re-run");
  });

  it("control: a round whose suite said success is not marked down for it", () => {
    const r = merge("audit-success", "success");
    expect(r.out).not.toContain("database suite: its job");
    expect(r.out).not.toContain("no result was given");
  });
});

describe("a shard refuses a bundle that is not this run's", () => {
  const dirs: string[] = [];
  afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

  function check(files: Record<string, string>, sha: string | undefined) {
    const dir = mkdtempSync(join(tmpdir(), "zz-prebuilt-"));
    dirs.push(dir);
    mkdirSync(join(dir, "dist"));
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, "dist", name), text);
    const env: NodeJS.ProcessEnv = { ...process.env, NEXT_DIST_DIR: join(dir, "dist") };
    delete env.GITHUB_SHA;
    if (sha) env.GITHUB_SHA = sha;
    const r = spawnSync(process.execPath, [join(ROOT, "scripts/ci/check-prebuilt.mjs")], { cwd: dir, encoding: "utf8", env });
    return { status: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
  }

  it("accepts the bundle of this commit (control)", () => {
    expect(check({ BUILD_ID: "abc", BUILT_FROM: "sha-one\n" }, "sha-one").status).toBe(0);
  });

  it("exits 1 on a bundle of another commit", () => {
    const r = check({ BUILD_ID: "abc", BUILT_FROM: "sha-old\n" }, "sha-new");
    expect(r.status).toBe(1);
    expect(r.out).toContain("sha-old");
  });

  it("exits 1 when BUILD_ID is missing (nothing was downloaded)", () => {
    const r = check({ BUILT_FROM: "sha-one\n" }, "sha-one");
    expect(r.status).toBe(1);
    expect(r.out).toContain("BUILD_ID");
  });

  it("exits 1 when the build carries no stamp, or the run has no commit", () => {
    expect(check({ BUILD_ID: "abc" }, "sha-one").status).toBe(1);
    expect(check({ BUILD_ID: "abc", BUILT_FROM: "sha-one\n" }, undefined).status).toBe(1);
  });
});
