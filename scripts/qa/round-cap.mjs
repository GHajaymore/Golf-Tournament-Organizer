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
 *     cap = clamp(40 − running − 6 reserved, at least 6, at most 16)      (was 10 and 4 until 2026-11-12)
 *
 * The six reserved are for what must never wait behind a round: the deploy job (1) and the head of a
 * PR's CI run. Measured 2026-11-12 00:42 UTC: 26 jobs running, two rounds at 4 and 7 parts, ~14 runners
 * idle, because 40 − 26 − 10 = 4 was the floor. The arithmetic of the new numbers (account 40; a PR's
 * CI is ~9 jobs at once; the deploy 1):
 *   - one round alone: running ≈ 1 (this plan job) → 40 − 1 − 6 = 33 → 16 parts.
 *   - two rounds: the second plans beside the first's ≤16 and ~3 others → 40 − 19 − 6 = 15 → 15 parts;
 *     31 runners held, 9 free for CI and the deploy.
 *   - two rounds + two PR CIs + the deploy, worst order (both CIs already running when the second round
 *     plans): 16 + 18 = 34 running → raw 0 → floor 6; 16 + 6 + 18 + 1 = 41, one over the account, so the
 *     deploy (a single job) waits for the first CI job to finish — minutes — not an hour (19 Oct) and
 *     not behind a 16-part round (31 Oct). With the old 4 it was 39, but at the price of the idle
 *     runners measured above; a higher floor than 6 (the 8 considered) would make it 43.
 *
 * WHAT "RUNNING" COUNTS: the jobs whose status is `in_progress` in this repository's runs that are
 * themselves in progress, asked of GitHub's API with the workflow's own token. A job is `queued` while it
 * waits for a runner, and that includes a part another round holds back with its own `max-parallel`: it
 * has no runner, so it takes no share of the account and is NOT counted (counting it would take the same
 * part from this round's cap that the other round has not yet used, and a second round would be sent to
 * the floor). `in_progress` is the one status the API gives that means "holds a runner". It does not see
 * other repositories of the account (the token cannot). This plan job is one of the jobs it counts. On
 * ANY error — no token, no `gh`, the API refusing or rate-limited — it falls back to 12, the fixed
 * number before this, and says so.
 */
import { appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ACCOUNT_JOBS = 40;
export const RESERVED = 6;
export const CAP_MIN = 6;
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
