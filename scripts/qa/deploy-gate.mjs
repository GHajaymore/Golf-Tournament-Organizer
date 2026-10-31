#!/usr/bin/env node
/**
 * MAY THIS COMMIT GO TO PRODUCTION NOW? — asked by every deploy (deploy.yml).
 *
 *     node scripts/qa/deploy-gate.mjs --sha=<full sha> [--override-freeze]
 *
 * Gathers the facts `decideDeploy` (deploy-rules.mjs) needs and prints its
 * decision. On a runner it also writes `decision`, `reason` and `deployed` to
 * $GITHUB_OUTPUT and the reasoning to the job's summary. Exit 0 whatever it
 * decides — holding a deploy is the gate WORKING, and must not read as red —
 * and exit 1 only when it could not ask GitHub at all.
 *
 * THE FACTS, and where each comes from:
 *
 *   verify       GitHub's check runs for the commit, named `verify`
 *   deployed     the newest successful deployment to the `tourneyhq-production`
 *                environment, which deploy.yml records after every deploy. Until
 *                the first one is recorded: the newest run on main whose
 *                "Deploy to production" job got through its `Deploy` step (which
 *                is how every deploy before this gate is found)
 *   core         every commit in deployed..sha whose files include one that
 *                `tierOf` (layers.mjs) calls core — commit by commit, not the
 *                range's net diff, so a change made and undone still counts
 *   nightly      the Nightly round's runs on main whose Verdict job succeeded (finished or
                still running: the round asking is its own deploy's run);
 *                a core commit is covered when it is one of them or an ancestor
 *   the freeze   GET $DEPLOY_WINDOW_URL with $DEPLOY_WINDOW_TOKEN. The app reads
 *                the clubs' zones and today's tournaments from its own database
 *                and answers only {frozen, reason}. THIS RUNNER NEVER HOLDS
 *                PRODUCTION DATABASE CREDENTIALS (CLAUDE.md, "the deploy job does
 *                not build"). No token, no answer, or a refusal: not frozen, and
 *                said so in the summary
 *
 * Needs the whole history checked out (`fetch-depth: 0`) and GH_TOKEN with
 * `actions: read`, `checks: read` and `deployments: read`.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { tierOf } from "./layers.mjs";
import { decideDeploy, cleanNightlyShas } from "./deploy-rules.mjs";

export const PRODUCTION_ENVIRONMENT = "tourneyhq-production";
const args = process.argv.slice(2);
const value = (name) => (args.find((a) => a.startsWith(`--${name}=`)) ?? "").split("=").slice(1).join("=");
const SHA = value("sha") || process.env.GITHUB_SHA || "";
const OVERRIDE = args.includes("--override-freeze");
const REPO = process.env.GITHUB_REPOSITORY || "GHajaymore/Golf-Tournament-Organizer";
const WINDOW_URL = process.env.DEPLOY_WINDOW_URL || "https://tourneyhq.club/api/deploy-window";
const WINDOW_TOKEN = process.env.DEPLOY_WINDOW_TOKEN || "";

const run = (cmd, a) => spawnSync(cmd, a, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const git = (...a) => run("git", a);
function gh(...a) {
  const r = run("gh", a);
  if (r.status !== 0) throw new Error(`gh ${a.join(" ")}: ${(r.stderr || r.stdout).trim().slice(0, 300)}`);
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}
const isAncestor = (a, b) => git("merge-base", "--is-ancestor", a, b).status === 0;

function verifyGreen(sha) {
  const runs = gh("api", `repos/${REPO}/commits/${sha}/check-runs?check_name=verify&per_page=100`);
  return (runs?.check_runs ?? []).some((c) => c.conclusion === "success");
}

/** The commit production holds: the deployment record, then (before the first record) the deploy steps that succeeded. */
function deployedSha() {
  const records = gh("api", `repos/${REPO}/deployments?environment=${PRODUCTION_ENVIRONMENT}&per_page=20`) ?? [];
  for (const d of records) {
    const statuses = gh("api", `repos/${REPO}/deployments/${d.id}/statuses?per_page=5`) ?? [];
    if (statuses[0]?.state === "success") return { sha: d.sha, from: `the deployment record of ${d.created_at}` };
  }
  let best = null;
  for (const workflow of ["ci.yml", "deploy.yml", "nightly.yml"]) {
    let runs = [];
    try {
      runs = gh("run", "list", "-R", REPO, "--workflow", workflow, "--branch", "main", "--limit", "15", "--json", "databaseId,headSha,updatedAt,status") ?? [];
    } catch {
      continue; // a workflow that is not on main yet has no runs
    }
    for (const r of runs.filter((x) => x.status === "completed")) {
      if (best && r.updatedAt <= best.at) continue;
      const view = gh("run", "view", String(r.databaseId), "-R", REPO, "--json", "jobs");
      const shipped = (view?.jobs ?? []).some((j) => j.name.endsWith("Deploy to production") && (j.steps ?? []).some((s) => s.name === "Deploy" && s.conclusion === "success"));
      if (shipped) best = { sha: r.headSha, at: r.updatedAt, from: `${workflow} run ${r.databaseId}, whose Deploy step succeeded` };
    }
  }
  return best;
}

/** Core commits in deployed..sha, oldest first. */
function coreCommitsSince(deployed, sha) {
  const range = deployed ? `${deployed}..${sha}` : sha;
  const list = git("rev-list", "--reverse", ...(deployed ? [range] : ["-1", sha])).stdout.split("\n").filter(Boolean);
  const core = [];
  for (const c of list) {
    const files = git("diff-tree", "--no-commit-id", "--name-only", "-r", "-m", c).stdout.split("\n").filter(Boolean);
    if (files.some((f) => tierOf(f) === "core")) core.push({ sha: c, subject: git("log", "-1", "--format=%s", c).stdout.trim().slice(0, 80) });
  }
  return core;
}

/** The commits a Nightly round was clean on: its Verdict job succeeded. */
function cleanNightlies() {
  let runs = [];
  try {
    runs = gh("run", "list", "-R", REPO, "--workflow", "nightly.yml", "--branch", "main", "--limit", "20", "--json", "databaseId,headSha") ?? [];
  } catch {
    return [];
  }
  const withJobs = [];
  for (const r of runs) {
    // Not filtered to completed runs: the round asking is still running (its deploy job is this very step).
    const view = gh("run", "view", String(r.databaseId), "-R", REPO, "--json", "jobs");
    withJobs.push({ headSha: r.headSha, jobs: view?.jobs ?? [] });
  }
  return cleanNightlyShas(withJobs);
}

async function freeze() {
  if (!WINDOW_TOKEN) return { checked: false, frozen: false, reason: "DEPLOY_WINDOW_TOKEN is not set in this repository's secrets" };
  try {
    const res = await fetch(WINDOW_URL, { headers: { authorization: `Bearer ${WINDOW_TOKEN}`, "user-agent": "tourneyhq-deploy-gate" }, signal: AbortSignal.timeout(15_000), redirect: "manual" });
    if (res.status !== 200) return { checked: false, frozen: false, reason: `${WINDOW_URL} answered ${res.status}${res.status === 401 ? " (the token in GitHub and the one in Vercel differ, or Vercel has none)" : ""}` };
    const body = await res.json();
    if (typeof body?.frozen !== "boolean") return { checked: false, frozen: false, reason: `${WINDOW_URL} answered without a "frozen"` };
    return { checked: true, frozen: body.frozen, reason: String(body.reason ?? "") };
  } catch (e) {
    return { checked: false, frozen: false, reason: `${WINDOW_URL} could not be reached (${e instanceof Error ? e.message : String(e)})` };
  }
}

if (!/^[0-9a-f]{40}$/.test(SHA)) {
  console.error(`deploy-gate needs --sha=<the full 40-character commit>, given "${SHA}"`);
  process.exit(1);
}

let decided;
let deployed = null;
try {
  deployed = deployedSha();
  const alreadyThere = Boolean(deployed) && isAncestor(SHA, deployed.sha);
  const green = verifyGreen(SHA);
  const coreCommits = alreadyThere ? [] : coreCommitsSince(deployed?.sha ?? null, SHA);
  const nightlies = coreCommits.length || !deployed ? cleanNightlies() : [];
  const covered = (c) => nightlies.some((n) => isAncestor(c, n));
  decided = decideDeploy({
    sha: SHA,
    verifyGreen: green,
    deployed: deployed?.sha ?? null,
    alreadyThere,
    coreCommits,
    uncovered: coreCommits.filter((c) => !covered(c.sha)),
    nightlyCoversSha: covered(SHA),
    window: alreadyThere ? { checked: false, frozen: false, reason: "not asked" } : await freeze(),
    overrideFreeze: OVERRIDE,
  });
} catch (e) {
  console.error(`DEPLOY GATE: could not ask GitHub — ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}

const lines = [
  `DEPLOY GATE for ${SHA.slice(0, 8)}: ${decided.decision.toUpperCase()} — ${decided.reason}`,
  `  production holds: ${deployed ? `${deployed.sha.slice(0, 8)} (from ${deployed.from})` : "unknown"}`,
  ...decided.notes.map((n) => `  note: ${n}`),
];
for (const l of lines) console.log(l);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `decision=${decided.decision}\nreason=${decided.reason.replace(/\n/g, " ")}\ndeployed=${deployed?.sha ?? ""}\n`);
}
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Deploy gate: ${decided.decision}\n\n${lines.map((l) => `- ${l.trim()}`).join("\n")}\n`);
}
if (decided.decision === "hold") console.log(`::notice title=Deploy held::${decided.reason}`);
