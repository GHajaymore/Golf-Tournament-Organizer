#!/usr/bin/env node
/**
 * DO NOT RUN A SECOND NIGHTLY ON A COMMIT THAT ALREADY HAS ONE (B75, 17 Nov 2026).
 *
 *     node scripts/qa/nightly-dedupe.mjs     (nightly.yml's first job, on `schedule` only)
 *
 * On 17 Nov the PM dispatched a nightly on main 4a699c78 at 10:40 UTC; the schedule, firing hours late,
 * made another on the SAME sha at 10:41. It queued behind the first (concurrency group `nightly-round`),
 * started at 12:42 and spent about five hours of runner time re-testing a commit already cleared and
 * deployed, and a queued nightly also blocks the push script.
 *
 * `decide` is pure. Dispatch is never skipped (a person asked). A scheduled run is skipped when ANOTHER
 * Nightly run on the same head sha finished successfully or is still queued or running; one whose only
 * same-sha runs failed or were cancelled runs, as does a new sha. Cannot ask GitHub: run (fail open).
 * Outputs `skip=true|false`; nightly.yml's `round` job needs it, so a skipped run starts no round, posts
 * no `Round / Verdict` and calls no deploy.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { cleanNightlyShas, verdictCheckPath, verdictJobsForRun } from "./deploy-rules.mjs";

const ACTIVE = new Set(["queued", "in_progress", "waiting", "requested", "pending"]);

/**
 * runs: [{ databaseId, status, conclusion, headSha, clean }]. `clean` is the DEPLOY GATE's own rule for a finished run
 * (its Round / Verdict check run succeeded: `cleanNightlyShas` over `verdictJobsForRun`), never the run's conclusion:
 * a run this script itself skipped ends "success" with no Verdict and must never count as cover.
 * Returns { skip, reason, coveredBy }.
 */
export function decide(runs, sha, event, selfId) {
  if (event !== "schedule") return { skip: false, reason: `${event || "manual"} run: never skipped`, coveredBy: null };
  const cover = (runs ?? []).find(
    (r) =>
      r.headSha === sha &&
      String(r.databaseId) !== String(selfId ?? "") &&
      (ACTIVE.has(r.status) || (r.status === "completed" && r.clean === true)),
  );
  if (!cover) return { skip: false, reason: `no other nightly covers ${sha}`, coveredBy: null };
  return { skip: true, reason: `Nightly: skipped — ${cover.databaseId} already covers ${sha}`, coveredBy: cover.databaseId };
}

function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const sha = process.env.GITHUB_SHA;
  const event = process.env.GITHUB_EVENT_NAME;
  let verdict;
  try {
    if (event !== "schedule") verdict = decide([], sha, event, process.env.GITHUB_RUN_ID);
    else {
      const r = spawnSync("gh", ["run", "list", "-R", repo, "--workflow", "nightly.yml", "--branch", "main", "--limit", "50", "--json", "databaseId,status,conclusion,headSha"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
      if (r.status !== 0) throw new Error((r.stderr || r.stdout || "").trim().slice(0, 300));
      const runs = JSON.parse(r.stdout || "[]");
      // One small call for the sha: the Verdict check runs on it, tied to each run by its details_url.
      let checks = [];
      if (runs.some((x) => x.headSha === sha && x.status === "completed" && x.conclusion === "success")) {
        const c = spawnSync("gh", ["api", verdictCheckPath(repo, sha)], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
        if (c.status !== 0) throw new Error((c.stderr || c.stdout || "").trim().slice(0, 300));
        checks = JSON.parse(c.stdout || "{}").check_runs ?? [];
      }
      const withClean = runs.map((x) => ({ ...x, clean: cleanNightlyShas([{ headSha: x.headSha, jobs: verdictJobsForRun(checks, x.databaseId) }]).length > 0 }));
      verdict = decide(withClean, sha, event, process.env.GITHUB_RUN_ID);
    }
  } catch (e) {
    console.log(`::warning title=Nightly dedupe::could not ask GitHub (${e instanceof Error ? e.message : String(e)}); running the nightly`);
    verdict = { skip: false, reason: "GitHub could not be asked; running" };
  }
  console.log(verdict.reason);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `skip=${verdict.skip}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${verdict.reason}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
