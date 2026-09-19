/**
 * `next build`, then PROVE THE CLIENT MANIFESTS ARE WHOLE — and rebuild once
 * if they are not.
 *
 * THE FAULT. Roughly once in every few CI builds, `next build` (webpack,
 * Next 15.5) writes a build in which one page's React client-reference
 * manifest is missing a component. That page then 500s with
 *
 *   Could not find the module ".../X.tsx#X" in the React Client Manifest.
 *   This is probably a bug in the React Server Components bundler.
 *
 * CLAUDE.md has tracked it since 2026-09-09 across GroupingControls,
 * ContestsClient, TeamsClient, OrganizationClient, FoursomeMaker, LocalePicker
 * and AnnouncementsClient. It is not the code: it struck a comment-only pull
 * request, and rebuilding the same commit clears it. On 2026-09-19 it hit four
 * times in one day — once on `main`, which left a merged change undeployed
 * until the job was re-run by hand.
 *
 * WHAT WAS MEASURED (2026-09-19). Eight local builds of one commit produced
 * identical manifests — it does not reproduce on demand, and no Next.js
 * release note from 15.5.23 to 15.5.25 mentions it. But one property holds in
 * every good build: in this app EVERY page's manifest lists the same set of
 * client modules (50 manifests, 81 modules each). So a build can be checked
 * against ITSELF: a page whose manifest is missing a module the others have
 * is exactly the fault, found without a second build to compare to.
 *
 * WHY A REBUILD IS NOT A TEST RETRY. CLAUDE.md forbids `retries` because a
 * retried test hides a real regression. This does not retry anything that
 * could be the code's fault: it inspects a build artifact deterministically,
 * and only a build that is provably inconsistent is thrown away. If the
 * rebuild is ALSO inconsistent it fails loudly — two bad builds in a row
 * would be worth a person looking at.
 *
 *   node scripts/build-checked.mjs          # builds into $NEXT_DIST_DIR or .next
 *   node scripts/build-checked.mjs --check  # only check an existing build
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const dist = process.env.NEXT_DIST_DIR || ".next";

/** Every page's client module set, keyed by the manifest's path. */
export function readManifests(distDir) {
  const root = path.join(distDir, "server", "app");
  const out = {};
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith("_client-reference-manifest.js")) {
        const src = fs.readFileSync(p, "utf8");
        const start = src.indexOf("{", src.indexOf("]="));
        let manifest = null;
        try {
          manifest = JSON.parse(src.slice(start).replace(/;\s*$/, ""));
        } catch {
          manifest = null;
        }
        const mods = manifest
          ? Object.keys(manifest.clientModules ?? {}).map((k) => k.split("#")[0].replace(/\\/g, "/"))
          : null;
        out[path.relative(root, p).replace(/\\/g, "/")] = mods ? new Set(mods) : null;
      }
    }
  };
  if (fs.existsSync(root)) walk(root);
  return out;
}

/**
 * What is wrong with a build's manifests, as sentences; empty when whole.
 *
 * Each page is compared with the UNION of every page's modules, restricted to
 * the app's own source (`/src/`), so a framework-internal entry that only some
 * pages carry cannot trip it.
 */
export function manifestProblems(manifests) {
  const pages = Object.entries(manifests);
  if (pages.length === 0) return ["no client-reference manifests found — was this a Next build?"];
  const problems = [];
  const own = (s) => [...s].filter((m) => m.includes("/src/"));
  const union = new Set();
  for (const [page, mods] of pages) {
    if (!mods) problems.push(`${page}: manifest could not be read`);
    else for (const m of own(mods)) union.add(m);
  }
  for (const [page, mods] of pages) {
    if (!mods) continue;
    const missing = [...union].filter((m) => !mods.has(m));
    if (missing.length) {
      problems.push(`${page}: missing ${missing.length} client module(s): ${missing.slice(0, 3).map((m) => m.replace(/^.*\/src\//, "src/")).join(", ")}`);
    }
  }
  return problems;
}

function build() {
  const r = spawnSync("npx", ["next", "build"], { stdio: "inherit", shell: true, env: process.env });
  return r.status ?? 1;
}

function check(label) {
  const problems = manifestProblems(readManifests(dist));
  if (problems.length === 0) {
    console.log(`[build-checked] ${label}: client manifests consistent in ${dist}`);
    return true;
  }
  console.error(`[build-checked] ${label}: INCONSISTENT client manifests in ${dist}`);
  for (const p of problems.slice(0, 10)) console.error(`  - ${p}`);
  return false;
}

const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  if (process.argv.includes("--check")) {
    process.exit(check("check") ? 0 : 1);
  }
  let code = build();
  if (code !== 0) process.exit(code);
  if (check("build 1")) process.exit(0);

  console.error("[build-checked] Rebuilding once — see the note at the top of scripts/build-checked.mjs.");
  code = build();
  if (code !== 0) process.exit(code);
  process.exit(check("build 2") ? 0 : 1);
}
