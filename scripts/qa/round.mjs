#!/usr/bin/env node
/**
 * ONE ROUND OF TESTING, ALL OVER — or one part of one.
 *
 *     npm run qa:round -- R1 --build              # the database suite, a fresh build, then every layer
 *     npm run qa:round -- R1                      # every layer, on the build that is there
 *     npm run qa:round -- T1 --only=suite,scenarios
 *     npm run qa:round -- T1 --skip=firefox
 *     npm run qa:round -- T1 --only=suite --projects=desktop --shard=1/3
 *     npm run qa:round -- T1 --only=scenarios --scenario=c
 *     npm run qa:round -- --list                  # what a round is, and nothing else
 *     npm run qa:round -- --parts --round=2       # the parts a round is cut into, as JSON
 *     npm run qa:round -- --parts --schedule=pr --countries=all --no-crawl
 *
 * WHICH ROUND (2026-10-23, `docs/testing-panel-2026-10-23.md`):
 *     --schedule=all       every layer — the default, and a round on one machine
 *     --schedule=pr        the round a change asks for before it merges
 *     --schedule=nightly   the full round on main: every pr layer, the tablet, the libraries
 *     --schedule=weekly    Chrome and Edge as installed, the front door's motion
 *     --countries=all      all six countries in this one round (a core change; the nightly)
 *     --no-crawl           leave the console crawl out (a change that touches no input screen)
 * A part is told the same plan as the round it belongs to, and writes it into
 * its `part.json`, so the verdict is judged against the round that was asked for.
 *
 * It runs the layers in `layers.mjs`, in order, against ONE built server on
 * port 3101, and writes what happened to `.qa/rounds/<tag>/`: a log per layer,
 * `verdict.json`, and `summary.md` — the table to put in front of somebody. As
 * one part of a round (`--id`), each of those is named by the part (`partFile`
 * in layers.mjs), and what a layer `keeps` is copied beside its log.
 * The last line it prints is the verdict.
 *
 * ON ONE MACHINE that is about six hours. `.github/workflows/round.yml` runs
 * the same layers as parts, side by side, each calling this file with `--only`
 * for one part, and `merge.mjs` adds the parts up — the efficient way to run a
 * whole round, and the only way to run the layers this machine cannot (Firefox
 * does not start on it). This file is still how one layer is run and debugged.
 *
 * CLEAN means every layer ran and none of them found anything. A layer that
 * was left out, or could not run, makes the round "CLEAN, BUT NOT ALL OVER" at
 * best: it is said, never rounded up.
 *
 * It refuses to start on a tree with uncommitted changes, or on a build that
 * was made from a different app than the commit checked out — a round is
 * evidence about one app, and both of those make it evidence about nothing.
 *
 * Never run two at once on one machine: they share the seeded club and the
 * port. No edits to src, e2e or scripts while one runs, and no other build.
 */
import { spawn, spawnSync } from "node:child_process";
import { cpSync, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findingsSaid, layersFor, partFile, partsFor, SCENARIOS, SCHEDULES } from "./layers.mjs";
import { appId } from "./app-id.mjs";
import { E2E_OWNER_EMAIL } from "../../e2e/owner-email.mjs";
import { demoTestMark, E2E_DEMO_REPLAY_TOKEN } from "../../e2e/demo-fixture.mjs";

const PORT = Number(process.env.E2E_PORT ?? 3101);
const DIST = ".next-e2e";
const SECRET = "local-e2e-secret";
const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const value = (name) => (flag(name)?.includes("=") ? flag(name).split("=").slice(1).join("=") : "");
const TAG = args.find((a) => !a.startsWith("--")) ?? "";
const ROUND = Number(value("round") || (TAG.match(/(\d+)$/) ?? [])[1] || 1);
const ONLY = value("only") ? value("only").split(",") : null;
const SKIP = value("skip") ? value("skip").split(",") : [];
const PROJECTS = value("projects") ? value("projects").split(",") : null;
const SHARD = value("shard");
// One share of the console crawl (`--crawl=2/4`), or none of it (`--crawl=0/4`): see e2e/every-control.spec.ts.
const CRAWL = value("crawl");
const CRAWL_ONLY = Boolean(CRAWL) && !CRAWL.startsWith("0/");
const SCENARIO = value("scenario") ? value("scenario").split(",") : null;
/** Which round this is, or is a part of: see SCHEDULES in layers.mjs. */
const PLAN = { schedule: value("schedule") || "all", countries: value("countries") || "trio", crawl: !flag("no-crawl") };
/** The part of a round this machine is (`--id`, from round.yml), which its own files are named by: see `partFile`. */
const PART = value("id");

const git = (...a) => spawnSync("git", a, { encoding: "utf8" }).stdout.trim();
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

const layers = layersFor(ROUND, PLAN);
if (flag("list")) {
  console.log(`A round under the "${PLAN.schedule}" schedule — ${SCHEDULES[PLAN.schedule]}; countries: ${PLAN.countries}; console crawl: ${PLAN.crawl ? "yes" : "no"}\n`);
  for (const l of layers) console.log(`${l.key.padEnd(22)} ${l.name}   [${l.when.join(", ")}]\n${" ".repeat(23)}stands for: ${l.standsFor}\n${" ".repeat(23)}really is:  ${l.reallyIs}\n${" ".repeat(23)}cannot see: ${l.cannotSee}\n`);
  console.log(`scenarios: ${SCENARIOS.map((s) => `${s.key} ${s.name}`).join(" · ")}`);
  process.exit(0);
}
if (flag("parts")) {
  console.log(JSON.stringify(partsFor(ROUND, PLAN)));
  process.exit(0);
}
if (!TAG) {
  console.error("a round needs a name: npm run qa:round -- R1   (see the top of scripts/qa/round.mjs)");
  process.exit(2);
}

const OUT = join(".qa", "rounds", TAG);
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const say = (line) => {
  console.log(line);
  writeFileSync(join(OUT, "progress.txt"), line + "\n", { flag: "a" });
};
const finish = (verdict, code) => {
  say(`VERDICT ${TAG}: ${verdict}`);
  process.exit(code);
};

/** A command, its output to a file, and its own exit status — never a pipe's. */
function run(command, { env = {}, log, minutes = 60 }) {
  return new Promise((resolve) => {
    const out = createWriteStream(log, { flags: "a" });
    const child = spawn(command, { shell: true, env: { ...process.env, ...env }, windowsHide: true });
    child.stdout.pipe(out, { end: false });
    child.stderr.pipe(out, { end: false });
    const timer = setTimeout(() => {
      out.write(`\n[round] stopped after ${minutes} minutes\n`);
      if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
      else child.kill("SIGKILL");
    }, minutes * 60_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      out.end();
      resolve(code ?? 1);
    });
  });
}

function stopServer() {
  if (process.platform === "win32") {
    spawnSync("powershell", ["-NoProfile", "-Command", `Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`]);
  } else {
    spawnSync("sh", ["-c", `lsof -ti:${PORT} | xargs -r kill -9`]);
  }
}

async function answers() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/`, { redirect: "manual" });
    return res.status === 200;
  } catch {
    return false;
  }
}

let serving = "";
/** The built server, in production's cookie mode or without the Secure flag (for WebKit). */
async function serve(mode) {
  if (serving === mode && (await answers())) return true;
  stopServer();
  await new Promise((r) => setTimeout(r, 2000));
  // The same key as playwright.config.ts gives its server, for the same reason:
  // billing on, so the plan panel's buying controls are drawn, and nothing that
  // could ever charge. Always this one, never the environment's.
  const env = {
    ...process.env,
    NEXT_DIST_DIR: DIST,
    AUTH_SECRET: SECRET,
    STRIPE_SECRET_KEY: "sk_test_e2e_charges_nothing",
    // The test server's owner, as playwright.config.ts gives it — see e2e/owner-email.mjs.
    OWNER_EMAILS: E2E_OWNER_EMAIL,
    // The demo club it builds is the test's own, as playwright.config.ts gives it — see e2e/demo-fixture.mjs.
    DEMO_CLUB_MARK: demoTestMark(),
    DEMO_REPLAY_TOKEN: E2E_DEMO_REPLAY_TOKEN,
    // No mail leaves a test server (the owner-console spec presses Send on the early list).
    RESEND_API_KEY: "",
    ...(mode === "plain" ? { E2E_PLAIN_HTTP: "1" } : {}),
  };
  delete env.E2E_TZ;
  delete env.E2E_LOCALE;
  const log = createWriteStream(join(OUT, "server.log"), { flags: "a" });
  const child = spawn(`npx next start --port ${PORT}`, { shell: true, env, detached: true, windowsHide: true });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  child.unref();
  for (let i = 0; i < 45; i += 1) {
    if (await answers()) {
      serving = mode;
      return true;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  serving = "";
  return false;
}

/** A zone that is on another calendar day from this machine right now. One of these two always is. */
function farZone() {
  const day = (zone) => new Intl.DateTimeFormat("en-CA", zone ? { timeZone: zone } : {}).format(new Date());
  return ["Pacific/Kiritimati", "Pacific/Pago_Pago"].find((z) => day(z) !== day("")) ?? "";
}

/** Whether a browser engine can be started on this machine at all. */
function starts(engine) {
  const probe = `import("@playwright/test").then(async (p) => { const b = await p["${engine}"].launch(); await b.close(); }).catch(() => process.exit(1))`;
  return spawnSync(process.execPath, ["-e", probe], { timeout: 60_000 }).status === 0;
}

/** What one Playwright run said, read out of its own log. */
function read(log) {
  const text = existsSync(log) ? strip(readFileSync(log, "utf8")) : "";
  const count = (word) => Number((text.match(new RegExp(`^\\s+(\\d+) ${word}`, "m")) ?? [])[1] ?? 0);
  return {
    passed: count("passed"),
    failed: count("failed"),
    flaky: count("flaky"),
    skipped: count("skipped"),
    didNotRun: count("did not run"),
    failures: [...text.matchAll(/^\s+\d+\) (\[.*)$/gm)].map((m) => m[1].trim().slice(0, 220)),
    said: text.split("\n").filter((l) => /^\[everything\]|^\[every-control\] [a-z]+: |^\[every-text-box\] (share|control)|^\[every-action\] [a-z ]+: \d|^\[formats-agree\]/.test(l)).map((l) => l.slice(0, 260)),
    // EVERY FINDING, not just the line saying a share failed: the text-box crawl prints each of its
    // findings under its tally, and the verdict is the one place a round's reader is sure to look.
    details: findingsSaid(text),
    hydration: text.split("[hydration #418]").length - 1,
    // How many of the failures are an ASSERTION — an expected and a received value — rather than a
    // timeout or a crash. The retro counts these as defects found (scripts/qa/retro.mjs).
    assertions: (text.match(/^\s+Expected(?: [a-z]+)?:/gm) ?? []).length,
    stopped: text.includes("[round] stopped after"),
  };
}

// ── Before anything runs ─────────────────────────────────────────
const dirty = git("status", "--short").split("\n").filter((l) => l && !l.startsWith("??")).length;
if (dirty) finish(`NOT RUN — ${dirty} tracked files have uncommitted changes; a round is about one commit`, 8);
const commit = git("rev-parse", "--short", "HEAD");
const app = appId();

if (flag("build")) {
  say(`building ${commit} (app ${app}) …`);
  const audit = await run("npx vitest run --config vitest.audit.config.ts", { log: join(OUT, "audit.log"), minutes: 40 });
  const auditSaid = strip(readFileSync(join(OUT, "audit.log"), "utf8")).split("\n").filter((l) => /Test Files|Tests /.test(l)).map((l) => l.trim());
  say(`database suite: exit=${audit} ${auditSaid.join(" · ")}`);
  if (audit !== 0) finish("NOT RUN — the database suite failed", 8);
  stopServer();
  rmSync(DIST, { recursive: true, force: true });
  const built = await run("npm run build", { env: { NEXT_DIST_DIR: DIST, NEXT_NO_STANDALONE: "1", AUTH_SECRET: SECRET }, log: join(OUT, "build.log"), minutes: 30 });
  spawnSync("git", ["checkout", "--", "tsconfig.json"]);
  if (built !== 0 || !existsSync(join(DIST, "BUILD_ID"))) finish("NOT RUN — the build failed (see build.log)", 8);
  writeFileSync(join(DIST, "BUILT_FROM"), `${commit}\n${app}\n`);
  if (flag("build-only")) finish(`BUILT — ${commit}, app ${app}`, 0);
}
if (!existsSync(join(DIST, "BUILD_ID"))) finish(`NOT RUN — there is no build in ${DIST}; add --build`, 8);
const builtFrom = existsSync(join(DIST, "BUILT_FROM")) ? readFileSync(join(DIST, "BUILT_FROM"), "utf8").trim().split("\n") : [];
const builtApp = builtFrom[1] ?? (builtFrom[0] ? appId(builtFrom[0]) : "");
if (builtApp !== app) finish(`NOT RUN — the build in ${DIST} is of app ${builtApp || "unknown"} (commit ${builtFrom[0] ?? "?"}), and the commit checked out is app ${app}; add --build`, 8);

const started = Date.now();
say(`ROUND ${TAG} (round ${ROUND} of a count) — commit ${commit}, app ${app}, build ${readFileSync(join(DIST, "BUILD_ID"), "utf8").trim()}`);
spawnSync(process.execPath, ["scripts/e2e-coverage.mjs", "--reset"]);
rmSync(join(".e2e", "every-action", "ledger.tsv"), { force: true });

const wanted = (key) => (!ONLY || ONLY.includes(key)) && !SKIP.includes(key);
const results = [];
const row = (layer) => ({ key: layer.key, name: layer.name, standsFor: layer.standsFor, reallyIs: layer.reallyIs, cannotSee: layer.cannotSee });

for (const layer of layers) {
  if (!wanted(layer.key)) {
    results.push({ ...row(layer), ran: false, why: "left out of this run" });
    continue;
  }
  if (layer.needs && !starts(layer.needs)) {
    results.push({ ...row(layer), ran: false, why: `${layer.needs} will not start on this machine — run the round on GitHub (round.yml)` });
    say(`${layer.key}: NOT RUN — ${layer.needs} will not start on this machine`);
    continue;
  }
  const t0 = Date.now();
  if (layer.kind === "command") {
    const log = join(OUT, `${partFile(layer.key, PART)}.log`);
    const code = await run(layer.command, { log, minutes: layer.minutes });
    const lines = strip(readFileSync(log, "utf8")).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const failures = lines.filter((l) => l.startsWith("✗")).map((l) => l.slice(1).trim().slice(0, 220));
    // Exit 2 is "could not ask" — it did not run, which is not the same as nothing found.
    // And it is the machine's network, not the app: the verdict says INCOMPLETE, and the round is re-run.
    if (code === 2) {
      results.push({ ...row(layer), ran: false, infra: true, why: lines.slice(-1)[0] ?? "it could not ask" });
      say(`${layer.key}: NOT RUN — ${lines.slice(-1)[0] ?? "it could not ask"}`);
      continue;
    }
    results.push({ ...row(layer), ran: true, exit: code, passed: failures.length ? 0 : 1, failed: failures.length, failures, flaky: 0, didNotRun: 0, hydration: 0, said: lines.slice(0, 1), empty: false, minutes: Math.round((Date.now() - t0) / 60_000), unit: "checks", partial: "" });
    say(`${layer.key}: ${lines.slice(-1)[0] ?? ""} — exit ${code}`);
    continue;
  }
  if (!(await serve(layer.cookies))) {
    results.push({ ...row(layer), ran: false, why: "the test server did not start" });
    say(`${layer.key}: NOT RUN — the test server did not start`);
    continue;
  }

  if (layer.kind === "scenarios") {
    const stopped = [];
    let hydration = 0;
    const chosen = SCENARIOS.filter((s) => !SCENARIO || SCENARIO.includes(s.key));
    for (const s of chosen) {
      const dir = join(OUT, `scenario-${s.key}`);
      mkdirSync(dir, { recursive: true });
      let verdict = "clean";
      for (const phase of s.phases) {
        const log = join(dir, `${phase}.run.log`);
        const code = await run(`npx playwright test ${s.file} --project=desktop --reporter=line --timeout=1400000 --global-timeout=1450000 --output=.qa/tmp/${TAG}-${s.key}`, {
          env: { E2E_SCENARIOS: "1", E2E_REUSE_SERVER: "1", RUN: TAG, PHASE: phase, PROBE_DIR: dir, AUTH_SECRET: SECRET, E2E_PORT: String(PORT) },
          log,
          minutes: 26,
        });
        const notes = existsSync(join(dir, `five-${phase}.txt`)) ? readFileSync(join(dir, `five-${phase}.txt`), "utf8") : "";
        const flags = notes.split("\n").filter((l) => new RegExp(s.flags).test(l)).map((l) => l.trim().slice(0, 200));
        hydration += strip(readFileSync(log, "utf8")).split("[hydration #418]").length - 1;
        if (code !== 0 || flags.length) {
          verdict = `stopped at ${phase}: ${code !== 0 ? `exit ${code}` : ""} ${flags.slice(0, 3).join(" | ")}`.trim();
          break;
        }
      }
      say(`  scenario ${s.key} (${s.name}): ${verdict}`);
      if (verdict !== "clean") stopped.push(`${s.key} ${s.name} — ${verdict}`);
    }
    results.push({ ...row(layer), ran: true, passed: chosen.length - stopped.length, failed: stopped.length, failures: stopped, hydration, said: [], minutes: Math.round((Date.now() - t0) / 60_000), unit: "tournaments", partial: SCENARIO ? `scenario ${SCENARIO.join(",")}` : "" });
    say(`${layer.key}: ${chosen.length - stopped.length} of ${chosen.length} tournaments played through; hydration ${hydration}`);
    continue;
  }

  const env = { AUTH_SECRET: SECRET, E2E_PORT: String(PORT), E2E_REUSE_SERVER: "1", ...layer.env };
  if (CRAWL) env.E2E_CRAWL_PART = CRAWL;
  if (env.E2E_TZ === "@far-zone") env.E2E_TZ = farZone();
  if (layer.env?.E2E_TZ === "@far-zone" && !env.E2E_TZ) {
    results.push({ ...row(layer), ran: false, why: "no zone is on another day right now" });
    continue;
  }
  const projects = PROJECTS ?? layer.projects;
  const log = join(OUT, `${partFile(layer.key, PART)}.log`);
  // A share of the crawl is that one spec; every other part runs the layer's own list.
  const specs = CRAWL_ONLY ? ["e2e/every-control.spec.ts"] : layer.specs;
  const command = ["npx playwright test", ...specs, ...projects.map((p) => `--project=${p}`), SHARD ? `--shard=${SHARD}` : "", "--reporter=line"].filter(Boolean).join(" ");
  // What the layer's spec writes as it goes, emptied first so only this run's is kept.
  if (layer.keeps) rmSync(layer.keeps, { recursive: true, force: true });
  const code = await run(command, { env, log, minutes: layer.minutes });
  if (layer.keeps && existsSync(layer.keeps)) cpSync(layer.keeps, join(OUT, `${partFile(layer.key, PART)}-kept`), { recursive: true });
  const r = read(log);
  const minutes = Math.round((Date.now() - t0) / 60_000);
  // A run that reports nothing passed has not tested anything, whatever its exit code says.
  const empty = r.passed === 0;
  const partial = [PROJECTS ? PROJECTS.join("+") : "", SHARD ? `shard ${SHARD}` : "", CRAWL_ONLY ? `crawl ${CRAWL}` : ""].filter(Boolean).join(", ");
  results.push({ ...row(layer), reallyIs: layer.reallyIs + (layer.key === "elsewhere" ? ` (${env.E2E_TZ})` : ""), ran: true, exit: code, ...r, empty, minutes, unit: "tests", partial });
  say(`${layer.key}${partial ? ` (${partial})` : ""}: ${r.passed} passed, ${r.failed} failed${r.flaky ? `, ${r.flaky} flaky` : ""}${r.didNotRun ? `, ${r.didNotRun} did not run` : ""}, hydration ${r.hydration} — exit ${code}, ${minutes} min${r.stopped ? " — STOPPED ON TIME" : ""}`);
  for (const line of r.said) say(`    ${line}`);
  for (const f of r.failures.slice(0, 12)) say(`    ✗ ${f}`);
}
stopServer();

// ── What was reached ───────────────────────────────────────────────────────────
let reach = null;
const cov = spawnSync(process.execPath, ["scripts/e2e-coverage.mjs", "--json"], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
if (cov.status === 0) {
  const report = JSON.parse(cov.stdout);
  reach = { actions: report.actions, screens: report.screens, neverCalled: Object.fromEntries(report.files.filter((f) => f.neverCalled.length).map((f) => [f.file, f.neverCalled])), screensNeverOpened: report.screensNeverOpened, refusalsOutOfSight: report.refusalsOutOfSight ?? [] };
}

const minutes = Math.round((Date.now() - started) / 60_000);
const partial = Boolean(ONLY || SKIP.length || PROJECTS || SHARD || SCENARIO);
writeFileSync(join(OUT, "part.json"), JSON.stringify({ tag: TAG, id: value("id"), round: ROUND, plan: PLAN, at: new Date().toISOString(), commit, app, build: readFileSync(join(DIST, "BUILD_ID"), "utf8").trim(), minutes, partial, layers: results, reach }, null, 1));

// One machine's worth is a whole verdict when nothing was left out; otherwise it is a part for merge.mjs.
const merge = spawnSync(process.execPath, ["scripts/qa/merge.mjs", TAG, join(OUT, "part.json"), ...(partial ? ["--part"] : [])], { stdio: "inherit" });
process.exit(merge.status ?? 1);
