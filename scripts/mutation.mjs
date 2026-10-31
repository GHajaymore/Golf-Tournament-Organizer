#!/usr/bin/env node
/**
 * HOW STRONG ARE THE FOUNDATION'S TESTS — measured, per module (2026-10-23).
 *
 *   npm run mutation                       mutate the foundation, print the scores
 *   npm run mutation -- --scope=arithmetic only the arithmetic core (ARITHMETIC_CORE in
 *                                          scripts/qa/mutation-ratchet.mjs) — what the
 *                                          nightly round runs
 *   npm run mutation -- --ratchet          the same, and FAIL if any module in scope
 *                                          is below mutation-baseline.json
 *   npm run mutation -- --report-only      summarise the last run's report, run nothing
 *   npm run mutation -- --write-baseline   RAISE the baseline to this run's scores, for
 *                                          the modules in scope; a floor never falls
 *   npm run mutation -- --quiet            Stryker's own output to reports/mutation/stryker.log,
 *                                          and the score line FIRST (the round reads it)
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
 * The whole set takes hours on one machine, so it is not in `ci.yml`. The
 * NIGHTLY ROUND runs the arithmetic core (`--scope=arithmetic --ratchet
 * --quiet`, the `mutation` layer in scripts/qa/layers.mjs): the score of each
 * module may rise and may never fall. Raising a floor is a commit of
 * `--write-baseline` after the tests that earned it; lowering one is a hand
 * edit of mutation-baseline.json in a commit that says why — this script will
 * not do it for you (`raisedBaseline`).
 *
 * Incremental: Stryker keeps `reports/stryker-incremental.json` and re-tests
 * only the mutants whose code or covering tests changed since the last run.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, openSync, closeSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { MUTATED_MODULES } from "../stryker.config.mjs";
import { headline, modulesOfScope, raisedBaseline, ratchetFalls, scoresOf } from "./qa/mutation-ratchet.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = join(root, "reports", "mutation", "mutation.json");
const LOG = join(root, "reports", "mutation", "stryker.log");
const BASELINE = join(root, "mutation-baseline.json");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const scopeArg = args.find((a) => a.startsWith("--scope="));
const scope = scopeArg ? scopeArg.slice("--scope=".length) : "all";
const ours = ["--ratchet", "--report-only", "--write-baseline", "--quiet"];
const passThrough = args.filter((a) => !ours.includes(a) && !a.startsWith("--scope="));
const quiet = flag("--quiet");

let inScope;
try {
  inScope = modulesOfScope(scope, MUTATED_MODULES);
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exit(1);
}
for (const file of inScope) {
  if (!MUTATED_MODULES.includes(file)) {
    console.error(`✗ ${file} is in the ${scope} scope and not in stryker.config.mjs's MUTATED_MODULES`);
    process.exit(1);
  }
}
// A `--mutate` given by hand wins; otherwise a scope narrower than the config names its files.
const mutateArgs = passThrough.some((a) => a === "--mutate" || a.startsWith("--mutate=")) || scope === "all" ? [] : ["--mutate", inScope.join(",")];

function run() {
  const t0 = Date.now();
  let res;
  if (quiet) {
    mkdirSync(dirname(LOG), { recursive: true });
    const fd = openSync(LOG, "w");
    res = spawnSync("npx", ["stryker", "run", ...mutateArgs, ...passThrough], { cwd: root, stdio: ["ignore", fd, fd], shell: true });
    closeSync(fd);
  } else {
    res = spawnSync("npx", ["stryker", "run", ...mutateArgs, ...passThrough], { cwd: root, stdio: "inherit", shell: true });
  }
  return { status: res.status ?? 1, minutes: Math.round((Date.now() - t0) / 6000) / 10 };
}

let minutes = null;
if (!flag("--report-only")) {
  const r = run();
  minutes = r.minutes;
  if (r.status !== 0) {
    console.error(`✗ Stryker exited ${r.status} after ${minutes} min; no scores to read.${quiet ? ` Its log: ${relative(root, LOG)}` : ""}`);
    if (quiet && existsSync(LOG)) {
      const tail = readFileSync(LOG, "utf8").split(/\r?\n/).filter(Boolean).slice(-25);
      for (const l of tail) console.error(`  ${l}`);
    }
    process.exit(r.status);
  }
}
if (!existsSync(REPORT)) {
  console.error(`✗ no report at ${relative(root, REPORT)} — run without --report-only first.`);
  process.exit(1);
}

const scores = scoresOf(JSON.parse(readFileSync(REPORT, "utf8")), root);
// The first line is the one the round's verdict keeps (round.mjs, a command layer's `said`).
console.log(`${headline(scores, inScope, scope)}${minutes !== null ? ` (${minutes} min)` : ""}`);
const shown = Object.entries(scores).filter(([f]) => inScope.includes(f));
const width = Math.max(...shown.map(([k]) => k.length), 10);
console.log("\nMutation score per module (killed or timed out, of all that could be):\n");
for (const [file, s] of shown.sort((a, b) => a[1].score - b[1].score)) {
  console.log(`  ${file.padEnd(width)}  ${s.score.toFixed(2).padStart(6)}%   ${s.detected} caught, ${s.undetected} not`);
}
console.log("");

let baselineFile = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : null;

if (flag("--write-baseline")) {
  const { modules, kept, missing } = raisedBaseline(baselineFile?.modules ?? {}, scores, inScope);
  if (missing.length) {
    console.error(`✗ not in the report, so no baseline written: ${missing.join(", ")} — run the whole ${scope} scope first.`);
    process.exit(1);
  }
  for (const k of kept) console.log(`  kept ${k.file} at ${k.floor}%: this run scored ${k.score}%, and a floor is never lowered here`);
  mkdirSync(dirname(BASELINE), { recursive: true });
  baselineFile = { measured: new Date().toISOString().slice(0, 10), rule: "a module's score may rise and never fall", modules };
  writeFileSync(BASELINE, `${JSON.stringify(baselineFile, null, 2)}\n`);
  console.log(`[mutation] baseline written: ${relative(root, BASELINE)} (${scope})`);
}

if (flag("--ratchet")) {
  if (!baselineFile) {
    console.error("✗ --ratchet needs mutation-baseline.json; write one with --write-baseline.");
    process.exit(1);
  }
  const falls = ratchetFalls(scores, baselineFile.modules ?? {}, inScope);
  if (falls.length > 0) {
    // One line per module, each starting ✗: the round counts them as findings.
    for (const f of falls) console.error(`✗ ${f.file}: ${f.why}`);
    console.error(`[mutation] RATCHET FAILED — ${falls.length} module(s) of ${inScope.length} in the ${scope} scope.`);
    process.exit(1);
  }
  console.log(`[mutation] ratchet held: every module in the ${scope} scope at or above its baseline (${inScope.length} modules).`);
}
