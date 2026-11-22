// The ONE place a build script learns which database it may touch.
//
// Import this FIRST, before anything creates a PrismaClient or reads
// DATABASE_URL / PRISMA_DATABASE_URL. Importing it is the whole API.
//
// In a Vercel PREVIEW build the project's ordinary database variables are
// PRODUCTION's (they are scoped Production + Preview and cannot be narrowed).
// Preview has its own database under the PREVIEW_ prefix. So in a preview this
// module points the variables Prisma reads at that database, and if it is not
// attached it REFUSES (exit 1): a preview build never falls back to production.
// Anywhere else (production, CI, local) it changes nothing: the caller chose.
//
// Found 2026-11-21: pad-migration-names ran before the swap and so read and
// could write production's _prisma_migrations from any branch.
// src/lib/db.ts makes the same choice at runtime for the app itself.

if (process.env.VERCEL_ENV === "preview") {
  const pooled = process.env.PREVIEW_DATABASE_URL;
  const direct = process.env.PREVIEW_DATABASE_URL_UNPOOLED;
  if (!pooled || !direct) {
    console.error(
      "build-database: REFUSING. This is a preview build and PREVIEW_DATABASE_URL /\n" +
        "  PREVIEW_DATABASE_URL_UNPOOLED are not both set, so the only database in\n" +
        "  reach is production's. A preview never connects to production.",
    );
    process.exit(1);
  }
  // schema.prisma: url = PRISMA_DATABASE_URL (pooled), directUrl = DATABASE_URL.
  process.env.PRISMA_DATABASE_URL = pooled;
  process.env.DATABASE_URL = direct;
}

export const buildDatabaseChosen = true;
