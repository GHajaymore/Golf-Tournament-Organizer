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
 * WHAT MAKES IT "INCOMPLETE — re-run" (2026-10-23): no finding, but a part that
 * never got as far as testing because of the MACHINE — the runner lost, the
 * browser not installed, the build not downloaded, a registry not reached
 * (`infra.mjs` lists exactly which). That is not evidence about the app either
 * way, so it is neither NOT CLEAN nor CLEAN; the waiter re-runs those parts.
 * `--statuses=<dir>` is where the parts' `job-status.json` files are.
 *
 * A QUARANTINED TEST (`e2e/quarantine.json`, `quarantine.mjs`) still ran and is
 * reported, in a section of its own, but its failure is not a finding — until
 * its entry's date passes, when it counts again.
 *
 * The round is judged against the PLAN it was asked for (`part.json`'s `plan`:
 * schedule, countries, crawl — see `layersFor`), so a change's round is not
 * called incomplete for leaving out what only the nightly runs.
 *
 * Exit status: 0 clean, 1 findings, 3 clean but not all over, 4 incomplete (re-run).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { layersFor, partsFor, SCHEDULES } from "./layers.mjs";
import { activeEntries, quarantinedBy, readQuarantine } from "./quarantine.mjs";
import { infraReason } from "./infra.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const value = (name) => (flag(name)?.includes("=") ? flag(name).split("=").slice(1).join("=") : "");
const [TAG, ...files] = args.filter((a) => !a.startsWith("--"));
/**
 * The round the caller ASKED for (`--round=N --schedule=… --countries=… [--no-crawl]`, the plan job's
 * own arguments). Needed when no part reported at all — every machine lost — which is still a verdict
 * (INCOMPLETE) and not a usage error. When parts did report, theirs is the plan and must agree.
 */
const asked = value("schedule") ? { round: Number(value("round") || 1), plan: { schedule: value("schedule"), countries: value("countries") || "trio", crawl: !flag("no-crawl") } } : null;
if (!TAG || (!files.length && !(flag("expect-parts") && asked))) {
  console.error("usage: node scripts/qa/merge.mjs <TAG> <part.json> [more parts] [--expect-parts] [--reach=reach.json] [--statuses=dir] [--part] [--round=N --schedule=S --countries=C --no-crawl]");
  process.exit(2);
}

const parts = files.map((f) => JSON.parse(readFileSync(f, "utf8")));
const first = parts[0] ?? { round: asked.round, plan: asked.plan, commit: "?", app: "?", build: "?", minutes: 0 };
const round = first.round;
const apps = [...new Set(parts.map((p) => p.app))];
const builds = [...new Set(parts.map((p) => p.build))];
/** A part written before plans existed was a round of every layer. */
const planOf = (p) => ({ schedule: p.plan?.schedule ?? "all", countries: p.plan?.countries ?? "trio", crawl: p.plan?.crawl !== false });
const plan = planOf(first);
const plans = [...new Set([...parts, ...(asked ? [asked] : [])].map((p) => JSON.stringify(planOf(p))))];

const today = new Date().toISOString().slice(0, 10);
const quarantine = activeEntries(readQuarantine(), today);

// One row per layer, whatever number of parts ran it.
const rows = layersFor(round, plan).map((layer) => {
  const mine = parts.flatMap((p) => p.layers.filter((l) => l.key === layer.key));
  const ran = mine.filter((l) => l.ran);
  const base = { key: layer.key, name: layer.name, standsFor: layer.standsFor, reallyIs: (ran[0] ?? mine[0])?.reallyIs ?? layer.reallyIs, cannotSee: layer.cannotSee };
  if (!ran.length) {
    const said = mine.find((l) => l.why && l.why !== "left out of this run");
    return { ...base, ran: false, infra: Boolean(said?.infra), why: said?.why ?? "left out of this run" };
  }
  const sum = (k) => ran.reduce((n, l) => n + (l[k] ?? 0), 0);
  const failures = ran.flatMap((l) => l.failures ?? []);
  const held = failures.filter((f) => quarantinedBy(f, quarantine));
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
    assertions: sum("assertions"),
    // A quarantined test's failure is reported below and is not a finding.
    failures: failures.filter((f) => !held.includes(f)),
    quarantined: held.map((f) => {
      const e = quarantinedBy(f, quarantine);
      return `${f} — quarantined until ${e.expires} (${e.owner}: ${e.reason})`;
    }),
    said: ran.flatMap((l) => l.said ?? []),
    details: ran.flatMap((l) => l.details ?? []),
    // The exit is explained by the failures the run reported, quarantined or not.
    badExits: ran.filter((l) => l.exit && !l.failed).map((l) => `exited ${l.exit} with nothing reported failed${l.stopped ? " (stopped on time)" : ""}${l.partial ? ` — ${l.partial}` : ""}`),
    empties: ran.filter((l) => l.empty).map((l) => `nothing passed${l.partial ? ` — ${l.partial}` : ""}`),
    pieces: ran.map((l) => l.partial).filter(Boolean),
  };
});

/** Every job-status.json under the directory handed in, by part id. */
function statusesIn(dir) {
  const found = new Map();
  if (!dir || !existsSync(dir)) return found;
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name === "job-status.json") {
        try {
          const s = JSON.parse(readFileSync(p, "utf8"));
          if (s.id) found.set(s.id, s);
        } catch {
          // An unreadable status is no status: the part is judged as one that left nothing.
        }
      }
    }
  };
  walk(dir);
  return found;
}

// Was anything left out — and was it the machine?
const missing = [];
const infrastructure = [];
if (plans.length > 1) missing.push(`the parts were told different plans (${plans.join(" / ")})`);
if (flag("expect-parts")) {
  const have = new Set(parts.map((p) => p.id).filter(Boolean));
  const statuses = statusesIn(value("statuses"));
  for (const p of partsFor(round, plan)) {
    if (have.has(p.id)) continue;
    const machine = infraReason(statuses.get(p.id));
    if (machine) infrastructure.push(`part ${p.id}: did not run — ${machine}`);
    else missing.push(`part ${p.id} never reported`);
  }
} else if (parts.some((p) => p.partial)) {
  missing.push("this was a part of a round, not a round");
}
for (const r of rows) {
  if (r.ran) continue;
  // A layer whose every part was the machine's is said once, under infrastructure, not twice.
  const all = flag("expect-parts") ? partsFor(round, plan).filter((p) => p.layer === r.key).map((p) => p.id) : [];
  const allMachine = all.length > 0 && all.every((id) => infrastructure.some((i) => i.startsWith(`part ${id}:`)));
  if (r.infra) infrastructure.push(`${r.key}: did not run — ${r.why}`);
  else if (!allMachine) missing.push(`${r.key}: ${r.why}`);
}
if (apps.length > 1) missing.push(`the parts ran on different apps (${apps.join(", ")})`);
if (builds.length > 1) missing.push(`the parts ran on different builds (${builds.join(", ")})`);

// Reach: handed in (many machines, ledgers joined by the caller) or carried by the one part.
const reach = value("reach") && existsSync(value("reach")) ? shape(JSON.parse(readFileSync(value("reach"), "utf8"))) : parts.length === 1 ? first.reach : null;
function shape(report) {
  if (report.neverCalled) return report;
  return { actions: report.actions, screens: report.screens, neverCalled: Object.fromEntries(report.files.filter((f) => f.neverCalled.length).map((f) => [f.file, f.neverCalled])), screensNeverOpened: report.screensNeverOpened, refusalsOutOfSight: report.refusalsOutOfSight ?? [] };
}
const newlyUnreached = [];
/** Actions the list still calls unreached that this round performed: the list can come down. */
const nowReached = [];
const baselinePath = join("scripts", "qa", "reach-baseline.json");
/**
 * THE LIST THIS IS HELD AGAINST MUST EXIST, OR THE CHECK DID NOT RUN.
 *
 * It read `existsSync(baselinePath)` as one more condition, and the file had
 * never been written — so from the day this was built to 2026-10-13 no round
 * checked for an action nothing performs, while this file's header, `layers.mjs`
 * and `docs/testing.md` all said every round did. Every reach FIGURE in those
 * rounds was measured and true; the guard on it was a check whose failure looked
 * like its success. A missing list is a finding now, said in words.
 */
/**
 * The list was measured on rounds that ran the console crawl, which is what calls most of the
 * console's save actions. A round without it (a change that touches no input screen; the weekly)
 * would report every action only the crawl performs as "lost" — so its reach is printed and not
 * held to the list. The nightly runs the crawl every night, and holds it there.
 */
const reachHeld = plan.crawl && plan.schedule !== "weekly";
const complete = !missing.length && !infrastructure.length && reachHeld;
const baselineMissing = Boolean(reach) && complete && !existsSync(baselinePath);
if (reach && complete && existsSync(baselinePath)) {
  // A build on GitHub names an action's file `app/actions/x.ts`; one made on Windows names it
  // `src/app/actions/x.ts`. One name for both, or a round run here calls every listed action new.
  const plain = (map) => Object.fromEntries(Object.entries(map).map(([file, names]) => [file.replace(/^src\//, ""), names]));
  const known = plain(JSON.parse(readFileSync(baselinePath, "utf8")).neverCalled ?? {});
  const unreached = plain(reach.neverCalled);
  for (const [file, names] of Object.entries(unreached)) {
    for (const name of names) if (!(known[file] ?? []).includes(name)) newlyUnreached.push(`${file}: ${name}`);
  }
  for (const [file, names] of Object.entries(known)) {
    for (const name of names) if (!(unreached[file] ?? []).includes(name)) nowReached.push(`${file}: ${name}`);
  }
}

const findings = [];
for (const r of rows.filter((x) => x.ran)) {
  for (const f of r.failures) findings.push(`${r.key}: ${f}`);
  // …and each thing that failure found, so a share's findings are in the verdict and not only in
  // the log of the machine that ran it (see `partFile` in layers.mjs).
  for (const d of r.details) findings.push(`${r.key}: ${d}`);
  if (r.failed - r.quarantined.length > r.failures.length) findings.push(`${r.key}: ${r.failed - r.quarantined.length - r.failures.length} more failed`);
  for (const b of r.badExits) findings.push(`${r.key}: ${b}`);
  for (const e of r.empties) findings.push(`${r.key}: ${e} — it tested nothing`);
  if (r.flaky) findings.push(`${r.key}: ${r.flaky} flaky`);
  if (r.didNotRun) findings.push(`${r.key}: ${r.didNotRun} did not run`);
  if (r.hydration) findings.push(`${r.key}: ${r.hydration} hydration mismatch(es) recorded`);
}
// The console crawl runs as shares on machines of their own (`E2E_CRAWL_PART`). Each says how many
// controls it operated; a share cannot know the total, so the crawl's own minimum is held to their sum here.
const CRAWL_AT_LEAST = 150;
const shares = (rows.find((r) => r.key === "suite" && r.ran)?.said ?? [])
  .map((line) => /^\[every-control\] secretary: (\d+) controls/.exec(line))
  .filter(Boolean)
  .map((m) => Number(m[1]));
const crawled = shares.reduce((a, b) => a + b, 0);
if (shares.length > 1 && crawled <= CRAWL_AT_LEAST) {
  findings.push(`suite: the console crawl's ${shares.length} shares operated ${crawled} controls between them — the crawl finds more than ${CRAWL_AT_LEAST}`);
}
// The text-box crawl runs as TEXT_PARTS shares, one test each (`e2e/every-text-box.spec.ts`). Each says
// how many boxes it tried; a share cannot know the total, so the crawl's own minimum is held to the sum
// here — once every share has reported, which is the only time the sum means anything.
const TEXT_BOXES_AT_LEAST = 40;
const textShares = (rows.find((r) => r.key === "text-boxes" && r.ran)?.said ?? [])
  .map((line) => /^\[every-text-box\] share (\d+)\/(\d+): \d+ boxes found .*?, (\d+) tried/.exec(line))
  .filter(Boolean);
const textOf = textShares[0] ? Number(textShares[0][2]) : 0;
const textTried = textShares.reduce((n, m) => n + Number(m[3]), 0);
if (textOf > 1 && new Set(textShares.map((m) => m[1])).size === textOf && textTried <= TEXT_BOXES_AT_LEAST) {
  findings.push(`text-boxes: the text-box crawl's ${textOf} shares tried ${textTried} boxes between them — the crawl tries more than ${TEXT_BOXES_AT_LEAST}`);
}
for (const n of newlyUnreached) findings.push(`reach: no screen test calls ${n} (not in reach-baseline.json: new, or its test was lost)`);
if (baselineMissing) findings.push("reach: scripts/qa/reach-baseline.json is missing, so nothing checked for an action no screen test performs");

const onlyAPart = Boolean(flag("part"));
const quarantined = rows.filter((r) => r.ran).flatMap((r) => r.quarantined.map((q) => `${r.key}: ${q}`));
/** The words a round's verdict can be. `status.mjs` and the waiter read them; keep them exact. */
const INCOMPLETE = "INCOMPLETE — re-run";
const verdict = findings.length ? "NOT CLEAN" : infrastructure.length ? INCOMPLETE : missing.length ? "CLEAN, BUT NOT ALL OVER" : "CLEAN";
const minutes = Math.max(0, ...parts.map((p) => p.minutes ?? 0));
const OUT = join(".qa", "rounds", TAG);
mkdirSync(OUT, { recursive: true });
// A part's own verdict and summary are named by the part, like its log: every part writes into a
// folder of the round's name, and fetched together two of them would otherwise be one file.
const own = onlyAPart && first.id ? `-${first.id}` : "";

/**
 * WHAT THE RETRO READS (scripts/qa/retro.mjs): one small record per round, with no secret and no
 * name in it — counts, minutes and layer keys. Every failure is put in one of three classes:
 *
 *   app             a finding: a test failed, a run exited badly, a hydration mismatch, a lost action
 *   test            a quarantined failure, or a flaky one — the test's own fault, by its own list
 *   infrastructure  a part the machine did not run (infra.mjs)
 *
 * and `defects` counts, per layer, the failures that were an ASSERTION (an expected and a received
 * value) rather than a timeout. The verdict job adds the run's own clock (`--run-facts=`, read from
 * GitHub): its wall-clock minutes and the runner-minutes of every job in it.
 */
const facts = value("run-facts") && existsSync(value("run-facts")) ? JSON.parse(readFileSync(value("run-facts"), "utf8")) : {};
const ranRows = rows.filter((r) => r.ran);
const retro = {
  tag: TAG,
  schedule: plan.schedule,
  countries: plan.countries,
  crawl: plan.crawl,
  commit: first.commit,
  at: new Date().toISOString(),
  verdict,
  parts: parts.length,
  longestPartMinutes: minutes,
  partMinutes: parts.reduce((n, p) => n + (p.minutes ?? 0), 0),
  wallMinutes: facts.wallMinutes ?? null,
  runnerMinutes: facts.runnerMinutes ?? null,
  failures: {
    app: findings.length,
    test: quarantined.length + ranRows.reduce((n, r) => n + r.flaky, 0),
    infrastructure: infrastructure.length,
  },
  defects: Object.fromEntries(ranRows.filter((r) => r.failures.length).map((r) => [r.key, Math.min(r.failures.length, r.assertions)])),
  layersRan: ranRows.map((r) => r.key),
};
writeFileSync(join(OUT, `verdict${own}.json`), JSON.stringify({ tag: TAG, round, plan, at: new Date().toISOString(), commit: first.commit, app: apps[0], build: builds[0], verdict, minutes, parts: parts.length, findings, infrastructure, quarantined, notRun: missing, layers: rows, reach, retro }, null, 1));
writeFileSync(join(OUT, `retro${own}.json`), JSON.stringify(retro, null, 1));

const cell = (s) => String(s ?? "").replace(/\|/g, "/").replace(/\n/g, " ");
const result = (r) => (r.ran ? `${r.passed} ${r.unit === "tournaments" ? "played through" : "passed"}, ${r.failed} ${r.unit === "tournaments" ? "stopped" : "failed"}${r.quarantined.length ? ` (${r.quarantined.length} quarantined)` : ""}${r.hydration ? `, ${r.hydration} hydration` : ""}` : `NOT RUN — ${cell(r.why)}`);
/** What this kind of round leaves to another, said so that "not in this round" is never read as "not tested". */
const elsewhere = plan.schedule === "all" ? [] : layersFor(round, { schedule: "all", countries: plan.countries }).filter((l) => !l.when.includes(plan.schedule));
const summary = [
  `# Round ${TAG} — ${verdict}`,
  "",
  `Commit \`${first.commit}\` · app \`${apps.join(", ")}\` · build \`${builds.join(", ")}\` · ${parts.length} part(s), the longest ${minutes} min · ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
  "",
  `**Which round:** ${plan.schedule} — ${SCHEDULES[plan.schedule]}. Countries: ${plan.countries === "all" ? "all six" : "this round's three"}. The console crawl: ${plan.crawl ? "in it" : "left out (the change touches no input screen; the nightly runs it)"}.${elsewhere.length ? ` Not in this kind of round, by the panel's decision of 2026-10-23: ${elsewhere.map((l) => `${l.name} (${l.when.join(", ")})`).join("; ")}.` : ""}`,
  "",
  "| Layer | Stands for | What was really run | Result |",
  "|---|---|---|---|",
  ...rows.map((r) => `| ${cell(r.name)} | ${cell(r.standsFor)} | ${cell(r.reallyIs)} | ${result(r)} |`),
  "",
  reach
    ? `**Reach:** ${reach.actions.reached} of ${reach.actions.total} server actions called through a real screen; ${reach.screens.reached} of ${reach.screens.total} screens opened.${reachHeld ? "" : " Not held to `reach-baseline.json`: the list was measured with the console crawl, and this round did not run it."}`
    : "**Reach:** not measured for this run.",
  "",
  findings.length ? `## Findings\n\n${findings.map((f) => `- ${f}`).join("\n")}` : "No findings.",
  "",
  infrastructure.length ? `## Did not run — the machine, not the app (${infrastructure.length}). Re-run these parts.\n\n${infrastructure.map((f) => `- ${f}`).join("\n")}\n` : "",
  quarantined.length ? `## Quarantined — ran, reported here, not counted (${quarantined.length})\n\n${quarantined.map((f) => `- ${f}`).join("\n")}\n` : "",
  // Good news, and work: these are on the list of actions nothing performs, and this round performed them.
  nowReached.length ? `## Can come off \`reach-baseline.json\` (${nowReached.length})\n\n${nowReached.map((f) => `- ${f}`).join("\n")}\n` : "",
  // To be READ, not counted: see `watchRefusals` in e2e/coverage.ts. "red" is a guess from the colour.
  reach?.refusalsOutOfSight?.length
    ? `## Refusals that appeared with none of them on the screen (${reach.refusalsOutOfSight.length}) — read these\n\n${reach.refusalsOutOfSight.map((r) => `- \`${r.screen}\` after pressing ${r.pressed.map((p) => `"${p}"`).join(" or ")} (${r.kind}, ${r.times}x): ${cell(r.words)}`).join("\n")}\n`
    : "",
  missing.length ? `## Left out\n\n${missing.map((f) => `- ${f}`).join("\n")}\n` : "",
  "**Not covered by any layer:** a real phone or tablet in a hand, the App Store and Google Play builds, Firefox and Safari on Windows or a Mac. See `docs/testing.md`.",
  "",
].join("\n");
writeFileSync(join(OUT, `summary${own}.md`), summary);

for (const r of rows) console.log(`${r.key.padEnd(22)} ${result(r)}`);
if (reach) console.log(`reach                  ${reach.actions.reached} of ${reach.actions.total} actions through a screen, ${reach.screens.reached} of ${reach.screens.total} screens`);
for (const f of findings.slice(0, 40)) console.log(`  ✗ ${f}`);
for (const f of infrastructure.slice(0, 40)) console.log(`  ○ ${f}`);
for (const q of quarantined.slice(0, 20)) console.log(`  ~ ${q}`);
if (onlyAPart) {
  console.log(`PART ${TAG}: ${findings.length ? `${findings.length} finding(s)` : infrastructure.length ? "did not run — the machine, not the app" : "nothing found"} — a part of a round, not a round`);
  // A part the machine stopped is red, so that re-running the round's failed jobs re-runs it.
  process.exit(findings.length ? 1 : infrastructure.length ? 4 : 0);
}
console.log(`VERDICT ${TAG}: ${verdict} — ${rows.filter((r) => r.ran).length} of ${rows.length} layers ran, ${findings.length} finding(s)${infrastructure.length ? `, ${infrastructure.length} part(s) the machine did not run` : ""}${missing.length ? ` — left out: ${missing.slice(0, 6).join("; ")}` : ""}`);
process.exit(findings.length ? 1 : infrastructure.length ? 4 : missing.length ? 3 : 0);
