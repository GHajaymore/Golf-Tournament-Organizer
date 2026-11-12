import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { fingerprint } from "@/lib/auth";
import {
  RATE_LIMITS,
  bucketKeyFor,
  decideClientFailures,
  decideRateLimit,
  unavailableDecision,
  unidentifiedDecision,
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
 *
 * AN ENTRY LINK MUST SAY WHAT IT CAN TAKE (2026-11-10). `register-token`'s
 * budget grows with the field (`entryLinkBudget`), so its caller has to hand
 * over `budget` — the compiler refuses the call without it. It is asked only
 * once the count passes the kind's fixed floor, so a link inside the floor
 * still costs no lookup before it is counted, exactly as before.
 */
export async function checkRateLimit(
  kind: "register-token",
  identifier: string,
  budget: () => Promise<number>,
): Promise<RateLimitDecision>;
export async function checkRateLimit(
  kind: Exclude<RateLimitKind, "register-token">,
  identifier: string,
): Promise<RateLimitDecision>;
export async function checkRateLimit(
  kind: RateLimitKind,
  identifier: string,
  budget?: () => Promise<number>,
): Promise<RateLimitDecision> {
  const now = Date.now();
  // Enforced HERE rather than trusted of each caller, because the failure is
  // invisible from the call site: an empty identifier does not error, it
  // silently merges that caller's budget with every other caller who arrives
  // without one. See unidentifiedDecision(). Trimmed and folded first, so the
  // check sees exactly what keyFor would have hashed — " " is not an identity
  // either.
  //
  // `typeof` and not just `.trim()`: the type says string, and types are erased.
  // A caller reading a field off a session shape that has since lost it hands
  // this `undefined`, and a TypeError here would take down the action instead of
  // refusing the call.
  // Enforced HERE rather than trusted of each caller, because the failure is
  // invisible from the call site: an empty identifier does not error, it
  // silently merges that caller's budget with every other caller who arrives
  // without one. See unidentifiedDecision(). Trimmed and folded first, so the
  // check sees exactly what keyFor would have hashed — " " is not an identity
  // either.
  //
  // `typeof` and not just `.trim()`: the type says string, and types are erased.
  // A caller reading a field off a session shape that has since lost it hands
  // this `undefined`, and a TypeError here would take down the action instead of
  // refusing the call.
  if (typeof identifier !== "string" || !identifier.trim()) {
    console.error(`[rate-limit] refused a "${kind}" attempt with no identifier`);
    return unidentifiedDecision();
  }
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
  const floor = RATE_LIMITS[kind].limit;
  if (attempts <= floor || !budget) return decideRateLimit(kind, attempts, now);
  let limit: number;
  try {
    limit = await budget();
  } catch (err) {
    // Fail closed, like the count itself: a budget nobody could read is no budget.
    console.error(`[rate-limit] could not read the "${kind}" budget:`, err);
    return unavailableDecision();
  }
  // Never below the floor, whatever a budget says.
  return decideRateLimit(kind, attempts, now, Math.max(floor, limit));
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
  // Same reason as the check: a blank identifier names the shared bucket, so
  // clearing it would hand a fresh allowance to everyone at once.
  if (typeof identifier !== "string" || !identifier.trim()) return;
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

/**
 * THE PER-CLIENT GUESS LIMIT (2026-11-12): one client trying MANY secrets.
 *
 * The per-code limits above cap guesses against each code, so one client trying
 * a million different codes is never slowed. This is the second, additional
 * limit: keyed on the client address, stored under the app's HMAC (`fingerprint`,
 * never a bare address or an unkeyed hash), counting only FAILED lookups and
 * NEVER cleared by a success. A club's wifi with forty players entering the one
 * real code counts nothing; a script trying codes is refused after the kind's
 * limit (`round-code-client`: twenty failures in fifteen minutes).
 *
 * Call it before the lookup; on a failed lookup call `recordFailure()`. The guest
 * player link (J39/J40) uses the same function. Address-less (no header) or an
 * unreadable counter: no per-client limit, the per-code one still stands, because
 * one shared bucket would block innocents.
 */
export async function clientGuessGate(
  kind: RateLimitKind,
  clientAddress: string | null,
): Promise<{ decision: RateLimitDecision; recordFailure: () => Promise<void> }> {
  const none = { decision: { allowed: true, retryAfterSeconds: 0, message: "" }, recordFailure: async () => {} };
  if (!clientAddress) return none;
  const now = Date.now();
  const key = bucketKeyFor(kind, fingerprint(`client:${clientAddress.trim().toLowerCase()}`), now);
  try {
    const row = await prisma.rateLimitHit.findUnique({ where: { key }, select: { count: true } });
    const decision = decideClientFailures(kind, row?.count ?? 0, now);
    const expiresAt = new Date(windowFor(RATE_LIMITS[kind], now).endsAt).toISOString();
    return {
      decision,
      recordFailure: async () => {
        try {
          await prisma.$queryRaw`
            INSERT INTO "RateLimitHit" ("key", "count", "expiresAt")
            VALUES (${key}, 1, ${expiresAt}::timestamp)
            ON CONFLICT ("key") DO UPDATE SET "count" = "RateLimitHit"."count" + 1
            RETURNING "count"
          `;
        } catch (err) {
          console.error("[rate-limit] could not record a client failure:", err);
        }
      },
    };
  } catch (err) {
    console.error("[rate-limit] could not read a client's failures:", err);
    return none;
  }
}
