// Applies pending migrations — from a PRODUCTION deploy, and nowhere else.
//
// The build used to run `prisma migrate deploy` unconditionally, and this
// project's `DATABASE_URL` is scoped to "Production, Preview" — one value,
// both environments. So opening a pull request was what migrated the
// production database. Not merging it, not reviewing it: opening it.
//
// That is the wrong place for the decision to live. A branch is where a
// migration is least reviewed and most likely to be wrong, and the database it
// was reaching holds real members' names, handicaps and money. Nothing had
// gone badly wrong yet — the migrations that arrived this way were additive —
// but "so far the bad thing has not happened" is not a safeguard.
//
// So the gate is on VERCEL_ENV, which Vercel sets to `production`, `preview`
// or `development` on every build:
//
//   production  → migrate, exactly as before
//   preview     → skip, loudly, and say why
//   anything else, or unset → migrate, because that is a local or CI build
//                             where the caller chose the database themselves
//
// WHAT THIS DOES NOT FIX. A preview still CONNECTS to the production database
// at runtime — this only stops it writing schema. The real repair is a
// separate database for the Preview environment, which is a Vercel settings
// change rather than a line of code, and is written up in the commit that
// added this file.
//
// A KNOWN CONSEQUENCE, and the right trade. A preview built from a branch that
// adds a migration now runs against a database that does not have it, so those
// screens will fail in the preview until the branch is merged. A broken
// preview is visible, cheap, and recoverable. An unreviewed migration on the
// production database is none of those things.

import { spawnSync } from "node:child_process";

const env = process.env.VERCEL_ENV;

/**
 * Preview now has a database of its own, so it migrates its own database.
 *
 * The header above called the skip "a known consequence, and the right trade":
 * a branch that adds a migration produced a preview running against a database
 * without it, so those screens failed until it was merged. That trade was only
 * worth making while Preview and Production shared one database. They no
 * longer do — Preview is attached separately under the `PREVIEW_` prefix — so
 * the reason for the skip is gone and its cost need not be paid.
 *
 * The guard is the PRESENCE of that separate database, not a flag somebody can
 * set. No `PREVIEW_DATABASE_URL_UNPOOLED` means we are back in the old world
 * where a preview's DATABASE_URL may be production's, and the old refusal
 * applies unchanged. Detaching the preview database therefore fails safe,
 * rather than silently pointing branch migrations at real members' data.
 */
const previewDirect = process.env.PREVIEW_DATABASE_URL_UNPOOLED;
const previewPooled = process.env.PREVIEW_DATABASE_URL;

if (env === "preview" && previewDirect && previewPooled) {
  console.log(
    "deploy-migrations: preview deploy — applying migrations to the PREVIEW\n" +
      "  database, which is separate from production.",
  );
  // Prisma reads its datasource from the environment, so the preview values go
  // where schema.prisma looks: `url` and `directUrl`.
  process.env.PRISMA_DATABASE_URL = previewPooled;
  process.env.DATABASE_URL = previewDirect;
} else if (env && env !== "production") {
  console.log(
    `deploy-migrations: VERCEL_ENV=${env} — skipping "prisma migrate deploy".\n` +
      "  No separate preview database is attached (PREVIEW_DATABASE_URL_UNPOOLED\n" +
      "  is unset), so this build's DATABASE_URL may be production's, and\n" +
      "  migrating from a branch would change the production database.",
  );
  process.exit(0);
}

console.log(
  env
    ? "deploy-migrations: production deploy — applying migrations."
    : "deploy-migrations: no VERCEL_ENV (local or CI) — applying migrations.",
);

// `inherit`, so Prisma's own output and its exit code reach the build log
// unchanged. A migration failure must still fail the build.
const run = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.exit(run.status ?? 1);
