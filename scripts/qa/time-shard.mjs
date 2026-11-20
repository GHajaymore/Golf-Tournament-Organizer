#!/usr/bin/env node
/**
 * CUT A PROJECT'S SPEC FILES INTO SHARDS BY TIME, not by count.
 *
 *     node scripts/qa/time-shard.mjs <project> <shard> <shards>    # prints that shard's spec files, one line
 *     node scripts/qa/time-shard.mjs --plan <project> <shards>     # prints every shard's expected minutes
 *
 * Playwright's own `--shard=i/n` balances the NUMBER of tests, and the suite's tests are anything from
 * two seconds to nine minutes: on 2026-11-11 (CI run 43117624853) the second phone shard took 39.0
 * minutes and the second desktop shard 11.6, and a pull request waits for the slowest. This cuts whole
 * spec files by their MEASURED seconds (`spec-durations.json`; refresh it with
 * `spec-durations-refresh.mjs`) — longest first, each onto the lightest shard (the greedy rule, never
 * worse than 4/3 of the best split) — and the shard is then run as `playwright test --project=<p> <files>`.
 *
 * It removes nothing. The files of a project's shards are exactly the project's files (`shardFiles`
 * for every i is a partition of `specFiles()`; `ci-e2e-matrix.test.ts` holds that), and the run's own
 * proof (`shards-cover.mjs`, which reads what Playwright listed and ran) is unchanged. A spec the
 * durations file has never seen gets the project's median, so it is still in exactly one shard.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

/** Spec files the standing suite runs (playwright.config.ts leaves scenarios and the text-box crawl out), as `e2e/<name>`. */
export function specFiles(root = ROOT) {
  return readdirSync(join(root, "e2e"))
    .filter((f) => f.endsWith(".spec.ts") && f !== "every-text-box.spec.ts")
    .map((f) => `e2e/${f}`)
    .sort();
}

export function loadDurations(root = ROOT) {
  return JSON.parse(readFileSync(join(root, "scripts", "qa", "spec-durations.json"), "utf8")).projects;
}

/** Seconds a file is expected to take in `project`; a file never measured costs the project's median. */
export function weightOf(file, perFile) {
  if (typeof perFile?.[file] === "number") return Math.max(perFile[file], 1);
  const known = Object.values(perFile ?? {}).sort((a, b) => a - b);
  return Math.max(known.length ? known[Math.floor(known.length / 2)] : 1, 1);
}

/** All `shards` buckets, each `{ files, seconds }`, files in name order (the order a run has always had). */
export function cut(files, perFile, shards) {
  const bins = Array.from({ length: shards }, () => ({ files: [], seconds: 0 }));
  const order = [...files].sort((a, b) => weightOf(b, perFile) - weightOf(a, perFile) || a.localeCompare(b));
  for (const f of order) {
    const lightest = bins.reduce((m, b) => (b.seconds < m.seconds ? b : m), bins[0]);
    lightest.files.push(f);
    lightest.seconds += weightOf(f, perFile);
  }
  for (const b of bins) b.files.sort();
  return bins;
}

/** The files of shard `shard` (1-based) of `shards` for `project`. */
export function shardFiles(project, shard, shards, opts = {}) {
  const files = opts.files ?? specFiles();
  const durations = opts.durations ?? loadDurations();
  if (!Number.isInteger(shard) || !Number.isInteger(shards) || shard < 1 || shard > shards) throw new Error(`shard ${shard}/${shards} is not a shard`);
  return cut(files, durations[project] ?? {}, shards)[shard - 1].files;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("\\").join("/").split("/").pop())) {
  const a = process.argv.slice(2);
  if (a[0] === "--plan") {
    const bins = cut(specFiles(), loadDurations()[a[1]] ?? {}, Number(a[2]));
    bins.forEach((b, i) => console.log(`${a[1]} ${i + 1}/${a[2]}: ${b.files.length} files, ${(b.seconds / 60).toFixed(1)} min`));
  } else {
    const files = shardFiles(a[0], Number(a[1]), Number(a[2]));
    if (!files.length) {
      console.error(`${a[0]} shard ${a[1]}/${a[2]} holds no spec file`);
      process.exit(1);
    }
    console.log(files.join(" "));
  }
}
