#!/usr/bin/env node
/**
 * START THE NIGHTLY ROUND WHEN A MERGE IS WAITING FOR IT — run by deploy.yml's hourly run (2026-11-14).
 *
 *     node scripts/qa/nightly-nudge.mjs --needed=true|false
 *
 * `--needed` is the deploy gate's own answer (deploy-gate.mjs output `nightly_needed`: a core or
 * function commit since the last deploy sits in no clean nightly). This counts the Nightly runs and
 * the change rounds that are queued or running, asks `nudgeNightly` (deploy-rules.mjs), and if it says
 * so, `gh workflow run nightly.yml --ref main`. Idempotent: a second hourly run finds the first's
 * nightly and does nothing. It only ever STARTS the nightly the schedule would have started; the
 * nightly deploys what it clears through deploy.yml as before.
 *
 * TOKEN: workflow_dispatch by GITHUB_TOKEN needs `actions: write` on the job (and, unlike other events,
 * a run started that way is allowed to start a run). The job holds that and reads, and nothing else:
 * no Vercel token, no secrets.
 * If GitHub cannot be asked, nothing is dispatched (exit 0, a warning): the gate and the schedule stand.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { nudgeNightly } from "./deploy-rules.mjs";

const REPO = process.env.GITHUB_REPOSITORY || "GHajaymore/Golf-Tournament-Organizer";
const needed = process.argv.slice(2).includes("--needed=true");
const ACTIVE = new Set(["queued", "in_progress", "waiting", "requested", "pending"]);

function gh(...args) {
  const r = spawnSync("gh", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`gh ${args.join(" ")}: ${(r.stderr || r.stdout || "").trim().slice(0, 300)}`);
  return r.stdout.trim() ? JSON.parse(r.stdout) : [];
}
const active = (workflow) => gh("run", "list", "-R", REPO, "--workflow", workflow, "--limit", "30", "--json", "status").filter((r) => ACTIVE.has(r.status)).length;

let verdict;
try {
  verdict = needed ? nudgeNightly({ needed, nightlyActive: active("nightly.yml"), roundsActive: active("round.yml") }) : nudgeNightly({ needed, nightlyActive: 0, roundsActive: 0 });
  if (verdict.dispatch) {
    const r = spawnSync("gh", ["workflow", "run", "nightly.yml", "-R", REPO, "--ref", "main"], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`gh workflow run nightly.yml: ${(r.stderr || r.stdout || "").trim().slice(0, 300)}`);
  }
} catch (e) {
  console.log(`::warning title=Nightly not dispatched::could not ask or start it (${e instanceof Error ? e.message : String(e)}); the schedule and the next hour stand`);
  process.exit(0);
}
const line = `Nightly nudge: ${verdict.dispatch ? "DISPATCHED" : "not dispatched"} — ${verdict.reason}`;
console.log(line);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${line}\n`);
