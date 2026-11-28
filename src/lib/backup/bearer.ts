import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Does `Authorization` carry `Bearer <secret>`? In constant time, and false
 * whenever the secret is missing or too short.
 *
 * Both sides are hashed first, so the comparison is always 32 bytes against 32
 * bytes: unlike a length check followed by `timingSafeEqual`, it does not even
 * say how long the secret is. A MISSING secret is a refusal, never "let it
 * through" — an unconfigured backup that never runs is a feature switched off;
 * an unauthenticated one is a way for anybody to read the database on demand
 * (the reasoning of `cron-auth.audit.test.ts`).
 */
export function bearerMatches(header: string | null, secret: string | undefined, minLength = 1): boolean {
  if (!secret || secret.length < minLength) return false;
  const offered = createHash("sha256").update(header ?? "", "utf8").digest();
  const expected = createHash("sha256").update(`Bearer ${secret}`, "utf8").digest();
  return timingSafeEqual(offered, expected);
}

/** The trigger secret GitHub holds is generated as 32 random bytes (64 hex); anything shorter is refused. */
export const TRIGGER_SECRET_MIN_LENGTH = 32;

/**
 * Backups run only from PRODUCTION's deployment. A preview deployment holds
 * production's `DATABASE_URL` too (src/lib/db.ts: Vercel will not re-scope it),
 * so a preview reached with a cron secret must not read production into
 * anybody's store. Off Vercel (`VERCEL_ENV` unset: a test, a local run) it is
 * allowed.
 */
export function backupMayRunHere(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return !env.VERCEL_ENV || env.VERCEL_ENV === "production";
}
