#!/usr/bin/env node
/**
 * KNOWN HOLES IN THE LIBRARIES THE APP IS BUILT FROM.
 *
 *     node scripts/qa/dependencies.mjs            # the verdict, and the list
 *     node scripts/qa/dependencies.mjs --json     # the same, for a machine
 *
 * `security.spec.ts` asks what somebody can do to OUR code from outside. This
 * asks the other question: is a published vulnerability sitting in something we
 * ship? It reads `npm audit` for the packages a deployment actually installs
 * (`--omit=dev` — a hole in a test tool is not a hole in the app) and fails on
 * any rated HIGH or CRITICAL. The first time it was run, 2026-10-13, there were
 * nine, and nothing had been looking.
 *
 * A finding here is fixed by upgrading — which is a change to `package.json`,
 * so it is CORE (`layers.mjs`) and goes through rounds like any other.
 *
 * WHEN ONE CANNOT BE FIXED YET (no patched release, or the patch breaks
 * something), it goes in `known-vulnerabilities.json` beside this file with the
 * reason and a date to look again. An entry past its date fails, so "accepted
 * for now" cannot quietly become "accepted". An entry for something that is no
 * longer reported fails too: the list may only hold what is true.
 *
 * WHAT THIS CANNOT SEE: a hole nobody has published, and whether a published
 * one is reachable from this app at all — most are not, and that is exactly the
 * judgement an exception has to write down.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const BLOCKING = ["high", "critical"];
const audit = spawnSync("npm audit --omit=dev --json", { shell: true, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
let report;
try {
  report = JSON.parse(audit.stdout);
} catch {
  console.error("npm audit did not answer in a form that can be read:");
  console.error((audit.stdout || audit.stderr || "").slice(0, 400));
  process.exit(2);
}
if (report.error) {
  // No network, or the registry refused: say so. Passing here would be a check that passes by not looking.
  console.error(`npm audit could not ask the registry: ${report.error.summary ?? report.error.code ?? "unknown"}`);
  process.exit(2);
}

const exceptionsPath = join("scripts", "qa", "known-vulnerabilities.json");
const exceptions = existsSync(exceptionsPath) ? JSON.parse(readFileSync(exceptionsPath, "utf8")).accepted ?? [] : [];
const today = new Date().toISOString().slice(0, 10);

const found = Object.entries(report.vulnerabilities ?? {}).map(([name, v]) => ({
  name,
  severity: v.severity,
  direct: Boolean(v.isDirect),
  titles: (v.via ?? []).filter((x) => typeof x === "object").map((x) => x.title).slice(0, 3),
  through: (v.via ?? []).filter((x) => typeof x === "string").slice(0, 3),
  fix: typeof v.fixAvailable === "object" ? `${v.fixAvailable.name}@${v.fixAvailable.version}` : v.fixAvailable ? "an upgrade within the versions already allowed" : "none published",
}));

const findings = [];
const accepted = [];
for (const f of found.filter((x) => BLOCKING.includes(x.severity))) {
  const e = exceptions.find((x) => x.package === f.name);
  if (!e) findings.push(`${f.name}: ${f.severity} — ${f.titles[0] ?? `through ${f.through.join(", ")}`} (fix: ${f.fix})`);
  else if (!e.reason || !e.lookAgain) findings.push(`${f.name}: accepted without a reason and a date to look again`);
  else if (e.lookAgain < today) findings.push(`${f.name}: was accepted until ${e.lookAgain}, which has passed — ${e.reason}`);
  else accepted.push(`${f.name}: ${f.severity}, accepted until ${e.lookAgain} — ${e.reason}`);
}
for (const e of exceptions) {
  if (!found.some((f) => f.name === e.package && BLOCKING.includes(f.severity))) findings.push(`${e.package}: is listed as an accepted vulnerability and is no longer reported — take it off the list`);
}

const counts = report.metadata?.vulnerabilities ?? {};
const summary = `production packages: ${counts.critical ?? 0} critical, ${counts.high ?? 0} high, ${counts.moderate ?? 0} moderate, ${counts.low ?? 0} low`;
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ summary, findings, accepted, lesser: found.filter((x) => !BLOCKING.includes(x.severity)).map((x) => `${x.name}: ${x.severity}`) }, null, 1));
} else {
  console.log(summary);
  for (const a of accepted) console.log(`  accepted  ${a}`);
  for (const f of found.filter((x) => !BLOCKING.includes(x.severity))) console.log(`  noted     ${f.name}: ${f.severity} — ${f.titles[0] ?? ""} (fix: ${f.fix})`);
  for (const f of findings) console.log(`  ✗ ${f}`);
  // Said as it is: an accepted hole is still a hole, so the clean line counts them.
  const clean = accepted.length
    ? `DEPENDENCIES: no new finding — ${accepted.length} high or critical accepted for now, each with a reason and a date above`
    : "DEPENDENCIES: nothing high or critical in what ships";
  console.log(findings.length ? `DEPENDENCIES: ${findings.length} finding(s)` : clean);
}
process.exit(findings.length ? 1 : 0);
