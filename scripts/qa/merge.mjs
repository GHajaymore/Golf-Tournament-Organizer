#!/usr/bin/env node
/**
 * THE VERDICT OF A ROUND, ADDED UP FROM ITS PARTS.
 *
 *     node scripts/qa/merge.mjs R1 part.json                         # one machine ran it all
 *     node scripts/qa/merge.mjs R1 parts/a.json parts/b.json … --expect-parts --reach=reach.json
 *     node scripts/qa/merge.mjs T1 part.json --part                  # a part on its own: say what it found, claim nothing
 *
 * `round.mjs` writes a `part.json`; this turns one or many of them into
 * `.qa/rounds/<tag>/verdict.json` and `summary.md`, and prints the verdict as
 * its last line. It is one file so that a round run on one machine and a round
 * run as forty parts on forty machines are judged by exactly the same rules.
 *
 * WHAT MAKES A ROUND NOT CLEAN — any one of:
 *   a test that failed, was flaky, or did not run
 *   a run that exited badly, or in which nothing passed (it tested nothing)
 *   a scenario tournament that stopped
 *   a hydration mismatch recorded on any page, whether or not a test was looking
 *   a server action no screen test calls that `reach-baseline.json` does not
 *     already list — something added to the app without a test, or a test lost
 *
 * WHAT MAKES IT "CLEAN, BUT NOT ALL OVER": a layer, or a part of one, that was
 * left out or could not run. That is never rounded up to CLEAN.
 *
 * Exit status: 0 clean, 1 findings, 3 clean but incomplete.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { layersFor, partsFor } from "./layers.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const value = (name) => (flag(name)?.includes("=") ? flag(name).split("=").slice(1).join("=") : "");
const [TAG, ...files] = args.filter((a) => !a.startsWith("--"));
if (!TAG || !files.length) {
  console.error("usage: node scripts/qa/merge.mjs <TAG> <part.json> [more parts] [--expect-parts] [--reach=reach.json] [--part]");
  process.exit(2);
}

const parts = files.map((f) => JSON.parse(readFileSync(f, "utf8")));
const first = parts[0];
const round = first.round;
const apps = [...new Set(parts.map((p) => p.app))];
const builds = [...new Set(parts.map((p) => p.build))];

// One row per layer, whatever number of parts ran it.
const rows = layersFor(round).map((layer) => {
  const mine = parts.flatMap((p) => p.layers.filter((l) => l.key === layer.key));
  const ran = mine.filter((l) => l.ran);
  const base = { key: layer.key, name: layer.name, standsFor: layer.standsFor, reallyIs: (ran[0] ?? mine[0])?.reallyIs ?? layer.reallyIs, cannotSee: layer.cannotSee };
  if (!ran.length) return { ...base, ran: false, why: mine.find((l) => l.why && l.why !== "left out of this run")?.why ?? "left out of this run" };
  const sum = (k) => ran.reduce((n, l) => n + (l[k] ?? 0), 0);
  return {
    ...base,
    ran: true,
    unit: ran[0].unit ?? "tests",
    passed: sum("passed"),
    failed: sum("failed"),
    flaky: sum("flaky"),
    didNotRun: sum("didNotRun"),
    hydration: sum("hydration"),
    minutes: sum("minutes"),
    failures: ran.flatMap((l) => l.failures ?? []),
    said: ran.flatMap((l) => l.said ?? []),
    badExits: ran.filter((l) => l.exit && !l.failed).map((l) => `exited ${l.exit} with nothing reported failed${l.stopped ? " (stopped on time)" : ""}${l.partial ? ` — ${l.partial}` : ""}`),
    empties: ran.filter((l) => l.empty).map((l) => `nothing passed${l.partial ? ` — ${l.partial}` : ""}`),
    pieces: ran.map((l) => l.partial).filter(Boolean),
  };
});

// Was anything left out?
const missing = [];
if (flag("expect-parts")) {
  const have = new Set(parts.map((p) => p.id).filter(Boolean));
  for (const p of partsFor(round)) if (!have.has(p.id)) missing.push(`part ${p.id} never reported`);
} else if (parts.some((p) => p.partial)) {
  missing.push("this was a part of a round, not a round");
}
for (const r of rows) if (!r.ran) missing.push(`${r.key}: ${r.why}`);
if (apps.length > 1) missing.push(`the parts ran on different apps (${apps.join(", ")})`);
if (builds.length > 1) missing.push(`the parts ran on different builds (${builds.join(", ")})`);

// Reach: handed in (many machines, ledgers joined by the caller) or carried by the one part.
const reach = value("reach") && existsSync(value("reach")) ? shape(JSON.parse(readFileSync(value("reach"), "utf8"))) : parts.length === 1 ? first.reach : null;
function shape(report) {
  if (report.neverCalled) return report;
  return { actions: report.actions, screens: report.screens, neverCalled: Object.fromEntries(report.files.filter((f) => f.neverCalled.length).map((f) => [f.file, f.neverCalled])), screensNeverOpened: report.screensNeverOpened };
}
const newlyUnreached = [];
const baselinePath = join("scripts", "qa", "reach-baseline.json");
if (reach && !missing.length && existsSync(baselinePath)) {
  const known = JSON.parse(readFileSync(baselinePath, "utf8")).neverCalled ?? {};
  for (const [file, names] of Object.entries(reach.neverCalled)) {
    for (const name of names) if (!(known[file] ?? []).includes(name)) newlyUnreached.push(`${file}: ${name}`);
  }
}

const findings = [];
for (const r of rows.filter((x) => x.ran)) {
  for (const f of r.failures) findings.push(`${r.key}: ${f}`);
  if (r.failed > r.failures.length) findings.push(`${r.key}: ${r.failed - r.failures.length} more failed`);
  for (const b of r.badExits) findings.push(`${r.key}: ${b}`);
  for (const e of r.empties) findings.push(`${r.key}: ${e} — it tested nothing`);
  if (r.flaky) findings.push(`${r.key}: ${r.flaky} flaky`);
  if (r.didNotRun) findings.push(`${r.key}: ${r.didNotRun} did not run`);
  if (r.hydration) findings.push(`${r.key}: ${r.hydration} hydration mismatch(es) recorded`);
}
for (const n of newlyUnreached) findings.push(`reach: no screen test calls ${n} (not in reach-baseline.json: new, or its test was lost)`);

const onlyAPart = Boolean(flag("part"));
const verdict = findings.length ? "NOT CLEAN" : missing.length ? "CLEAN, BUT NOT ALL OVER" : "CLEAN";
const minutes = Math.max(...parts.map((p) => p.minutes ?? 0));
const OUT = join(".qa", "rounds", TAG);
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "verdict.json"), JSON.stringify({ tag: TAG, round, at: new Date().toISOString(), commit: first.commit, app: apps[0], build: builds[0], verdict, minutes, parts: parts.length, findings, notRun: missing, layers: rows, reach }, null, 1));

const cell = (s) => String(s ?? "").replace(/\|/g, "/").replace(/\n/g, " ");
const result = (r) => (r.ran ? `${r.passed} ${r.unit === "tournaments" ? "played through" : "passed"}, ${r.failed} ${r.unit === "tournaments" ? "stopped" : "failed"}${r.hydration ? `, ${r.hydration} hydration` : ""}` : `NOT RUN — ${cell(r.why)}`);
const summary = [
  `# Round ${TAG} — ${verdict}`,
  "",
  `Commit \`${first.commit}\` · app \`${apps.join(", ")}\` · build \`${builds.join(", ")}\` · ${parts.length} part(s), the longest ${minutes} min · ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
  "",
  "| Layer | Stands for | What was really run | Result |",
  "|---|---|---|---|",
  ...rows.map((r) => `| ${cell(r.name)} | ${cell(r.standsFor)} | ${cell(r.reallyIs)} | ${result(r)} |`),
  "",
  reach ? `**Reach:** ${reach.actions.reached} of ${reach.actions.total} server actions called through a real screen; ${reach.screens.reached} of ${reach.screens.total} screens opened.` : "**Reach:** not measured for this run.",
  "",
  findings.length ? `## Findings\n\n${findings.map((f) => `- ${f}`).join("\n")}` : "No findings.",
  "",
  missing.length ? `## Left out\n\n${missing.map((f) => `- ${f}`).join("\n")}\n` : "",
  "**Not covered by any layer:** a real phone or tablet in a hand, the App Store and Google Play builds, Firefox and Safari on Windows or a Mac. See `docs/testing.md`.",
  "",
].join("\n");
writeFileSync(join(OUT, "summary.md"), summary);

for (const r of rows) console.log(`${r.key.padEnd(22)} ${result(r)}`);
if (reach) console.log(`reach                  ${reach.actions.reached} of ${reach.actions.total} actions through a screen, ${reach.screens.reached} of ${reach.screens.total} screens`);
for (const f of findings.slice(0, 40)) console.log(`  ✗ ${f}`);
if (onlyAPart) {
  console.log(`PART ${TAG}: ${findings.length ? `${findings.length} finding(s)` : "nothing found"} — a part of a round, not a round`);
  process.exit(findings.length ? 1 : 0);
}
console.log(`VERDICT ${TAG}: ${verdict} — ${rows.filter((r) => r.ran).length} of ${rows.length} layers ran, ${findings.length} finding(s)${missing.length ? ` — left out: ${missing.slice(0, 6).join("; ")}` : ""}`);
process.exit(findings.length ? 1 : missing.length ? 3 : 0);
