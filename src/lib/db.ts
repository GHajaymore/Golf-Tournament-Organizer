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

// Reuse a single PrismaClient across hot-reloads in dev (Next.js).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
