#!/usr/bin/env node
/**
 * HOW STRONG ARE THE FOUNDATION'S TESTS — measured, per module (2026-10-23).
 *
 *   npm run mutation                       mutate the foundation, print the scores
 *   npm run mutation -- --ratchet          the same, and FAIL if any module's score
 *                                          is below mutation-baseline.json
 *   npm run mutation -- --report-only      summarise the last run's report, run nothing
 *   npm run mutation -- --write-baseline   record this run's scores as the baseline
 *   npm run mutation -- --mutate src/lib/domain/money.ts
 *                                          one module (anything after the flags
 *                                          is handed to Stryker as it is)
 *
 * Stryker (`stryker.config.mjs`) changes one thing at a time in the modules
 * that hold a rule — a `<` to a `<=`, a `+ 1` to a `- 1`, a condition to
 * `true` — and runs the unit tests against each change. A change no test
 * notices SURVIVED: that rule could be broken that way and the suite would stay
 * green. The score is the share that were noticed:
 *
 *   (killed + timed out) / (killed + timed out + survived + no coverage)
 *
 * A run takes hours on one machine, so it is not in `ci.yml`. It is a NIGHTLY
 * RATCHET: the score of each module may rise and may never fall. The baseline
 * starts at the first measured score per module; raising it is a commit of
 * `--write-baseline` after the tests that earned it, and lowering it is not a
 * thing this script will do for you.
 *
 * Incremental: Stryker keeps `reports/stryker-incremental.json` and re-tests
 * only the mutants whose code or covering tests changed since the last run.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { MUTATED_MODULES } from "../stryker.config.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = join(root, "reports", "mutation", "mutation.json");
const BASELINE = join(root, "mutation-baseline.json");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const passThrough = args.filter((a) => !["--ratchet", "--report-only", "--write-baseline"].includes(a));

const DETECTED = new Set(["Killed", "Timeout"]);
const UNDETECTED = new Set(["Survived", "NoCoverage"]);

/** Score per module, from a Stryker JSON report (mutation-testing-report-schema). */
export function scoresOf(report) {
  const out = {};
  for (const [file, data] of Object.entries(report.files ?? {})) {
    const rel = (relative(root, join(root, file)) || file).split(sep).join("/");
    let detected = 0;
    let undetected = 0;
    const survivors = [];
    for (const m of data.mutants ?? []) {
      if (DETECTED.has(m.status)) detected += 1;
      else if (UNDETECTED.has(m.status)) {
        undetected += 1;
        survivors.push(m);
      }
    }
    const total = detected + undetected;
    out[rel] = {
      score: total === 0 ? 100 : Math.round((detected / total) * 10000) / 100,
      detected,
      undetected,
      survivors,
    };
  }
  return out;
}

function run() {
  const res = spawnSync("npx", ["stryker", "run", ...passThrough], { cwd: root, stdio: "inherit", shell: true });
  return res.status ?? 1;
}

if (!flag("--report-only")) {
  const status = run();
  if (status !== 0) {
    console.error(`[mutation] Stryker exited ${status}; no scores to read.`);
    process.exit(status);
  }
}
if (!existsSync(REPORT)) {
  console.error(`[mutation] no report at ${relative(root, REPORT)} — run without --report-only first.`);
  process.exit(1);
}

const scores = scoresOf(JSON.parse(readFileSync(REPORT, "utf8")));
const width = Math.max(...Object.keys(scores).map((k) => k.length), 10);
console.log("\nMutation score per module (killed or timed out, of all that could be):\n");
for (const [file, s] of Object.entries(scores).sort((a, b) => a[1].score - b[1].score)) {
  console.log(`  ${file.padEnd(width)}  ${s.score.toFixed(2).padStart(6)}%   ${s.detected} caught, ${s.undetected} not`);
}
const all = Object.values(scores).reduce((a, s) => ({ d: a.d + s.detected, u: a.u + s.undetected }), { d: 0, u: 0 });
console.log(`\n  ${"ALL".padEnd(width)}  ${((all.d / Math.max(1, all.d + all.u)) * 100).toFixed(2).padStart(6)}%   ${all.d} caught, ${all.u} not\n`);

if (flag("--write-baseline")) {
  const modules = {};
  for (const file of MUTATED_MODULES) {
    if (!scores[file]) {
      console.error(`[mutation] ${file} is in stryker.config.mjs and not in the report — run the whole set before writing a baseline.`);
      process.exit(1);
    }
    modules[file] = scores[file].score;
  }
  mkdirSync(dirname(BASELINE), { recursive: true });
  writeFileSync(
    BASELINE,
    `${JSON.stringify({ measured: new Date().toISOString().slice(0, 10), rule: "a module's score may rise and never fall", modules }, null, 2)}\n`,
  );
  console.log(`[mutation] baseline written: ${relative(root, BASELINE)}`);
}

if (flag("--ratchet")) {
  if (!existsSync(BASELINE)) {
    console.error("[mutation] --ratchet needs mutation-baseline.json; write one with --write-baseline.");
    process.exit(1);
  }
  const baseline = JSON.parse(readFileSync(BASELINE, "utf8")).modules ?? {};
  const fell = [];
  for (const [file, floor] of Object.entries(baseline)) {
    const now = scores[file];
    if (!now) fell.push(`${file}: in the baseline at ${floor}% and not measured in this run`);
    else if (now.score < floor) fell.push(`${file}: ${now.score}% is below its baseline of ${floor}%`);
  }
  for (const file of MUTATED_MODULES) {
    if (!(file in baseline)) fell.push(`${file}: mutated and has no baseline — add it with --write-baseline`);
  }
  if (fell.length > 0) {
    console.error(`[mutation] RATCHET FAILED — ${fell.length} module(s):\n  ${fell.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`[mutation] ratchet held: every module at or above its baseline (${Object.keys(baseline).length} modules).`);
}
