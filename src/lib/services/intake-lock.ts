import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";

/**
 * Serialise "count the field, decide, and insert the player" for ONE event.
 *
 * The sign-up paths read the confirmed count, ask `decideIntake` whether this
 * entry is confirmed or waitlisted, then create the row — three statements with
 * nothing between them. Two members entering at the exact capacity boundary both
 * read the same count, both are told "confirmed", and both are created: the
 * field goes one (or more) over the cap the tier or the organizer set. The same
 * gap lets one person's double-submit create two rows.
 *
 * A per-event Postgres advisory lock, held for the transaction, closes it. The
 * `_xact_` variant releases automatically when the transaction commits or rolls
 * back — no unlock to forget. Callers for the SAME event queue behind each
 * other, so the count each one reads already includes the entry before it;
 * callers for DIFFERENT events never contend, because the lock key is the event.
 * This is correct by construction rather than probabilistic, and needs neither a
 * schema migration nor the retry loop a SERIALIZABLE transaction would (a
 * serialization failure surfaced to a member mid-sign-up would be its own bug).
 *
 * The callback runs on the transaction client `tx`; everything inside it — the
 * count, the decision, the seed, the create — must use `tx`, or it runs outside
 * the lock and the race is back. Work that does not touch the count (looking up
 * the member, resolving a tee) belongs OUTSIDE this, before the call, to keep the
 * locked section short.
 */
export async function withEventIntakeLock<T>(
  eventId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    // `hashtext` maps the cuid to the integer key the advisory-lock API takes.
    // The lock is advisory (nothing else reads it) and scoped to this xact.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${eventId}))`;
    return fn(tx);
  });
}
