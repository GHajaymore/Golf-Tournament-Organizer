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

if (env && env !== "production") {
  console.log(
    `deploy-migrations: VERCEL_ENV=${env} — skipping "prisma migrate deploy".\n` +
      "  Migrations are applied from production deploys only. This project's\n" +
      "  DATABASE_URL is shared between Production and Preview, so migrating\n" +
      "  from a preview would change the production database from a branch.",
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
