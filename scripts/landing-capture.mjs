/**
 * `npm run landing:capture` — re-shoot the front door's screens in one command (2026-11-01).
 *
 *   npm run landing:capture                         every screen `src/lib/landing/screens.ts` can shoot
 *   npm run landing:capture -- --only=live-card-before,live-board-after,live-desk-before,live-desk-after
 *
 * Needs this checkout's dev server on http://localhost:3100 (CAPTURE_BASE_URL to change it) and the
 * LOCAL development database in `.env`. It refuses anything else, twice: here, and in
 * `capture-demo.mjs` itself (hard rule 1 — the demo club is seeded, dressed, shot and torn down).
 *
 * Then `place-landing-shots.mjs` checks every capture against the manifest (size, crop, the words
 * that must be on it, the live moment's figures) and writes `public/landing/` only if all pass.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const pass = process.argv.slice(2);
const local = (h) => ["localhost", "127.0.0.1", "::1", "[::1]"].includes(h.toLowerCase());

const envFile = existsSync(".env") ? ".env" : null;
const dbUrl = process.env.DATABASE_URL ?? (envFile ? (readFileSync(envFile, "utf8").match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m) ?? [])[1] : undefined);
if (!dbUrl) { console.error("landing:capture: no DATABASE_URL (in the environment or .env)."); process.exit(2); }
let dbHost;
try { dbHost = new URL(dbUrl).hostname; } catch { console.error("landing:capture: DATABASE_URL has no readable host. Refusing."); process.exit(2); }
if (!local(dbHost)) { console.error(`landing:capture: refusing the database at "${dbHost}" — the local development database only.`); process.exit(2); }
const base = process.env.CAPTURE_BASE_URL ?? "http://localhost:3100";
if (!local(new URL(base).hostname)) { console.error(`landing:capture: refusing ${base} — a local server only.`); process.exit(2); }

const out = mkdtempSync(join(tmpdir(), "tourneyhq-landing-"));
const node = process.execPath;
const run = (script, extra) => {
  // The manifest is a .ts file Node reads by stripping its types; the note it prints about that says nothing.
  const quiet = ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--disable-warning=ExperimentalWarning"];
  const r = spawnSync(node, [...quiet, ...(envFile ? [`--env-file=${envFile}`] : []), script, out, ...extra], { stdio: "inherit" });
  return r.status ?? 1;
};
console.log(`Capturing into ${out}`);
if (run("scripts/capture-demo.mjs", ["--landing", ...pass]) !== 0) { console.error("landing:capture: the capture failed — nothing was placed."); process.exit(1); }
const placed = run("scripts/place-landing-shots.mjs", pass.filter((a) => a.startsWith("--only=")));
process.exit(placed);
