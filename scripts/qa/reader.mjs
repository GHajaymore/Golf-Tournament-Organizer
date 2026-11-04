#!/usr/bin/env node
/**
 * THE ONE STATUS READER (delivery panel item (g), 2026-11-04).
 *
 *     node scripts/qa/reader.mjs                    # one reading: every run in flight, every head asked about
 *     node scripts/qa/reader.mjs --sha <sha> ...    # …and what verify and the round said about these heads
 *     node scripts/qa/reader.mjs --watch            # a reading every 10 minutes until nothing asked about is in flight
 *
 * Twenty rounds failed in one week for the watching, not the app: watchers polled
 * GitHub every few seconds, hit its burst limit, and then called a round that had
 * run 4 of its 36 parts "finished". So there is ONE reader. It asks GitHub once
 * every ten minutes and writes what it learned to `.qa/reader.json` and
 * `.qa/reader.txt`; the main session and every agent read that file and never ask
 * GitHub themselves (no `gh run watch`, no polling loop — their briefs say so).
 *
 * Three rules, each with a test (`src/lib/__tests__/status-reader.test.ts`):
 *   - FINISHED MEANS THE VERDICT JOB FINISHED, with every planned part done. A run
 *     whose jobs could not be read is "unknown — re-ask", never "finished".
 *   - THE ROUND SAYS IT ON THE COMMIT. The Verdict job posts `round-verdict` as a
 *     commit status on the head it tested (`--post`, below), so one read of a
 *     commit answers "what did the round say". The ruleset does not require it.
 *   - WHEN THE API REFUSES, THE PAGE. The repository is public, so a run's page
 *     says its status without the API. The reader backs off and reads that; it
 *     never retries in a burst.
 *
 *     node scripts/qa/reader.mjs --post <verdict.json> <repo> <sha> <run-url>   # the Verdict job's step
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const STATUS_CONTEXT = "round-verdict";

/** The round workflow's jobs that are not parts; every other job in a round run is one. */
export const NOT_PARTS = ["Plan", "Database suite and the one build", "The packages the browsers need", "Verdict"];

/**
 * The commit status a round's verdict becomes. Only CLEAN is success: a round that
 * left a layer out is not one a merge may count, and one the machine did not finish
 * is evidence about nothing (merge.mjs) — both are `error`, never `failure`, which
 * is kept for what the app did.
 */
export function statusForVerdict(v) {
  if (!v || typeof v.verdict !== "string") return { state: "error", description: "No verdict was written: read the run." };
  const layers = Array.isArray(v.layers) ? v.layers : [];
  const said = `${v.tag}: ${v.verdict} — ${layers.filter((l) => l.ran).length} of ${layers.length} layers, ${(v.findings ?? []).length} finding(s)`;
  const state = v.verdict === "CLEAN" ? "success" : v.verdict === "NOT CLEAN" ? "failure" : "error";
  return { state, description: said.slice(0, 140) };
}

/**
 * Where one run stands, from what GitHub said about it. `jobs` is null when the
 * jobs could not be read; `posted` is the round-verdict status on its head, if any.
 */
export function runState(run, jobs, posted) {
  const base = { id: run.id, workflow: run.name, branch: run.head_branch, sha: run.head_sha, url: run.html_url };
  if (!jobs) return { ...base, state: "unknown — re-ask", parts: null, verdict: null };
  const isRound = run.path?.endsWith("round.yml") ?? run.name === "Round";
  const parts = jobs.filter((j) => !NOT_PARTS.includes(j.name));
  const done = parts.filter((j) => j.status === "completed").length;
  const verdictJob = jobs.find((j) => j.name === "Verdict");
  if (!isRound) {
    const verify = jobs.find((j) => j.name === "verify");
    const state = run.status === "completed" ? `finished: ${run.conclusion}` : "in flight";
    return { ...base, state, parts: { done: jobs.filter((j) => j.status === "completed").length, planned: jobs.length }, verdict: verify ? `verify ${verify.conclusion ?? verify.status}` : null };
  }
  const allDone = parts.length > 0 && done === parts.length;
  let state = "in flight";
  // The Verdict job exits red for NOT CLEAN, so success and failure are both a verdict; cancelled is not.
  if (verdictJob?.status === "completed" && ["success", "failure"].includes(verdictJob.conclusion) && allDone) state = `finished: ${verdictJob.conclusion}`;
  else if (run.status === "completed" && verdictJob?.conclusion === "skipped") state = "finished: no verdict (the build did not finish)";
  else if (run.status === "completed") state = `ended without a verdict (${run.conclusion}) — re-run it`;
  const verdict = posted ? `${posted.state}: ${posted.description}` : state.startsWith("finished: success") || state.startsWith("finished: failure") ? "not posted on the commit — read the run's log" : null;
  return { ...base, state, parts: { done, planned: parts.length }, verdict };
}

/** The status a public run page shows, or null when the page does not say. */
export function pageStatus(html) {
  const m = /<span[^>]*>Status<\/span>\s*<span[^>]*>([^<]+)<\/span>/.exec(html ?? "");
  return m ? m[1].trim() : null;
}

/** One line per run, for the file people read. */
export function line(r) {
  const parts = r.parts ? ` ${r.parts.done}/${r.parts.planned} parts` : "";
  return `${r.workflow} ${r.branch} ${r.sha?.slice(0, 8)} run ${r.id}: ${r.state}${parts}${r.verdict ? ` — ${r.verdict}` : ""}`;
}

const REPO = process.env.GITHUB_REPOSITORY || "GHajaymore/Golf-Tournament-Organizer";
const TEN_MINUTES = 10 * 60_000;

function gh(...a) {
  const r = spawnSync("gh", a, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) return { error: (r.stderr || "gh failed").trim().split("\n")[0] };
  try {
    return { value: JSON.parse(r.stdout) };
  } catch {
    return { error: "gh answered something that is not JSON" };
  }
}

async function fromPage(run) {
  try {
    const res = await fetch(run.html_url ?? `https://github.com/${REPO}/actions/runs/${run.id}`);
    return pageStatus(await res.text());
  } catch {
    return null;
  }
}

async function reading(shas) {
  const at = new Date().toISOString();
  const recent = gh("api", `repos/${REPO}/actions/runs?per_page=40`);
  if (recent.error) return { at, refused: recent.error, runs: [], heads: [] };
  const all = recent.value.workflow_runs ?? [];
  const asked = all.filter((r) => shas.some((s) => r.head_sha.startsWith(s)));
  const wanted = [...new Map([...all.filter((r) => r.status !== "completed"), ...asked].map((r) => [r.id, r])).values()];
  const runs = [];
  for (const run of wanted) {
    const jobs = gh("api", `repos/${REPO}/actions/runs/${run.id}/jobs?per_page=100`);
    let posted = null;
    if (run.path?.endsWith("round.yml") && run.status === "completed") {
      const st = gh("api", `repos/${REPO}/commits/${run.head_sha}/statuses?per_page=50`);
      posted = st.value?.find((s) => s.context === STATUS_CONTEXT) ?? null;
    }
    const r = runState(run, jobs.value?.jobs ?? null, posted);
    if (jobs.error) r.page = (await fromPage(run)) ?? "the page did not say";
    runs.push(r);
  }
  const heads = shas.map((sha) => {
    const checks = gh("api", `repos/${REPO}/commits/${sha}/check-runs?check_name=verify&per_page=20`);
    const verify = checks.value?.check_runs?.[0];
    return { sha, verify: checks.error ? "unknown — re-ask" : verify ? verify.conclusion ?? verify.status : "not started" };
  });
  return { at, runs, heads };
}

function write(r) {
  mkdirSync(".qa", { recursive: true });
  writeFileSync(".qa/reader.json", JSON.stringify(r, null, 1));
  const text = [
    `Read ${r.at}${r.refused ? ` — GitHub refused: ${r.refused}; next reading later, not sooner` : ""}`,
    ...r.runs.map((x) => line(x) + (x.page ? ` (the run's page says: ${x.page})` : "")),
    ...r.heads.map((h) => `head ${h.sha.slice(0, 8)}: verify ${h.verify}`),
  ].join("\n");
  writeFileSync(".qa/reader.txt", text + "\n");
  console.log(text);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args[0] === "--post") {
    const [, file, repo, sha, url] = args;
    const s = statusForVerdict(existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null);
    const r = spawnSync("gh", ["api", "-X", "POST", `repos/${repo}/statuses/${sha}`, "-f", `state=${s.state}`, "-f", `context=${STATUS_CONTEXT}`, "-f", `description=${s.description}`, "-f", `target_url=${url}`], { encoding: "utf8" });
    console.log(`${STATUS_CONTEXT} on ${sha.slice(0, 8)}: ${s.state} — ${s.description}${r.status === 0 ? "" : ` (NOT posted: ${(r.stderr || "").trim()})`}`);
    process.exit(0);
  }
  const shas = args.filter((a) => /^[0-9a-f]{7,40}$/.test(a));
  const watch = args.includes("--watch");
  let wait = TEN_MINUTES;
  for (;;) {
    const r = await reading(shas);
    write(r);
    const inFlight = r.runs.some((x) => !x.state.startsWith("finished")) || r.heads.some((h) => ["not started", "queued", "in_progress", "unknown — re-ask"].includes(h.verify));
    if (!watch || (!r.refused && !inFlight)) break;
    // Refused: wait longer, never shorter (GitHub's burst limit is what this file exists to stay under).
    wait = r.refused ? Math.min(wait * 2, 3 * TEN_MINUTES) : TEN_MINUTES;
    await new Promise((ok) => setTimeout(ok, wait));
  }
}
