// Fail, naming the cause, when the build a CI e2e shard is about to serve is not the one this run built.
//
//   node scripts/ci/check-prebuilt.mjs
//
// ci.yml builds the browser-test bundle ONCE (job `e2e-build`) and every e2e shard downloads it into
// .next-e2e instead of building its own (2026-11-12). The shard must never serve a build that is
// missing, half-downloaded or left from another commit: every test would then run against the wrong
// app, or against nothing, and the shard's failures would read as the app's. playwright.config.ts runs
// this before `next start` when E2E_PREBUILT=1, so a bad hand-off is one red step with a name.
//
// The build job writes BUILT_FROM (the commit it built) beside BUILD_ID. GITHUB_SHA is the commit this
// run checked out, the same in every job of a run.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dist = process.env.NEXT_DIST_DIR || ".next-e2e";
const fail = (why) => {
  console.error(`::error::The e2e build is not usable: ${why}. Every shard must take the build of job e2e-build; none builds its own.`);
  process.exit(1);
};

if (!existsSync(join(dist, "BUILD_ID"))) fail(`${dist}/BUILD_ID is missing (the artifact "e2e-build" was not downloaded, or is empty)`);
if (!existsSync(join(dist, "BUILT_FROM"))) fail(`${dist}/BUILT_FROM is missing, so nobody can say which commit this build is of`);
const builtFrom = readFileSync(join(dist, "BUILT_FROM"), "utf8").trim().split("\n")[0];
const wanted = process.env.GITHUB_SHA;
if (!wanted) fail("GITHUB_SHA is not set, so the build cannot be tied to this run's commit");
if (builtFrom !== wanted) fail(`${dist} is a build of ${builtFrom}, and this run is of ${wanted}`);
console.log(`e2e build: ${dist}, commit ${builtFrom}, id ${readFileSync(join(dist, "BUILD_ID"), "utf8").trim()}`);
