/**
 * HOW MANY PARTS OF A ROUND MAY RUN AT ONCE — asked by round.yml's plan job, every round.
 *
 *     node scripts/qa/round-cap.mjs            # prints `cap=<n>` and `reason=<words>` (and writes them to $GITHUB_OUTPUT)
 *
 * Ajay approved 2026-10-31 (docs/release-strategy.md, step 9): the account runs about forty jobs at
 * once (GitHub Pro). A fixed `max-parallel` was either too few for a lone round (most runners idle) or
 * too many beside another round, a CI run and the deploy job (the deploy queued). So the cap follows
 * what is already running:
 *
 *     cap = clamp(40 − running − 10 reserved, at least 4, at most 16)
 *
 * The ten reserved are for what must never wait behind a round: a CI run's jobs and the deploy job.
 *
 * WHAT "RUNNING" COUNTS: the jobs whose status is `in_progress` in this repository's runs that are
 * themselves in progress, asked of GitHub's API with the workflow's own token. It does not see other
 * repositories of the account (the token cannot), and it does not count QUEUED jobs (they hold no
 * runner yet). This plan job is one of the jobs it counts. On ANY error — no token, no `gh`, the API
 * refusing or rate-limited — it falls back to 12, the fixed number before this, and says so.
 */
import { appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ACCOUNT_JOBS = 40;
export const RESERVED = 10;
export const CAP_MIN = 4;
export const CAP_MAX = 16;
export const CAP_FALLBACK = 12;

/** The cap for `running` jobs already in progress, or the fallback when that could not be counted. */
export function roundCap(running) {
  if (!Number.isInteger(running) || running < 0) return { cap: CAP_FALLBACK, reason: `the running jobs could not be counted, so the fixed ${CAP_FALLBACK}` };
  const raw = ACCOUNT_JOBS - running - RESERVED;
  const cap = Math.min(CAP_MAX, Math.max(CAP_MIN, raw));
  const bound = raw > CAP_MAX ? ` (held to the most, ${CAP_MAX})` : raw < CAP_MIN ? ` (held to the least, ${CAP_MIN})` : "";
  return { cap, reason: `${ACCOUNT_JOBS} − ${running} job(s) already running in this repository − ${RESERVED} reserved for CI and the deploy = ${raw}${bound}` };
}

/** In-progress jobs across this repository's in-progress runs. Throws on anything GitHub did not answer. */
export function countRunning(repo, gh = (args) => spawnSync("gh", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })) {
  const ask = (path) => {
    const r = gh(["api", path]);
    if (r.status !== 0) throw new Error(`gh api ${path}: ${(r.stderr || r.stdout || "").trim().slice(0, 200)}`);
    return JSON.parse(r.stdout);
  };
  const runs = ask(`repos/${repo}/actions/runs?status=in_progress&per_page=100`).workflow_runs ?? [];
  let running = 0;
  for (const run of runs) {
    const jobs = ask(`repos/${repo}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`).jobs ?? [];
    running += jobs.filter((j) => j.status === "in_progress").length;
  }
  return running;
}

// Run as a script (not imported by a test).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repo = process.env.GITHUB_REPOSITORY || "GHajaymore/Golf-Tournament-Organizer";
  let decided;
  try {
    decided = roundCap(countRunning(repo));
  } catch (e) {
    decided = { cap: CAP_FALLBACK, reason: `GitHub could not be asked what is running (${e instanceof Error ? e.message : String(e)}), so the fixed ${CAP_FALLBACK}` };
  }
  const reason = decided.reason.replace(/\n/g, " ");
  console.log(`cap=${decided.cap}`);
  console.log(`reason=${reason}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `cap=${decided.cap}\ncapreason=${reason}\n`);
}
