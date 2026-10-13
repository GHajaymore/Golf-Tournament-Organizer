#!/usr/bin/env node
/**
 * RUN THE TESTS THIS CHANGE ADDS OR TOUCHES, SEVERAL TIMES, BEFORE A ROUND IS SPENT ON THEM.
 *
 *     node scripts/qa/burn-in.mjs                   # the specs that differ from main, five times each
 *     node scripts/qa/burn-in.mjs --times=10        # ten
 *     node scripts/qa/burn-in.mjs <commit>          # against a commit instead of main
 *     node scripts/qa/burn-in.mjs e2e/a.spec.ts     # these specs, whatever changed
 *
 * WHY IT EXISTS. A round is about 4,370 browser tests on thirty-odd machines and
 * takes most of an hour. Of the last seven rounds finished on 2026-10-13, two were
 * not clean — and neither had found anything wrong with the app. Each stopped on a
 * test written or changed that day: a locator that matched two headings for an
 * instant, a crawl that lost a tick-box when the sentence under it changed; earlier
 * the same day three more stopped on a press made while the front door was still
 * growing. Every one cost a whole round to find and another to confirm, which is
 * where a day's testing time went. Making a round shorter saves minutes; not spending rounds on a test's own
 * mistakes saves rounds.
 *
 * A test that is wrong about TIMING passes most of the time, which is why one run
 * of it proves little and five in a row prove a good deal. So before a round:
 * every spec the change adds or touches is run several times, at laptop and phone
 * size, and must pass every time.
 *
 * It needs a built server already running, as any local Playwright run here does
 * (`E2E_PORT`, `E2E_REUSE_SERVER=1`, `AUTH_SECRET=local-e2e-secret`), and it uses
 * the one development database: say "fixture turn" to the other session first.
 *
 * WHAT IT CANNOT SEE: Safari's engine and Firefox, where two of the four had
 * failed — add `--engine=webkit` (with the server started for it, see CLAUDE.md)
 * when a new spec scrolls, drags or reads the page in the instant after a press.
 * And a test that is wrong the same way every time: that is what breaking the app
 * on purpose is for.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const args = process.argv.slice(2);
const value = (name) => (args.find((a) => a.startsWith(`--${name}=`)) ?? "").split("=").slice(1).join("=");
const TIMES = Math.max(1, Number(value("times") || 5));
const ENGINE = value("engine");
const named = args.filter((a) => !a.startsWith("--") && a.endsWith(".spec.ts"));
const base = args.find((a) => !a.startsWith("--") && !a.endsWith(".spec.ts")) ?? "origin/main";

const git = (...a) => spawnSync("git", a, { encoding: "utf8" }).stdout;
let specs = named;
if (!specs.length) {
  if (spawnSync("git", ["rev-parse", "--verify", "--quiet", base]).status !== 0) {
    console.error(`there is no commit called ${base}`);
    process.exit(2);
  }
  const from = git("merge-base", base, "HEAD").trim() || base;
  const committed = git("diff", "--name-only", from, "HEAD").split("\n");
  // Not yet committed, and not yet tracked: a spec being written is the one most in need of this.
  const working = git("status", "--short").split("\n").map((l) => l.slice(3).trim().replace(/^"|"$/g, ""));
  specs = [...new Set([...committed, ...working])].filter((f) => f.startsWith("e2e/") && f.endsWith(".spec.ts") && existsSync(f)).sort();
}
if (!specs.length) {
  console.log(`no spec differs from ${base}: nothing to burn in`);
  process.exit(0);
}

console.log(`burning in ${specs.length} spec${specs.length === 1 ? "" : "s"}, ${TIMES} times each, at laptop and phone size${ENGINE ? ` on ${ENGINE}` : ""}:`);
for (const s of specs) console.log(`  ${s}`);

const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
let bad = 0;
const rows = [];
for (const spec of specs) {
  const t0 = Date.now();
  const run = spawnSync(`npx playwright test ${spec} --project=desktop --project=phone --repeat-each=${TIMES} --reporter=line`, {
    shell: true,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...(ENGINE ? { E2E_ENGINE: ENGINE } : {}) },
  });
  const out = strip((run.stdout ?? "") + (run.stderr ?? "")).replace(/\r/g, "\n");
  const count = (word) => Number((new RegExp(`^\\s+(\\d+) ${word}`, "m").exec(out) ?? [])[1] ?? 0);
  const [passed, failed, flaky, skipped] = ["passed", "failed", "flaky", "skipped"].map(count);
  const minutes = ((Date.now() - t0) / 60_000).toFixed(1);
  // A run that reports nothing passed has tested nothing, whatever its exit code says.
  const verdict = run.status === 0 && failed === 0 && flaky === 0 && passed > 0 ? "steady" : passed === 0 && failed === 0 ? "RAN NOTHING" : "NOT STEADY";
  if (verdict !== "steady") bad += 1;
  rows.push(`${verdict.padEnd(11)} ${String(passed).padStart(4)} passed ${String(failed).padStart(3)} failed ${String(skipped).padStart(4)} skipped  ${minutes.padStart(5)} min  ${spec}`);
  console.log(rows[rows.length - 1]);
  if (verdict === "NOT STEADY") {
    for (const line of out.split("\n").filter((l) => /^\s+\d+\) |Error: /.test(l)).slice(0, 8)) console.log(`      ${line.trim().slice(0, 200)}`);
  }
}
console.log(`\n${specs.length - bad} of ${specs.length} steady over ${TIMES} runs each`);
process.exit(bad ? 1 : 0);
