import { describe, it, expect } from "vitest";
import { shardCoverage, testsIn } from "../../../scripts/qa/shards-cover.mjs";

/**
 * The proof CI's `e2e-cover` job gives that the browser shards, together, ran
 * every test (Security's condition for splitting the legs, 2026-11-04).
 *
 * Built from reports shaped as Playwright's JSON reporter writes them — a file
 * suite, a describe inside it, specs with one test per project — so the proof
 * is checked against the shape it reads, not against its own idea of it. Each
 * way a cut can lose a test has a case that must go RED: a proof that only
 * ever passes cannot tell a complete suite from a short one.
 */

type Spec = { title: string; line: number; projects: Record<string, string | null> };

/** A Playwright JSON report. `status: null` is a test listed but given no result (not run). */
function report(projectNames: string[], files: Record<string, { describe?: string; specs: Spec[] }>, errors: unknown[] = []) {
  const toSpecs = (file: string, specs: Spec[]) =>
    specs.map((s) => ({
      title: s.title,
      file,
      line: s.line,
      tests: Object.entries(s.projects).map(([projectName, status]) => ({ projectName, results: status ? [{ status }] : [] })),
    }));
  return {
    config: { projects: projectNames.map((name) => ({ name })) },
    errors,
    suites: Object.entries(files).map(([file, f]) =>
      f.describe
        ? { title: file, file, specs: [], suites: [{ title: f.describe, file, specs: toSpecs(file, f.specs) }] }
        : { title: file, file, specs: toSpecs(file, f.specs) },
    ),
  };
}

const PROJECTS = ["desktop", "phone"];
/** The whole suite: three files; every test exists in both projects. */
const ALL: Record<string, { describe?: string; specs: Spec[] }> = {
  "a.spec.ts": { specs: [{ title: "a one", line: 3, projects: { desktop: null, phone: null } }] },
  "b.spec.ts": {
    describe: "the b screen",
    specs: [
      { title: "b one", line: 5, projects: { desktop: null, phone: null } },
      { title: "b two", line: 9, projects: { desktop: null, phone: null } },
    ],
  },
  "c.spec.ts": { specs: [{ title: "c one", line: 2, projects: { desktop: null, phone: null } }] },
};

/** What a shard of `project` ran: the named files, every test given `status`. */
function ran(project: string, files: string[], status = "passed") {
  const picked: Record<string, { describe?: string; specs: Spec[] }> = {};
  for (const f of files) picked[f] = { ...ALL[f], specs: ALL[f].specs.map((s) => ({ ...s, projects: { [project]: status } })) };
  return report(PROJECTS, picked);
}

function shard(project: string, i: number, n: number, files: string[], status = "passed") {
  return { name: `e2e-tests-${project}-${i}of${n}`, meta: { project, shard: i, shards: n }, list: report(PROJECTS, ALL), ran: ran(project, files, status) };
}

/** Desktop in two shards, phone in one: the whole suite, each test once. */
const complete = () => [shard("desktop", 1, 2, ["a.spec.ts", "b.spec.ts"]), shard("desktop", 2, 2, ["c.spec.ts"]), shard("phone", 1, 1, ["a.spec.ts", "b.spec.ts", "c.spec.ts"])];

describe("the browser shards cover the suite", () => {
  it("reads a test's file, describe and title, per project", () => {
    const tests = testsIn(report(PROJECTS, ALL), "desktop");
    expect(tests.map((t) => t.key)).toEqual(["a.spec.ts › a one", "b.spec.ts › the b screen › b one", "b.spec.ts › the b screen › b two", "c.spec.ts › c one"]);
    expect(tests.every((t) => !t.ran)).toBe(true);
    expect(testsIn(ran("phone", ["a.spec.ts"]), "phone")[0]).toMatchObject({ ran: true, status: "passed", where: "a.spec.ts:3" });
  });

  it("passes when every listed test ran in exactly one shard — skipped and failed tests count as run", () => {
    const shards = complete();
    shards[1] = shard("desktop", 2, 2, ["c.spec.ts"], "skipped");
    const verdict = shardCoverage(shards);
    expect(verdict.problems).toEqual([]);
    expect(verdict.ok).toBe(true);
    expect(verdict.rows.find((r) => r.project === "desktop" && r.shard === "union")).toMatchObject({ ran: 4, listed: 4, missing: 0 });
  });

  it("fails when a shard handed in nothing", () => {
    const verdict = shardCoverage(complete().filter((s) => !(s.meta.project === "desktop" && s.meta.shard === 2)));
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join("\n")).toContain("shard 2/2 handed in nothing");
    expect(verdict.problems.join("\n")).toContain("1 of 4 tests ran in NO shard");
    expect(verdict.problems.join("\n")).toContain("c.spec.ts:2 › c one");
  });

  it("fails when a shard stopped part-way: a test listed in its report with no result", () => {
    const shards = complete();
    const stopped = ran("desktop", ["a.spec.ts", "b.spec.ts"]);
    stopped.suites[1].suites![0].specs[1].tests[0].results = [];
    shards[0] = { ...shards[0], ran: stopped };
    const verdict = shardCoverage(shards);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join("\n")).toContain("b.spec.ts:9 › the b screen › b two");
  });

  it("fails when a project the config declares has no shard at all", () => {
    const verdict = shardCoverage(complete().filter((s) => s.meta.project !== "phone"));
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join("\n")).toContain("phone: declared by the Playwright config, and NO shard ran it");
  });

  it("fails when a test ran in two shards, or ran without being listed", () => {
    const twice = complete();
    twice[1] = shard("desktop", 2, 2, ["b.spec.ts", "c.spec.ts"]);
    expect(shardCoverage(twice).problems.join("\n")).toContain("ran in more than one shard");

    const extra = complete();
    const more = ran("desktop", ["c.spec.ts"]);
    more.suites.push(report(PROJECTS, { "z.spec.ts": { specs: [{ title: "z", line: 1, projects: { desktop: "passed" } }] } }).suites[0]);
    extra[1] = { ...extra[1], ran: more };
    expect(shardCoverage(extra).problems.join("\n")).toContain("the whole-project list does not have: z.spec.ts:1");
  });

  it("fails when shards disagree about their count, or a list is empty", () => {
    const counts = complete();
    counts[1] = { ...counts[1], meta: { project: "desktop", shard: 2, shards: 3 } };
    expect(shardCoverage(counts).problems.join("\n")).toContain("disagree about how many there are");

    // CONTROL: an empty list makes "the union equals the list" true of nothing.
    const empty = complete().map((s) => ({ ...s, list: report(PROJECTS, {}), ran: report(PROJECTS, {}) }));
    expect(shardCoverage(empty).problems.join("\n")).toContain("the list is EMPTY");
    expect(shardCoverage([]).ok).toBe(false);
  });

  it("fails when a list or a run could not load the specs", () => {
    const shards = complete();
    shards[2] = { ...shards[2], list: report(PROJECTS, ALL, [{ message: "Error: ENOENT .e2e/data.json\n at …" }]) };
    expect(shardCoverage(shards).problems.join("\n")).toContain("list.json reports an error: Error: ENOENT .e2e/data.json");
  });
});
