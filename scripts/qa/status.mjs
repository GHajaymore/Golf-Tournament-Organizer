#!/usr/bin/env node
/**
 * WHERE THE TESTING STANDS — the answer to "how many clean rounds do we have?"
 *
 *     npm run qa:status                       # the count for the commit checked out
 *     npm run qa:status -- --record R1        # write round R1's verdict into the ledger
 *
 * `docs/qa-ledger.json` is the record: one entry per counted round, with the
 * app it ran on (`app-id.mjs`), what it covered and what it found. It is
 * committed, so the count is something anybody can read rather than something
 * one session remembers.
 *
 * The count for an app is the number of CONSECUTIVE clean, all-over rounds on
 * that exact app, ending with the latest. A round that was not clean ends a
 * run; so does any change to a function or core file, because that is a
 * different app. A round that was clean but left a layer out is shown and
 * does not count towards three.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { appId, changedBetween } from "./app-id.mjs";
import { TIERS } from "./layers.mjs";

const LEDGER = join("docs", "qa-ledger.json");
const ledger = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, "utf8")) : { rounds: [] };
const args = process.argv.slice(2);

if (args[0] === "--record") {
  const tag = args[1];
  const path = join(".qa", "rounds", tag ?? "", "verdict.json");
  if (!tag || !existsSync(path)) {
    console.error(`there is no verdict for a round called ${tag ?? "(none)"} in .qa/rounds/`);
    process.exit(2);
  }
  const v = JSON.parse(readFileSync(path, "utf8"));
  const entry = {
    tag: v.tag,
    at: v.at,
    commit: v.commit,
    app: v.app,
    verdict: v.verdict,
    minutes: v.minutes,
    layers: v.layers.map((l) => (l.ran ? `${l.key}: ${l.passed} passed, ${l.failed} failed` : `${l.key}: NOT RUN — ${l.why}`)),
    reach: v.reach ? `${v.reach.actions.reached} of ${v.reach.actions.total} actions through a screen; ${v.reach.screens.reached} of ${v.reach.screens.total} screens` : "not measured",
    findings: v.findings,
  };
  ledger.rounds = ledger.rounds.filter((r) => r.tag !== entry.tag).concat(entry);
  writeFileSync(LEDGER, JSON.stringify(ledger, null, 1) + "\n");
  console.log(`recorded ${entry.tag}: ${entry.verdict} on app ${entry.app}`);
}

const app = appId();
const commit = spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).stdout.trim();
const onThisApp = ledger.rounds.filter((r) => r.app === app);
let run = 0;
for (const r of [...onThisApp].reverse()) {
  if (r.verdict !== "CLEAN") break;
  run += 1;
}

console.log(`Commit ${commit} is app ${app}.`);
if (!onThisApp.length) console.log("No round has been run on this app.");
else {
  console.log(`Rounds on this app: ${onThisApp.map((r) => `${r.tag} ${r.verdict}`).join(" · ")}`);
  console.log(`CONSECUTIVE CLEAN, ALL-OVER ROUNDS ON THIS APP: ${run}${run >= 3 ? " — three in a row" : ""}`);
}

// The last app that did reach three, and what has changed since.
const certified = [...ledger.rounds].reverse().find((r, i, all) => r.verdict === "CLEAN" && all.slice(i, i + 3).filter((x) => x.app === r.app && x.verdict === "CLEAN").length === 3);
if (certified && certified.app !== app) {
  const changed = changedBetween(certified.commit).filter((c) => c.tier === "function" || c.tier === "core");
  console.log(`\nThe last app with three in a row was ${certified.app} (commit ${certified.commit}, round ${certified.tag}).`);
  console.log(`Since then ${changed.length} function or core file(s) changed:`);
  for (const c of changed.slice(0, 30)) console.log(`  ${TIERS[c.tier].name.padEnd(22)} ${c.path}`);
}
