import "server-only";

/**
 * Minimal in-memory fixed-window rate limiter for auth endpoints.
 *
 * Scope and limits of this approach, stated plainly:
 *   - State lives in process memory, so each serverless instance counts
 *     separately and a deploy resets counters. That makes it a meaningful
 *     brake on password guessing, not an airtight control.
 *   - For a stronger guarantee (shared across instances, survives deploys)
 *     move this to the database or a Redis-backed store. The call sites
 *     don't change — only this module does.
 *
 * It is deliberately dependency-free so it works anywhere the app runs.
 */

interface Window {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Window>();

/** Drop expired windows so the map can't grow without bound. */
function sweep(now: number) {
  if (buckets.size < 500) return;
  for (const [key, w] of buckets) if (w.resetAt <= now) buckets.delete(key);
}

export interface RateLimitResult {
  ok: boolean;
  /** Whole seconds until the window resets (0 when ok). */
  retryAfterSeconds: number;
}

/**
 * Count one attempt against `key`. Returns ok:false once `limit` attempts
 * have been made inside `windowMs`.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  if (existing.count > limit) {
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) };
  }
  return { ok: true, retryAfterSeconds: 0 };
}

/** Clear a key's window — call after a successful sign-in so a legitimate
 *  user who fumbled their password a few times isn't left throttled. */
export function clearRateLimit(key: string): void {
  buckets.delete(key);
}

/** Human-friendly "try again in ..." text. */
export function retryAfterText(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const mins = Math.ceil(seconds / 60);
  return `${mins} minute${mins === 1 ? "" : "s"}`;
}
