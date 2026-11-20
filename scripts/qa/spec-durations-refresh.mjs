#!/usr/bin/env node
/**
 * REFRESH `spec-durations.json`, the timings that cut CI's browser shards and a round's size-parts BY TIME.
 *
 *     node scripts/qa/spec-durations-refresh.mjs <log> [<log> ...]
 *
 * Each <log> is the text of a Playwright `list`-reporter run, which prints one line per test:
 *
 *     ✓    12 [phone] › e2e/casual-round.spec.ts:44:5 › a title (12.8s)
 *
 * (a CI shard's "End-to-end" step prints exactly that; a GitHub job log carries a timestamp in front,
 * which is ignored). Seconds are summed per project per spec file. Give it every shard of ONE CI run
 * so each project is whole: a project whose logs miss a file keeps the file's old figure.
 *
 *     gh run view <run-id> --json jobs -q '.jobs[] | select(.name|startswith("End-to-end")) | .databaseId'
 *     gh run view <run-id> --log --job <job-id> > shard-<job-id>.log      # one per shard
 *     node scripts/qa/spec-durations-refresh.mjs shard-*.log
 *
 * Refresh when the suite has grown or a spec has been rewritten (the shard plan prints each shard's
 * expected minutes, `node scripts/qa/time-shard.mjs --plan`). A stale file is never WRONG, only less
 * balanced: a spec the file does not know is given the project's median, and is still in a shard.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DURATIONS_FILE = join(HERE, "spec-durations.json");

/** `{ project: { file: seconds } }` from the text of list-reporter logs. */
export function parseLogs(texts) {
  const out = {};
  const line = /(?:✓|✘|-|×)\s+\d+ \[([\w-]+)\] › (e2e\/[\w.\-/]+\.spec\.ts):\d+:\d+ .*?(?:\((\d+(?:\.\d+)?)(ms|s|m)\))?\s*$/;
  for (const text of texts) {
    for (const l of text.split(/\r?\n/)) {
      const m = l.match(line);
      if (!m) continue;
      const [, project, file, num, unit] = m;
      out[project] ??= {};
      let sec = 0;
      if (num) sec = unit === "ms" ? Number(num) / 1000 : unit === "m" ? Number(num) * 60 : Number(num);
      out[project][file] = (out[project][file] ?? 0) + sec;
    }
  }
  return out;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("\\").join("/").split("/").pop())) {
  const logs = process.argv.slice(2);
  if (!logs.length) {
    console.error("usage: node scripts/qa/spec-durations-refresh.mjs <list-reporter log> ...");
    process.exit(2);
  }
  const fresh = parseLogs(logs.map((f) => readFileSync(f, "utf8")));
  const old = existsSync(DURATIONS_FILE) ? JSON.parse(readFileSync(DURATIONS_FILE, "utf8")) : { projects: {} };
  const projects = { ...old.projects };
  for (const [p, files] of Object.entries(fresh)) {
    projects[p] = { ...(projects[p] ?? {}) };
    for (const [f, s] of Object.entries(files)) projects[p][f] = Math.round(s * 10) / 10;
  }
  for (const p of Object.keys(projects)) projects[p] = Object.fromEntries(Object.entries(projects[p]).sort(([a], [b]) => a.localeCompare(b)));
  const doc = { note: "Seconds per spec file per Playwright project, summed from list-reporter logs. Refresh: scripts/qa/spec-durations-refresh.mjs", projects };
  writeFileSync(DURATIONS_FILE, JSON.stringify(doc, null, 1) + "\n");
  for (const [p, f] of Object.entries(projects)) console.log(p, Object.keys(f).length, "files", Math.round(Object.values(f).reduce((a, b) => a + b, 0) / 60), "min");
}
