#!/usr/bin/env node
/**
 * WHAT THE TESTING COST, AND WHAT IT FOUND — the last N rounds, read back.
 *
 *     node scripts/qa/retro.mjs                  # the last 20 rounds, printed
 *     node scripts/qa/retro.mjs --last=40 --write   # and written to docs/testing-retro.md
 *
 * Ajay's standing order: "keep learning and refining the testing approach and
 * keep making it efficient". A refinement argued from memory is a guess; this
 * is the record it should be argued from. Every round's verdict job writes a
 * `retro.json` beside its verdict (merge.mjs: verdict, parts, minutes, each
 * failure classed app / test / infrastructure, assertion failures per layer),
 * and this reads them back from GitHub with `gh`, together with each run's own
 * clock, and says:
 *
 *   time to merge         per merged pull request, and the median
 *   runner-minutes        per round, by kind (pr, nightly, weekly)
 *   infrastructure share  of all failures in the window — the machine's, not the app's
 *   which layers FOUND    an assertion failure in the window, and which found
 *                         nothing — the candidates to move to the nightly or the
 *                         weekly. A candidate, not a verdict: a layer that never
 *                         fails may be the one keeping a class of fault out, and
 *                         moving one is a decision for the panel, with this as
 *                         its evidence
 *   the mutation score    trend, once `mutation-baseline.json` exists (being built
 *                         on claude/foundation-pass)
 *
 * The rounds' records are cached in `.qa/retro/` so a second run asks GitHub
 * only for what is new. Nothing here is a secret or a name: counts, minutes,
 * layer keys, pull request numbers and titles.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const LAST = Number((args.find((a) => a.startsWith("--last=")) ?? "--last=20").split("=")[1]);
const WRITE = args.includes("--write");
const REPO = process.env.GITHUB_REPOSITORY || "GHajaymore/Golf-Tournament-Organizer";
const CACHE = join(".qa", "retro");
mkdirSync(CACHE, { recursive: true });

function gh(...a) {
  const r = spawnSync("gh", a, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error((r.stderr || r.stdout).trim().slice(0, 300));
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
};
const mins = (a, b) => (Date.parse(b) - Date.parse(a)) / 60000;

// ── The rounds ─────────────────────────────────────────────────────────────
const rounds = [];
for (const [workflow, kind] of [["round.yml", "pr"], ["nightly.yml", "nightly"], ["weekly.yml", "weekly"]]) {
  let runs = [];
  try {
    runs = gh("run", "list", "-R", REPO, "--workflow", workflow, "--limit", String(LAST), "--json", "databaseId,status,conclusion,createdAt,updatedAt,headBranch,headSha") ?? [];
  } catch {
    continue; // not on main yet, or gh cannot be asked
  }
  for (const run of runs.filter((r) => r.status === "completed")) {
    const dir = join(CACHE, String(run.databaseId));
    if (!existsSync(join(dir, "done"))) {
      mkdirSync(dir, { recursive: true });
      spawnSync("gh", ["run", "download", String(run.databaseId), "-R", REPO, "-n", "verdict", "-D", dir], { encoding: "utf8" });
      let runnerMinutes = null;
      try {
        const view = gh("run", "view", String(run.databaseId), "-R", REPO, "--json", "jobs");
        runnerMinutes = Math.round(view.jobs.filter((j) => j.startedAt && j.completedAt && !j.startedAt.startsWith("0001")).reduce((n, j) => n + Math.max(0, mins(j.startedAt, j.completedAt)), 0));
      } catch {
        // the clock is a nicety; the record still counts
      }
      writeFileSync(join(dir, "run.json"), JSON.stringify({ ...run, kind, runnerMinutes }));
      writeFileSync(join(dir, "done"), "");
    }
    const meta = JSON.parse(readFileSync(join(dir, "run.json"), "utf8"));
    const filesUnder = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(join(d, e.name)) : [join(d, e.name)]));
    const files = filesUnder(dir);
    const retroFile = files.find((f) => f.endsWith("retro.json"));
    const verdictFile = files.find((f) => f.endsWith("verdict.json"));
    const retro = retroFile ? JSON.parse(readFileSync(retroFile, "utf8")) : null;
    const verdict = verdictFile ? JSON.parse(readFileSync(verdictFile, "utf8")) : null;
    rounds.push({
      id: meta.databaseId,
      kind: retro?.schedule ?? meta.kind,
      branch: meta.headBranch,
      at: meta.createdAt,
      verdict: retro?.verdict ?? verdict?.verdict ?? `(no verdict: ${meta.conclusion})`,
      wallMinutes: retro?.wallMinutes ?? Math.round(mins(meta.createdAt, meta.updatedAt)),
      runnerMinutes: meta.runnerMinutes ?? retro?.runnerMinutes ?? null,
      parts: retro?.parts ?? verdict?.parts ?? 0,
      // A round from before the retro existed: its findings are all "app", for want of the classes.
      failures: retro?.failures ?? { app: verdict?.findings?.length ?? 0, test: 0, infrastructure: 0 },
      defects: retro?.defects ?? {},
      layersRan: retro?.layersRan ?? (verdict?.layers ?? []).filter((l) => l.ran).map((l) => l.key),
    });
  }
}
rounds.sort((a, b) => b.at.localeCompare(a.at));
const recent = rounds.slice(0, LAST);

// ── Pull requests ──────────────────────────────────────────────────────────
let prs = [];
try {
  prs = (gh("pr", "list", "-R", REPO, "--state", "merged", "--limit", String(LAST), "--json", "number,title,createdAt,mergedAt") ?? []).map((p) => ({ ...p, hours: mins(p.createdAt, p.mergedAt) / 60 }));
} catch {
  // no gh: the section says so
}

// ── The mutation score, when somebody is keeping one ───────────────────────
const mutationFile = ["mutation-baseline.json", join("scripts", "qa", "mutation-baseline.json")].find((f) => existsSync(f));
let mutation = null;
if (mutationFile) {
  const m = JSON.parse(readFileSync(mutationFile, "utf8"));
  const history = Array.isArray(m) ? m : Array.isArray(m.history) ? m.history : [m];
  mutation = history.map((h) => ({ at: h.at ?? h.date ?? h.measuredOn ?? "?", score: h.score ?? h.mutationScore ?? null })).filter((h) => h.score !== null);
}

// ── Add it up ──────────────────────────────────────────────────────────────
const totals = recent.reduce((t, r) => ({ app: t.app + r.failures.app, test: t.test + r.failures.test, infrastructure: t.infrastructure + r.failures.infrastructure }), { app: 0, test: 0, infrastructure: 0 });
const allFailures = totals.app + totals.test + totals.infrastructure;
const layerRuns = new Map();
const layerDefects = new Map();
for (const r of recent) {
  for (const k of r.layersRan) layerRuns.set(k, (layerRuns.get(k) ?? 0) + 1);
  for (const [k, n] of Object.entries(r.defects)) layerDefects.set(k, (layerDefects.get(k) ?? 0) + n);
}
const found = [...layerDefects.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
const silent = [...layerRuns.entries()].filter(([k]) => !layerDefects.get(k)).sort((a, b) => b[1] - a[1]);
const byKind = {};
for (const r of recent.filter((x) => x.runnerMinutes !== null)) (byKind[r.kind] ??= []).push(r.runnerMinutes);

const lines = [
  `# Testing retro — the last ${recent.length} round(s)`,
  "",
  `Written by \`node scripts/qa/retro.mjs --last=${LAST} --write\` on ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC, from each round's own verdict on GitHub. Counts and minutes only. Read with docs/testing.md, "The retro".`,
  "",
  "## Time to merge",
  "",
  prs.length ? `${prs.length} merged pull request(s); median **${median(prs.map((p) => p.hours)).toFixed(1)} hours** from opened to merged.` : "Not measured: `gh` could not list pull requests.",
  "",
  ...(prs.length ? ["| PR | Hours | Title |", "|---|---|---|", ...prs.slice(0, 20).map((p) => `| #${p.number} | ${p.hours.toFixed(1)} | ${p.title.replace(/\|/g, "/").slice(0, 80)} |`)] : []),
  "",
  "## What each round cost",
  "",
  Object.keys(byKind).length ? Object.entries(byKind).map(([k, xs]) => `- **${k}**: ${xs.length} round(s), median ${median(xs)} runner-minutes, ${xs.reduce((a, b) => a + b, 0)} in all`).join("\n") : "No runner-minutes recorded yet.",
  "",
  "| Run | Kind | Branch | Verdict | Wall min | Runner min | Parts | App / test / infra failures |",
  "|---|---|---|---|---|---|---|---|",
  ...recent.map((r) => `| ${r.id} | ${r.kind} | ${r.branch} | ${r.verdict} | ${r.wallMinutes ?? "—"} | ${r.runnerMinutes ?? "—"} | ${r.parts} | ${r.failures.app} / ${r.failures.test} / ${r.failures.infrastructure} |`),
  "",
  "## Whose failures they were",
  "",
  allFailures ? `${allFailures} failure(s) in the window: **${totals.app} the app's** (findings), ${totals.test} a test's own (quarantined or flaky), **${totals.infrastructure} the machine's — ${Math.round((100 * totals.infrastructure) / allFailures)}%**.` : "No failures in the window.",
  "",
  "## Which layers found something",
  "",
  found.length ? found.map(([k, n]) => `- **${k}**: ${n} assertion failure(s) in ${layerRuns.get(k) ?? 0} run(s)`).join("\n") : "No layer recorded an assertion failure in the window.",
  "",
  "**Found nothing in the window** — candidates to move to the nightly or the weekly, for the panel to decide; a layer that never fails may be the one holding a class of fault out:",
  "",
  silent.length ? silent.map(([k, n]) => `- ${k} (${n} run(s))`).join("\n") : "- none",
  "",
  "## Mutation score",
  "",
  mutation?.length ? mutation.map((m) => `- ${m.at}: ${m.score}`).join("\n") : "Not kept yet: there is no `mutation-baseline.json` (the nightly mutation ratchet is being built on claude/foundation-pass).",
  "",
];
const text = lines.join("\n");
console.log(text);
if (WRITE) {
  writeFileSync(join("docs", "testing-retro.md"), text);
  console.log("\nwritten to docs/testing-retro.md");
}
