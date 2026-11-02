/**
 * THE QUARANTINE: TESTS A ROUND RUNS AND DOES NOT COUNT (the panel, 2026-10-23).
 *
 *     node scripts/qa/quarantine.mjs          # is every entry sound and in date? exit 1 if not
 *     node scripts/qa/quarantine.mjs --json
 *
 * Zero retries stays (`playwright.config.ts`): a retry that hides a flaky test
 * hides a real regression on the same spec just as well. What the panel added
 * instead is a list, `e2e/quarantine.json`, of tests known to be wrong ABOUT
 * THEMSELVES — a race in the test, not a fault in the app — with who is fixing
 * each and by when. A round still runs every one of them and reports what it
 * did, in a section of its own; it just does not count a quarantined failure
 * toward the verdict (`merge.mjs`).
 *
 * Three rules keep it from becoming a place tests go to be forgotten:
 *
 *   - every entry names a spec, a test, an owner, a reason and an expiry date,
 *     at most 30 days after the day it was checked;
 *   - an entry past its date quarantines NOTHING — its failures count again —
 *     and this check fails, in the nightly's "known holes" layer, the same way
 *     an accepted vulnerability past its date does (`dependencies.mjs`);
 *   - an entry that matches no test on disk is a finding too: the list may only
 *     hold what is true.
 *
 * Starts empty. Adding the first entry is a decision to write in the pull
 * request that adds it, with the failing run's log beside it.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const QUARANTINE_PATH = join("e2e", "quarantine.json");
/** The longest an entry may be granted, counted from the day it is checked. */
export const MAX_DAYS = 30;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The list as written. Missing is empty; unreadable is an error, not an empty list. */
export function readQuarantine(path = QUARANTINE_PATH) {
  if (!existsSync(path)) return [];
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(parsed.entries)) throw new Error(`${path} has no "entries" list`);
  return parsed.entries;
}

const plainSpec = (spec) => String(spec ?? "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/^e2e\//, "");

/** What is wrong with each entry on `today` (yyyy-mm-dd). Empty when the list is sound. */
export function quarantineProblems(entries, today, specExists = (spec) => existsSync(join("e2e", plainSpec(spec)))) {
  const problems = [];
  const limit = new Date(`${today}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + MAX_DAYS);
  const latest = limit.toISOString().slice(0, 10);
  entries.forEach((e, i) => {
    const name = `entry ${i + 1} (${e?.spec ?? "no spec"} › ${e?.test ?? "no test"})`;
    for (const field of ["spec", "test", "owner", "reason", "expires"]) {
      if (typeof e?.[field] !== "string" || !e[field].trim()) problems.push(`${name}: has no ${field}`);
    }
    if (typeof e?.expires === "string" && !DAY.test(e.expires)) problems.push(`${name}: expires "${e.expires}" is not a yyyy-mm-dd day`);
    else if (typeof e?.expires === "string" && e.expires < today) problems.push(`${name}: expired on ${e.expires} — fix the test or take it off; its failures count again`);
    else if (typeof e?.expires === "string" && e.expires > latest) problems.push(`${name}: expires ${e.expires}, more than ${MAX_DAYS} days ahead — a quarantine is a date to look again, not a home`);
    if (typeof e?.spec === "string" && e.spec.trim() && !specExists(e.spec)) problems.push(`${name}: no such spec in e2e/`);
  });
  return problems;
}

/** The entries that still quarantine on `today`: sound and in date. */
export function activeEntries(entries, today) {
  return entries.filter((e) => typeof e?.spec === "string" && typeof e?.test === "string" && e.spec.trim() && e.test.trim() && DAY.test(e?.expires ?? "") && e.expires >= today);
}

/**
 * Whether one failure, as a round writes it down (`[desktop] › offline.spec.ts:245:5 › taking their
 * card …`, a path with either slash), is a test on the list. The spec must be in the line AND the
 * test's words: a spec alone would quarantine every test in the file.
 */
export function quarantinedBy(failure, entries) {
  const line = String(failure).replace(/\\/g, "/");
  return entries.find((e) => line.includes(plainSpec(e.spec)) && line.includes(e.test.trim())) ?? null;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const today = new Date().toISOString().slice(0, 10);
  let entries;
  try {
    entries = readQuarantine();
  } catch (e) {
    console.log(`  ✗ ${QUARANTINE_PATH} cannot be read: ${e instanceof Error ? e.message : String(e)}`);
    console.log("QUARANTINE: 1 finding(s)");
    process.exit(1);
  }
  const problems = quarantineProblems(entries, today);
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ entries: entries.length, active: activeEntries(entries, today).length, problems }, null, 1));
  } else {
    for (const e of activeEntries(entries, today)) console.log(`  quarantined  ${e.spec} › ${e.test} — ${e.owner}, until ${e.expires}: ${e.reason}`);
    for (const p of problems) console.log(`  ✗ ${p}`);
    console.log(problems.length ? `QUARANTINE: ${problems.length} finding(s)` : `QUARANTINE: ${entries.length ? `${entries.length} test(s) quarantined, each with an owner and a date` : "empty — every test counts"}`);
  }
  process.exit(problems.length ? 1 : 0);
}
