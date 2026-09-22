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
import { spawn } from "node:child_process";
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

/**
 * Whether a failed build failed because `next/font` could not fetch.
 *
 * THE SECOND FAULT, and it is not ours either. `next/font/google` downloads
 * the font CSS at build time and reads it with a regex; when the fetch fails
 * — no network, a 429, a truncated body — `.match()` returns null and the
 * loader dies on `reading '1'`. The build then reports
 *
 *   src/app/layout.tsx
 *   An error occurred in `next/font`.
 *   TypeError: Cannot read properties of null (reading '1')
 *       at .../@next/font/dist/google/loader.js:122:78
 *
 * which reads exactly like a compile error in our own layout. On 2026-09-21 it
 * failed three CI jobs across three pull requests in one evening, two of them
 * on commits that could not have caused anything (one added a single test
 * file, one edited only CLAUDE.md). Every one cleared on a re-run.
 *
 * BOTH SIGNALS ARE REQUIRED, deliberately. Matching `next/font` alone would
 * catch a genuine mistake in how a font is configured — a bad weight, a
 * missing subset — and retry it forever. The loader path pins it to the
 * FETCH-AND-PARSE step inside the packaged loader, which no change in this
 * repository can reach.
 *
 * This is the same bargain as the manifest rebuild above and not the `retries`
 * CLAUDE.md forbids: nothing the code could be at fault for is retried. A
 * syntax error, a type error, a missing import — every ordinary build failure
 * still fails on the first attempt, immediately. Proven by
 * `build-retries-only-the-font-fetch.test.ts`, which feeds this real logs.
 */
export function isFontFetchFailure(output) {
  const s = String(output ?? "");
  return s.includes("An error occurred in `next/font`") && s.includes("@next/font/dist/google/loader");
}

/**
 * Run `next build`, streaming its output AND keeping a copy.
 *
 * Tee rather than `stdio: "inherit"`, because the retry above has to read what
 * the build said — and rather than `stdio: "pipe"` alone, because a CI job
 * that prints nothing for two minutes and then dumps everything at the end is
 * a job nobody can watch. The copy is capped: a build that fails in a loop can
 * print megabytes, and all this needs is enough to recognise a signature.
 */
function build() {
  return new Promise((resolve) => {
    const child = spawn("npx", ["next", "build"], {
      shell: true,
      env: process.env,
      stdio: ["inherit", "pipe", "pipe"],
    });
    let kept = "";
    const tee = (stream, sink) => {
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => {
        sink.write(chunk);
        if (kept.length < 1_000_000) kept += chunk;
      });
    };
    tee(child.stdout, process.stdout);
    tee(child.stderr, process.stderr);
    child.on("close", (code) => resolve({ code: code ?? 1, out: kept }));
    child.on("error", (err) => resolve({ code: 1, out: `${kept}\n${err.message}` }));
  });
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

  const first = await build();

  /**
   * A FAILED build is retried for exactly one reason, and every other failure
   * exits here on the first attempt — a syntax error, a type error, a missing
   * import. That is the line this whole file is standing on.
   */
  if (first.code !== 0) {
    if (!isFontFetchFailure(first.out)) process.exit(first.code);
    console.error("[build-checked] build 1: `next/font` could not fetch — that is a network failure, not this commit.");
    console.error("[build-checked] Rebuilding once — see the note on isFontFetchFailure.");
    const retry = await build();
    if (retry.code !== 0) {
      // Twice in a row is no longer plausibly the network, whichever error it
      // is now, so it goes to a person rather than round again.
      console.error("[build-checked] build 2 failed as well — not retrying again.");
      process.exit(retry.code);
    }
    process.exit(check("build 2") ? 0 : 1);
  }

  if (check("build 1")) process.exit(0);

  console.error("[build-checked] Rebuilding once — see the note at the top of scripts/build-checked.mjs.");
  const second = await build();
  if (second.code !== 0) process.exit(second.code);
  process.exit(check("build 2") ? 0 : 1);
}
