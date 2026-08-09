import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import {
  RATE_LIMITS,
  bucketKeyFor,
  decideRateLimit,
  unavailableDecision,
  windowFor,
  type RateLimitDecision,
  type RateLimitKind,
} from "@/lib/domain/rate-limit";

/**
 * Where the attempt counters actually live: Postgres.
 *
 * This used to be a Map in process memory, which on Vercel is close to no
 * limiter at all. Every request can land on a different instance, instances
 * cold-start constantly and every deploy wipes the lot — so "5 attempts per 15
 * minutes" was really "5 attempts per instance that happens to still be warm",
 * and an attacker guessing round codes in parallel got a fresh budget most
 * requests. The counter has to be shared to mean anything, and the database is
 * already on the far side of every one of these calls.
 *
 * The write is one statement — an upsert that adds one and returns the new
 * total — so concurrent instances cannot both read zero and both allow. The
 * decision is made afterwards, from the number Postgres handed back, by the
 * pure rules in domain/rate-limit.ts.
 */

/** Expired rows are dropped on roughly one write in fifty. Sweeping on every
 *  write would double the cost of every sign-in to delete rows that are
 *  already being ignored; never sweeping would grow the table forever. */
const PRUNE_ODDS = 0.02;

/**
 * The stored form of an identifier.
 *
 * sha256, so the table holds no readable email address and no live round code.
 * Without this, a table whose entire purpose is defending secrets would itself
 * be a list of the secrets people are currently trying — the round code an
 * attacker guessed and the addresses of everyone who signed in today, in
 * plaintext, next to the tournament data they unlock.
 *
 * Case-folded and trimmed because the same person typing " Bob@Club.com " and
 * "bob@club.com" is one budget, not two. Callers already normalize, and doing
 * it again here means a caller that forgets cannot accidentally hand somebody
 * a second allowance.
 */
function keyFor(kind: RateLimitKind, identifier: string, now: number): string {
  const hashed = createHash("sha256").update(identifier.trim().toLowerCase()).digest("hex");
  return bucketKeyFor(kind, hashed, now);
}

/**
 * Count one attempt against this identifier and say whether it may proceed.
 *
 * Call it *before* looking the secret up, so a refusal costs the attacker a
 * query they don't get and tells them nothing about whether the thing they
 * typed exists.
 */
export async function checkRateLimit(kind: RateLimitKind, identifier: string): Promise<RateLimitDecision> {
  const now = Date.now();
  const key = keyFor(kind, identifier, now);
  // As an ISO string with an explicit cast, not as a Date. Binding a JS Date
  // through $queryRaw into a `timestamp` column writes the server's *local*
  // wall clock, while Prisma's own reads and writes are UTC — so on a machine
  // four hours behind UTC every row was born four hours expired, and the first
  // sweep deleted every counter in the table. The limiter still looked fine in
  // a single burst and quietly reset itself at random, which is the worst way
  // for this particular thing to fail. The audit test caught it; this is why
  // there is one.
  const expiresAt = new Date(windowFor(RATE_LIMITS[kind], now).endsAt).toISOString();

  let attempts: number;
  try {
    // One statement, one round trip, atomic under concurrency: two instances
    // arriving together get 1 and 2 back, never 1 and 1. Written raw rather
    // than as prisma.upsert() because upsert is a read followed by a write and
    // that is exactly the race this has to avoid.
    const rows = await prisma.$queryRaw<Array<{ count: number }>>`
      INSERT INTO "RateLimitHit" ("key", "count", "expiresAt")
      VALUES (${key}, 1, ${expiresAt}::timestamp)
      ON CONFLICT ("key") DO UPDATE SET "count" = "RateLimitHit"."count" + 1
      RETURNING "count"
    `;
    attempts = rows[0]?.count ?? 1;
  } catch (err) {
    // Fail closed. See unavailableDecision() for why this costs no uptime.
    console.error("[rate-limit] could not record an attempt:", err);
    return unavailableDecision();
  }

  await prune(now);
  return decideRateLimit(kind, attempts, now);
}

/**
 * Forget this identifier's attempts.
 *
 * Called after a success, so the group that fumbled the code twice on the
 * first tee starts the round with a full allowance instead of one wrong entry
 * away from a lockout. Only the current window is deleted because only the
 * current window is counted; older rows are already inert and the sweep will
 * take them.
 */
export async function clearRateLimit(kind: RateLimitKind, identifier: string): Promise<void> {
  try {
    await prisma.rateLimitHit.deleteMany({ where: { key: keyFor(kind, identifier, Date.now()) } });
  } catch (err) {
    // Swallowed on purpose: this runs on the success path, after the person is
    // already signed in or already in the round. Failing here leaves them with
    // a partly-spent allowance, which is a small annoyance; throwing here would
    // turn a successful sign-in into an error.
    console.error("[rate-limit] could not clear attempts:", err);
  }
}

async function prune(now: number): Promise<void> {
  if (Math.random() >= PRUNE_ODDS) return;
  try {
    await prisma.rateLimitHit.deleteMany({ where: { expiresAt: { lt: new Date(now) } } });
  } catch (err) {
    // Housekeeping. A failed sweep must never refuse anybody a sign-in.
    console.error("[rate-limit] sweep failed:", err);
  }
}

export type { RateLimitDecision, RateLimitKind };
