import { PrismaClient } from "@prisma/client";

/**
 * The database client.
 *
 * No Accelerate extension, deliberately. Production connects to Prisma
 * Postgres through its pooled `prisma+postgres://` endpoint (see the datasource
 * block in schema.prisma), and Prisma Client 6 understands that protocol on its
 * own — verified against the real endpoint, which answered P6002 "invalid API
 * key" rather than rejecting the URL scheme.
 *
 * @prisma/extension-accelerate was tried first and removed: paired with client
 * 6.19 it widens every `include`/`select` result to `{}`, silently costing the
 * type safety of about a hundred call sites in exchange for nothing this app
 * uses (its remaining value is `cacheStrategy`, which we do not want on live
 * scores anyway).
 */

/**
 * Which database this deployment talks to.
 *
 * A PREVIEW deployment gets its own, and everything else falls through to the
 * datasource in `schema.prisma` unchanged.
 *
 * Until this existed, opening a pull request produced a preview that read and
 * WROTE the production database — the one holding real members' names,
 * handicaps and money. `deploy-migrations.mjs` had already stopped a branch
 * changing production's schema, and said in its own header that the real
 * repair was "a separate database for the Preview environment". This is that
 * repair.
 *
 * It is done in code rather than in settings because Vercel does not allow a
 * marketplace database connection to be re-scoped once made: production's
 * `DATABASE_URL` covers Production AND Preview, its value is Sensitive and
 * therefore unreadable, and every route to narrowing it either refused or was
 * read-only. So the preview database is attached under its own prefix, which
 * cannot collide, and chosen here.
 *
 * `VERCEL_ENV` is the only thing consulted, and it is set by the platform
 * rather than by anything in this repository — so a local run, a CI run and a
 * production deploy all behave exactly as they did before. Falling back to
 * `undefined` is deliberate: if the preview database is ever detached, this
 * returns to the previous behaviour rather than throwing at import time on
 * every screen.
 */
function previewDatabaseUrl(): string | undefined {
  if (process.env.VERCEL_ENV !== "preview") return undefined;
  return process.env.PREVIEW_DATABASE_URL || undefined;
}

// Reuse a single PrismaClient across hot-reloads in dev (Next.js).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    ...(previewDatabaseUrl() ? { datasourceUrl: previewDatabaseUrl() } : {}),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
