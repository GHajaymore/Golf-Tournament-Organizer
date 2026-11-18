import { describe, it, expect } from "vitest";
import { readSource, readVerbatim } from "./source";
// Plain JavaScript on purpose: the gate runs on a bare runner.
import {
  NIGHTLY_VERDICT_CHECK,
  verdictCheckPath,
  verdictJobsForRun,
  nightliesWorthAsking,
  cleanNightlyShas,
} from "../../../scripts/qa/deploy-rules.mjs";

/**
 * The deploy gate reads a nightly's Verdict as ONE check run, not as all 57 jobs of the run (17 Nov 2026:
 * GitHub took 9–11 s per run's jobs and answered 502 or dropped the stream twice in four calls; the gate asked
 * for 20 runs every hour and failed four deploys of green rounds in eleven hours). These pin that it asks the
 * small question, reads only its own run's answer, and asks only nightlies that can clear something.
 */
const repo = "acme/app";
const check = (runId: number, conclusion: string | null, name = NIGHTLY_VERDICT_CHECK) => ({
  name,
  conclusion,
  details_url: `https://github.com/${repo}/actions/runs/${runId}/job/9${runId}`,
});

describe("the deploy gate reads a nightly's Verdict as one check run", () => {
  it("asks for the Verdict check run on the nightly's commit, by its exact name", () => {
    const sha = "a".repeat(40);
    expect(verdictCheckPath(repo, sha)).toBe(`repos/${repo}/commits/${sha}/check-runs?check_name=Round%20%2F%20Verdict&per_page=100`);
  });

  it("reads only its OWN run's Verdict: another run's Verdict on the same commit is not this run's", () => {
    const runs = [check(111, "failure"), check(222, "success"), check(2220, "success")];
    expect(verdictJobsForRun(runs, 222)).toEqual([{ name: NIGHTLY_VERDICT_CHECK, conclusion: "success" }]);
    expect(verdictJobsForRun(runs, 111)).toEqual([{ name: NIGHTLY_VERDICT_CHECK, conclusion: "failure" }]);
    // a run id that is a prefix of another (222 vs 2220) never borrows its answer
    expect(verdictJobsForRun([check(2220, "success")], 222)).toEqual([]);
  });

  it("ignores check runs with another name (a round's own Verdict-like jobs, verify)", () => {
    expect(verdictJobsForRun([check(5, "success", "verify"), check(5, "success", "Verdict")], 5)).toEqual([]);
  });

  it("a Verdict not finished yet clears nothing; a run with no Verdict yet clears nothing", () => {
    expect(cleanNightlyShas([{ headSha: "x", jobs: verdictJobsForRun([check(7, null)], 7) }])).toEqual([]);
    expect(cleanNightlyShas([{ headSha: "y", jobs: verdictJobsForRun([], 7) }])).toEqual([]);
    expect(cleanNightlyShas([{ headSha: "z", jobs: verdictJobsForRun([check(7, "success")], 7) }])).toEqual(["z"]);
  });

  it("asks only nightlies whose commit contains the oldest waiting commit", () => {
    const runs = [
      { databaseId: 3, headSha: "new" },
      { databaseId: 2, headSha: "mid" },
      { databaseId: 1, headSha: "old" },
    ];
    const contains = (head: string) => head !== "old";
    expect(nightliesWorthAsking(runs, contains).map((r: { databaseId: number }) => r.databaseId)).toEqual([3, 2]);
  });

  it("when git cannot say whether a nightly contains the commit, the gate stops (fail closed), it does not skip", () => {
    expect(() => nightliesWorthAsking([{ databaseId: 1, headSha: "h" }], () => { throw new Error("git failed"); })).toThrow("git failed");
  });

  it("the name the gate asks for is the name the nightly writes: <nightly's job calling round.yml> / <round.yml's verdict job>", () => {
    // Renaming either job would otherwise make every Verdict invisible and hold every deploy, silently.
    const nightly = readVerbatim(".github", "workflows", "nightly.yml");
    const round = readVerbatim(".github", "workflows", "round.yml");
    const caller = nightly.match(/\n {4}name: ([^\r\n]+)\r?\n {4}uses: \.\/\.github\/workflows\/round\.yml/);
    const verdict = round.match(/\n {2}verdict:\r?\n {4}name: ([^\r\n]+)\r?\n/);
    expect(caller, "nightly.yml: the job that uses round.yml, with its name on the line before").not.toBeNull();
    expect(verdict, "round.yml: the verdict job and its name").not.toBeNull();
    expect(`${caller![1].trim()} / ${verdict![1].trim()}`).toBe(NIGHTLY_VERDICT_CHECK);
  });

  it("the gate itself never fetches a nightly's whole job list again", () => {
    const gate = readSource("scripts", "qa", "deploy-gate.mjs");
    const body = gate.slice(gate.indexOf("function cleanNightlies"), gate.indexOf("async function freeze"));
    expect(body.length).toBeGreaterThan(100); // control: the function was found
    expect(body).not.toMatch(/"run",\s*"view"/);
    expect(body).not.toMatch(/--json",\s*"jobs"/);
    expect(body).toMatch(/verdictCheckPath\(/);
    expect(body).toMatch(/nightliesWorthAsking\(/);
    expect(gate).toMatch(/cleanNightlies\(coreCommits\[0\]\?\.sha \?\? SHA\)/);
  });
});
