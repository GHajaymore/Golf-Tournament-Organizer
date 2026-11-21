import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSource, readVerbatim } from "./source";

/**
 * A preview build must never open a connection to production.
 *
 * In a Vercel preview the ordinary database variables are PRODUCTION's. The
 * choice of database for a build script lives in ONE module,
 * `scripts/build-database.mjs`, which swaps in the PREVIEW_ database or refuses
 * the build. pad-migration-names ran before the swap and so could read and
 * write production's `_prisma_migrations` from any branch (finding F2).
 *
 * Every script under scripts/ that creates a PrismaClient or reads a database
 * URL must import that module, EXCEPT the ones run by a person or by CI, which
 * Vercel never runs and which choose their own database. Those are named below
 * on purpose: adding one is a visible decision. Anything in the `vercel-build`
 * chain may never be on the list.
 */

const SHARED = /import\s+["']\.\.?\/(?:\.\.\/)?build-database\.mjs["']/;
const TOUCHES_DB = /PrismaClient|DATABASE_URL/;

// Run by a human or by CI on a database they chose; never part of a Vercel build.
const RUN_BY_A_PERSON_OR_CI = new Set([
  "backfill-country-codes.ts",
  "backfill-org-owners.ts",
  "build-guide-pdf.mjs",
  "capture-demo.mjs",
  "club-access.mjs",
  "count-unlocked-events.mjs",
  "export-catalogue.ts",
  "import-course-catalog.ts",
  "load/seed-shotgun.mjs",
  "load-board.mjs",
  "look-at-screens.mjs",
  "migrate-sqlite-to-postgres.ts",
  "repair-player-identity.ts",
  "report-carrier-groups.mjs",
  "rmstage-report-orphan-cards.mjs",
  "seed-club.mjs",
  "smoke-all.mjs",
  "smoke-routes.mjs",
  "sweep-duplicate-players.ts",
  "verify-drafting.mjs",
  "verify-lifecycle.mjs",
  "verify-money-intact.mjs",
  "verify-player-states.mjs",
  "verify-public-boards.mjs",
  "verify-round-controls.mjs",
  "verify-round-handicaps.mjs",
  "verify-week-view.mjs",
]);

function walk(dir: string, rel = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(dir, rel))) {
    const r = rel ? `${rel}/${name}` : name;
    if (statSync(join(dir, r)).isDirectory()) out.push(...walk(dir, r));
    else if (/\.(mjs|js|cjs|ts)$/.test(name)) out.push(r);
  }
  return out;
}

const scriptsDir = join(process.cwd(), "scripts");
const all = walk(scriptsDir);
const src = (f: string) => readSource("scripts", ...f.split("/"));

describe("a preview build never reaches production", () => {
  it("every script that touches the database goes through build-database.mjs", () => {
    const offenders = all.filter(
      (f) =>
        f !== "build-database.mjs" &&
        TOUCHES_DB.test(src(f)) &&
        !SHARED.test(src(f)) &&
        !RUN_BY_A_PERSON_OR_CI.has(f),
    );
    expect(offenders, "import ./build-database.mjs FIRST").toEqual([]);
  });

  it("the allowlist names only scripts that exist and still touch the database", () => {
    for (const f of RUN_BY_A_PERSON_OR_CI) {
      expect(all, `${f} is listed but gone`).toContain(f);
      expect(TOUCHES_DB.test(src(f)), `${f} no longer touches the database`).toBe(true);
    }
  });

  it("every script in the vercel-build chain imports it, and none is allowlisted", () => {
    const pkg = JSON.parse(readVerbatim("package.json")) as { scripts: Record<string, string> };
    const chain = [...(pkg.scripts["vercel-build"] ?? "").matchAll(/node\s+scripts\/(\S+\.mjs)/g)].map((m) => m[1]);
    expect(chain).toContain("pad-migration-names.mjs");
    expect(chain).toContain("deploy-migrations.mjs");
    for (const f of chain) {
      expect(RUN_BY_A_PERSON_OR_CI.has(f), `${f} is in the build`).toBe(false);
      if (TOUCHES_DB.test(src(f)) || f === "pad-migration-names.mjs") {
        expect(src(f), `${f} must import build-database.mjs`).toMatch(SHARED);
      }
    }
  });

  it("the shared module swaps in the preview database or refuses, never falls back", () => {
    const m = src("build-database.mjs");
    expect(m).toMatch(/VERCEL_ENV\s*===\s*["']preview["']/);
    expect(m).toMatch(/PREVIEW_DATABASE_URL_UNPOOLED/);
    expect(m).toMatch(/process\.exit\(1\)/);
    expect(m).toMatch(/process\.env\.PRISMA_DATABASE_URL\s*=\s*pooled/);
    expect(m).toMatch(/process\.env\.DATABASE_URL\s*=\s*direct/);
  });

  it("imports it before the client is created", () => {
    for (const f of ["pad-migration-names.mjs", "deploy-migrations.mjs"]) {
      const s = src(f);
      const at = s.search(SHARED);
      expect(at, `${f} imports it`).toBeGreaterThanOrEqual(0);
      const client = s.search(/new PrismaClient|spawnSync/);
      expect(at).toBeLessThan(client);
    }
  });

  it("runtime keeps the same rule: db.ts chooses PREVIEW_DATABASE_URL only in a preview", () => {
    const db = readSource("src", "lib", "db.ts");
    expect(db).toMatch(/VERCEL_ENV\s*!==\s*["']preview["']/);
    expect(db).toMatch(/PREVIEW_DATABASE_URL/);
  });
});
