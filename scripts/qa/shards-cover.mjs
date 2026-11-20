#!/usr/bin/env node
/**
 * DID THE SHARDS RUN THE WHOLE SUITE? — the proof `ci.yml` asks for after its browser shards.
 *
 *     node scripts/qa/shards-cover.mjs <dir>      # <dir>/<one folder per shard>/{shard,list,ran}.json
 *
 * Since 2026-11-04 CI's laptop leg is three machines and its phone leg two (Playwright's
 * `--shard=i/n`), each with its own database and fixture. Security's condition for that split
 * (`Delivery speed - revised panel 4 Nov`, root cause (c)): a pull request into `main` must still run
 * EVERY browser test. A shard that went missing — a matrix line deleted, a count changed in one place
 * and not the other, a shard that stopped half-way — would leave every remaining job green, and a
 * suite that is short looks exactly like a suite that is complete.
 *
 * So each shard job hands in three files:
 *
 *   shard.json  {project, shard, shards}: which cut it was told to run
 *   list.json   `playwright test --list --project=<p> --reporter=json`, WITHOUT `--shard`: the whole
 *               project, as the config and the specs declare it in that job
 *   ran.json    the JSON reporter of the run itself: what that shard actually ran
 *
 * and this holds, for every project the Playwright config declares:
 *
 *   - its shards are 1..n, each exactly once, and agree about n;
 *   - every shard listed the same whole project, and the list is not empty;
 *   - every listed test ran (has a result: passed, failed or skipped at run time) in EXACTLY one shard;
 *   - no shard ran a test the list does not have.
 *
 * Any miss fails, with the tests named. It reads only what Playwright wrote; it runs no browser.
 */
import { existsSync, readdirSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** One test, as `file › describe › … › title`. The project is kept apart, so a key means the same thing in every project. */
function walk(suite, titles, out, project) {
  const here = suite.title && suite.title !== suite.file ? [...titles, suite.title] : titles;
  for (const spec of suite.specs ?? []) {
    const file = String(spec.file ?? suite.file ?? "").split("\\").join("/");
    for (const test of spec.tests ?? []) {
      if (test.projectName !== project) continue;
      const results = test.results ?? [];
      out.push({
        key: [file, ...here, spec.title].join(" › "),
        where: `${file}:${spec.line}`,
        ran: results.length > 0,
        status: results.length ? results[results.length - 1].status : null,
      });
    }
  }
  for (const child of suite.suites ?? []) walk(child, here, out, project);
}

/** Every test of `project` in a Playwright JSON report (a run's or a `--list`'s). */
export function testsIn(report, project) {
  const out = [];
  for (const suite of report?.suites ?? []) walk(suite, [], out, project);
  return out;
}

/** The project names the Playwright config declares, as the report carries them. */
export function projectsIn(report) {
  return (report?.config?.projects ?? []).map((p) => p.name).filter(Boolean);
}

/**
 * The verdict for a set of shards: `{ ok, problems, rows }`. Each shard is
 * `{ name, meta: {project, shard, shards}, list, ran }` with the two reports parsed.
 */
export function shardCoverage(shards) {
  const problems = [];
  const rows = [];
  if (!shards.length) return { ok: false, problems: ["no shard handed in anything: nothing proves the suite ran"], rows };

  const declared = new Set();
  for (const s of shards) for (const p of projectsIn(s.list)) declared.add(p);
  if (!declared.size) problems.push("no shard's list names any project: the config could not be read");
  for (const s of shards) {
    for (const [what, report] of [["list", s.list], ["ran", s.ran]]) {
      for (const e of report?.errors ?? []) problems.push(`${s.name}: ${what}.json reports an error: ${String(e.message ?? e).split("\n")[0].slice(0, 300)}`);
    }
  }

  const byProject = new Map();
  for (const s of shards) {
    const p = s.meta?.project;
    if (!p) {
      problems.push(`${s.name}: shard.json names no project`);
      continue;
    }
    if (!byProject.has(p)) byProject.set(p, []);
    byProject.get(p).push(s);
  }

  for (const project of [...new Set([...declared, ...byProject.keys()])].sort()) {
    const mine = (byProject.get(project) ?? []).sort((a, b) => a.meta.shard - b.meta.shard);
    if (!declared.has(project)) problems.push(`${project}: shards ran a project the Playwright config does not declare`);
    if (!mine.length) {
      problems.push(`${project}: declared by the Playwright config, and NO shard ran it`);
      continue;
    }

    // 1..n, each once, one n.
    const totals = [...new Set(mine.map((s) => s.meta.shards))];
    if (totals.length !== 1) problems.push(`${project}: shards disagree about how many there are (${totals.join(", ")})`);
    const n = Math.max(...totals);
    const seen = mine.map((s) => s.meta.shard);
    for (let i = 1; i <= n; i += 1) {
      const count = seen.filter((x) => x === i).length;
      if (count === 0) problems.push(`${project}: shard ${i}/${n} handed in nothing — it did not run, or did not finish`);
      if (count > 1) problems.push(`${project}: shard ${i}/${n} handed in ${count} times`);
    }

    // The whole project, as each shard listed it; they must agree.
    const listed = new Map();
    const first = testsIn(mine[0].list, project);
    for (const t of first) listed.set(t.key, t.where);
    for (const s of mine.slice(1)) {
      const other = new Set(testsIn(s.list, project).map((t) => t.key));
      const onlyFirst = [...listed.keys()].filter((k) => !other.has(k));
      const onlyOther = [...other].filter((k) => !listed.has(k));
      if (onlyFirst.length || onlyOther.length) {
        problems.push(`${project}: ${s.name} listed a different suite from ${mine[0].name} (${onlyFirst.length} missing, ${onlyOther.length} extra), e.g. ${[...onlyFirst, ...onlyOther].slice(0, 3).join(" | ")}`);
      }
    }
    if (listed.size === 0) problems.push(`${project}: the list is EMPTY — a union of nothing equals nothing, so this proves nothing`);

    // Which shard ran each test.
    const ranIn = new Map();
    const extra = [];
    for (const s of mine) {
      const ran = testsIn(s.ran, project).filter((t) => t.ran);
      const counts = { passed: 0, failed: 0, skipped: 0, other: 0 };
      for (const t of ran) {
        if (!ranIn.has(t.key)) ranIn.set(t.key, []);
        ranIn.get(t.key).push(s.meta.shard);
        if (!listed.has(t.key)) extra.push(`${t.where} (${s.name})`);
        if (t.status === "passed") counts.passed += 1;
        else if (t.status === "skipped") counts.skipped += 1;
        else if (t.status === "failed" || t.status === "timedOut" || t.status === "interrupted") counts.failed += 1;
        else counts.other += 1;
      }
      rows.push({ project, shard: `${s.meta.shard}/${s.meta.shards}`, ran: ran.length, ...counts });
    }
    const missing = [...listed.entries()].filter(([k]) => !ranIn.has(k)).map(([k, where]) => `${where} › ${k.split(" › ").slice(1).join(" › ")}`);
    const twice = [...ranIn.entries()].filter(([, at]) => at.length > 1).map(([k, at]) => `${k} (shards ${at.join(", ")})`);
    const union = [...listed.keys()].filter((k) => ranIn.has(k)).length;
    rows.push({ project, shard: "union", ran: union, listed: listed.size, missing: missing.length, twice: twice.length, extra: extra.length });
    if (missing.length) problems.push(`${project}: ${missing.length} of ${listed.size} tests ran in NO shard:\n    ${missing.slice(0, 40).join("\n    ")}${missing.length > 40 ? `\n    … and ${missing.length - 40} more` : ""}`);
    if (twice.length) problems.push(`${project}: ${twice.length} tests ran in more than one shard: ${twice.slice(0, 10).join("; ")}`);
    if (extra.length) problems.push(`${project}: ${extra.length} tests ran that the whole-project list does not have: ${extra.slice(0, 10).join("; ")}`);
  }

  return { ok: problems.length === 0, problems, rows };
}

/** Every shard folder under `dir`: one per artifact, each with shard.json, list.json and ran.json. */
export function readShards(dir) {
  const shards = [];
  for (const name of existsSync(dir) ? readdirSync(dir).sort() : []) {
    const at = join(dir, name);
    if (!existsSync(join(at, "shard.json"))) continue;
    const read = (file) => (existsSync(join(at, file)) ? JSON.parse(readFileSync(join(at, file), "utf8")) : { errors: [{ message: `${file} is missing` }] });
    shards.push({ name, meta: read("shard.json"), list: read("list.json"), ran: read("ran.json") });
  }
  return shards;
}

function report({ ok, problems, rows }) {
  const lines = [];
  lines.push("| Project | Shard | Ran | Passed | Skipped | Failed | Listed | Missing | In two | Extra |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    lines.push(
      r.shard === "union"
        ? `| **${r.project}** | **union** | **${r.ran}** | | | | **${r.listed}** | **${r.missing}** | **${r.twice}** | **${r.extra}** |`
        : `| ${r.project} | ${r.shard} | ${r.ran} | ${r.passed} | ${r.skipped} | ${r.failed + r.other} | | | | |`,
    );
  }
  const head = ok
    ? "**Every browser test ran:** for every project, the union of its shards is exactly `playwright test --list --project=<p>`, each test in one shard."
    : `**NOT every browser test ran** — ${problems.length} problem(s):`;
  return [head, "", ...lines, "", ...problems.map((p) => `- ${p}`)].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: node scripts/qa/shards-cover.mjs <dir of shard folders>");
    process.exit(2);
  }
  const verdict = shardCoverage(readShards(dir));
  const text = report(verdict);
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Browser shards cover the suite\n\n${text}\n`);
  process.exit(verdict.ok ? 0 : 1);
}
