#!/usr/bin/env node
/**
 * WHAT THIS CHANGE NEEDS BEFORE IT REACHES PRODUCTION.
 *
 *     npm run qa:changed                  # this branch against main
 *     npm run qa:changed -- <commit>      # against a commit — the last one certified, say
 *     npm run qa:changed -- origin/main --json   # the plan, for a machine (the Round workflow reads it)
 *     npm run qa:changed -- --files=src/components/BracketClient.tsx   # a dry run: the plan for those paths
 *
 * Reads the files that differ and says, from `TIER_RULES` in `layers.mjs`,
 * which tier each belongs to and what the HIGHEST one asks for. It is the
 * first thing to run on a finished change and the thing to quote in its pull
 * request: the depth of testing is decided by what was touched, not by how the
 * author feels about it.
 *
 * Since 2026-10-23 it also says the EXACT rounds (`roundPlan`): how many
 * `round/<name>-N` branches to push, whether they visit all six countries,
 * whether they run the console crawl and which file asked for it, and whether
 * the change then waits for the nightly round before production. The Round
 * workflow plans a pushed branch with the same function, so what this prints
 * is what runs.
 *
 * It also says whether the app itself changed (`app-id.mjs`): a change that
 * leaves the fingerprint alone leaves the count of clean rounds alone too.
 */
import { spawnSync } from "node:child_process";
import { TIERS, ARITHMETIC_KEEPS_THREE_ROUNDS, roundPlan, targetLine, tierOf } from "./layers.mjs";
import { appId, changedBetween } from "./app-id.mjs";

const args = process.argv.slice(2);
const json = args.includes("--json");
const base = args.find((a) => !a.startsWith("--")) ?? "origin/main";
const exists = spawnSync("git", ["rev-parse", "--verify", "--quiet", base]).status === 0;
if (!exists) {
  console.error(`there is no commit called ${base}`);
  process.exit(2);
}
const from = spawnSync("git", ["merge-base", base, "HEAD"], { encoding: "utf8" }).stdout.trim() || base;
// Committed changes since the base, and anything not yet committed on top.
// Files git does not track yet are named at the end and not judged: add them, and they are.
const status = spawnSync("git", ["status", "--short"], { encoding: "utf8" }).stdout.split("\n").filter(Boolean);
const untracked = status.filter((l) => l.startsWith("??")).map((l) => l.slice(3).replace(/^"|"$/g, ""));
const uncommitted = status.filter((l) => !l.startsWith("??")).map((l) => l.slice(3).replace(/^"|"$/g, ""));
// `--files=a,b,…` plans those paths instead of the diff: a dry run of the planner ("what would this change get?").
const given = (args.find((a) => a.startsWith("--files=")) ?? "").slice("--files=".length);
const seen = given ? new Map(given.split(",").filter(Boolean).map((p) => [p, tierOf(p)])) : new Map(changedBetween(from).map((c) => [c.path, c.tier]));
if (!given) for (const path of uncommitted) if (!seen.has(path)) seen.set(path, tierOf(path));
const plan = roundPlan([...seen.keys()]);

if (json) {
  console.log(JSON.stringify({ base, from: from.slice(0, 12), files: seen.size, ...plan }));
  process.exit(0);
}

if (!seen.size) {
  console.log(`nothing differs from ${base}`);
  process.exit(0);
}

const byTier = {};
for (const [path, tier] of seen) (byTier[tier] ??= []).push(path);
const order = Object.keys(TIERS).sort((a, b) => TIERS[b].rank - TIERS[a].rank);
const highest = order.find((t) => byTier[t]);

console.log(`Against ${base} (${from.slice(0, 8)}): ${seen.size} file(s)\n`);
for (const tier of order) {
  if (!byTier[tier]) continue;
  console.log(`${TIERS[tier].name.toUpperCase()} — ${byTier[tier].length}`);
  for (const p of byTier[tier].sort().slice(0, 40)) console.log(`  ${p}`);
  if (byTier[tier].length > 40) console.log(`  … and ${byTier[tier].length - 40} more`);
  console.log("");
}
const before = appId(from);
const after = appId("HEAD");
console.log(`THIS CHANGE IS: ${TIERS[highest].name}`);
console.log(`IT NEEDS: ${TIERS[highest].needs}`);
console.log("");

// ── The exact rounds ────────────────────────────────────────────────────────
if (plan.rounds === 0) {
  console.log("ROUNDS BEFORE IT MERGES: none — CI on the pull request is the whole of it.");
} else {
  const branch = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).stdout.trim().replace(/^.*\//, "") || "change";
  console.log(`ROUNDS BEFORE IT MERGES: ${plan.rounds}, each on the commit that will be production:`);
  for (let n = 1; n <= plan.rounds; n += 1) console.log(`  git push origin HEAD:round/${branch}-${n}`);
  if (plan.target) {
    console.log(`  ${targetLine(plan.target.area)}`);
    console.log(`    the area's specs: ${plan.target.specs.join(", ")}`);
    console.log(`    and always: the every-screen walk, the console crawl, the every-text-box crawl, the stranger sweep, a11y, fonts, layout and legibility; the walks abroad and Safari's and the iPad's screen layers as in any round`);
    console.log(`    countries: ${plan.target.countriesBecause}`);
  } else if (plan.tier === "function") {
    console.log(`  a FULL round, not a targeted one: ${plan.fullBecause}`);
  }
  console.log(`  countries: ${plan.countries === "all" ? (plan.tier === "core" ? "all six in each round (a core change)" : "all six (the area reads days, times or zones)") : "the three that round's number picks (the nightly visits all six)"}`);
  console.log(
    plan.target
      ? "  the console crawl: IN the round — a targeted round always runs it"
      : plan.crawl
      ? `  the console crawl: IN the round — because of ${plan.crawlBecause.slice(0, 4).join(", ")}${plan.crawlBecause.length > 4 ? ` and ${plan.crawlBecause.length - 4} more` : ""}`
      : "  the console crawl: left out — the change touches no input screen (the nightly runs it every night)",
  );
  if (plan.arithmetic.length) {
    console.log(`  THREE rounds, not one: it changes money or handicap arithmetic (${plan.arithmetic.join(", ")}).`);
    console.log(`  That is transitional (ARITHMETIC_KEEPS_THREE_ROUNDS = ${ARITHMETIC_KEEPS_THREE_ROUNDS} in layers.mjs) until property-based tests and the nightly mutation ratchet are on main.`);
  }
  console.log("  The Round workflow reads the same plan off the pushed branch: push the branch and nothing else.");
}
console.log(
  plan.nightly
    ? `AND BEFORE PRODUCTION: the nightly round on main (scheduled 02:00 UTC; it has been starting 07:30–08:15 UTC), on this commit or a later one containing it, must be clean${plan.target ? " — because its round was targeted, not full" : ""}. The deploy job holds the change until then and deploys it after.`
    : "AND BEFORE PRODUCTION: nothing more — the deploy job ships it once `verify` is green, outside a deploy freeze.",
);
console.log("");
if (given) {
  console.log("A dry run (--files): the paths given were planned; the branch's own diff was not read.");
  process.exit(0);
}
console.log(
  before === after && !uncommitted.some((p) => ["function", "core"].includes(tierOf(p)))
    ? `The app itself is unchanged (${after}): a count of clean rounds on it still stands.`
    : `The app itself changed (${before} → ${after}${uncommitted.length ? ", plus uncommitted files" : ""}): rounds counted on ${before} do not carry over.`,
);
if (untracked.length) console.log(`\nNot tracked by git, so not judged: ${untracked.join(", ")}`);
