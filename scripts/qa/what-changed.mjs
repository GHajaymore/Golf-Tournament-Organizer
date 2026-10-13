#!/usr/bin/env node
/**
 * WHAT THIS CHANGE NEEDS BEFORE IT REACHES PRODUCTION.
 *
 *     npm run qa:changed                  # this branch against main
 *     npm run qa:changed -- <commit>      # against a commit — the last one certified, say
 *
 * Reads the files that differ and says, from `TIER_RULES` in `layers.mjs`,
 * which tier each belongs to and what the HIGHEST one asks for. It is the
 * first thing to run on a finished change and the thing to quote in its pull
 * request: the depth of testing is decided by what was touched, not by how the
 * author feels about it.
 *
 * It also says whether the app itself changed (`app-id.mjs`): a change that
 * leaves the fingerprint alone leaves the count of clean rounds alone too.
 */
import { spawnSync } from "node:child_process";
import { TIERS } from "./layers.mjs";
import { appId, changedBetween } from "./app-id.mjs";

const base = process.argv[2] ?? "origin/main";
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
const { tierOf } = await import("./layers.mjs");
const seen = new Map(changedBetween(from).map((c) => [c.path, c.tier]));
for (const path of uncommitted) if (!seen.has(path)) seen.set(path, tierOf(path));

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
console.log(
  before === after && !uncommitted.some((p) => ["function", "core"].includes(tierOf(p)))
    ? `The app itself is unchanged (${after}): a count of clean rounds on it still stands.`
    : `The app itself changed (${before} → ${after}${uncommitted.length ? ", plus uncommitted files" : ""}): rounds counted on ${before} do not carry over.`,
);
if (untracked.length) console.log(`\nNot tracked by git, so not judged: ${untracked.join(", ")}`);
