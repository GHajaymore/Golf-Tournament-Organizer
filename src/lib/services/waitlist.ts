import "server-only";
import { prisma } from "../db";
import { notifyFieldChange } from "./field-notify";

/**
 * Keeping the field and the waitlist in step.
 *
 * Two faults from the 2026-09-02 audit turned out to be the same missing thing:
 * nowhere in the app asked "the field has room and people are queuing — should
 * anybody move?"
 *
 * G1. RAISING THE CAPACITY DRAINED NOTHING. An organizer with eight confirmed
 * and four waiting who opened the field to sixteen left all four on the
 * waitlist — while the public registration page immediately advertised the new
 * places. So the next strangers to open the link were confirmed ahead of the
 * people who had queued first, which is the one thing a waitlist exists to
 * prevent.
 *
 * G2. A WITHDRAWAL PROMOTED WITHOUT LOOKING AT THE LIMIT. `removeSignup`
 * promoted the earliest waitlisted entry whenever a confirmed player left, with
 * no check that there was room — so a field an organizer had just SHRUNK was
 * pushed straight back over its limit, and the promoted player was emailed
 * "you're in, your place is held". Once per withdrawal.
 *
 * One function answers both, which is why they are fixed together: the check
 * that stops G2 is the same arithmetic that performs G1.
 */

/** What the event's own settings say the field holds. Null means open. */
export function fieldLimitOf(event: {
  playerCountMode: string;
  manualPlayerCount: number;
  capacity: number;
}): number | null {
  /**
   * Manual mode wins, because it is the number the organizer typed.
   *
   * `applyManualCount` writes `playerCountMode: "manual"` alongside the count,
   * and from then on `capacity` is a stale registration-era figure that nothing
   * should be measured against.
   */
  const limit = event.playerCountMode === "manual" ? event.manualPlayerCount : event.capacity;
  // Zero or less is "Open" — an unlimited field, where nobody ever waits.
  return limit > 0 ? limit : null;
}

/**
 * Promote whoever is owed a place, in the order they queued.
 *
 * Safe to call whenever the field MIGHT have room: it promotes nobody when
 * there is none, so callers do not have to work out whether anything changed.
 *
 * Never demotes. A capacity cut is a decision an organizer makes with the field
 * in front of them, and quietly moving confirmed players to the waitlist
 * because a number went down would be a far worse surprise than an over-full
 * field they can see. `applyManualCount` already handles the trimming case
 * deliberately, with a confirmation.
 *
 * Returns how many were promoted, so a caller can say so.
 */
export async function drainWaitlist(eventId: string): Promise<number> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { capacity: true, playerCountMode: true, manualPlayerCount: true },
  });
  if (!event) return 0;

  const limit = fieldLimitOf(event);

  const confirmed = await prisma.player.count({ where: { eventId, status: "confirmed" } });
  // An open field takes everyone waiting; a limited one takes what fits.
  const room = limit === null ? Number.MAX_SAFE_INTEGER : limit - confirmed;
  if (room <= 0) return 0;

  /**
   * In seed order, which is the order they signed up.
   *
   * The whole promise of a waitlist is that it is a queue. Taking them in any
   * other order — or, as happened when nothing drained it at all, letting new
   * arrivals in ahead of them — is the unfairness the feature exists to avoid.
   */
  const waiting = await prisma.player.findMany({
    where: { eventId, status: "waitlisted" },
    orderBy: { seed: "asc" },
    take: room === Number.MAX_SAFE_INTEGER ? undefined : room,
    select: { id: true, email: true, name: true },
  });
  if (waiting.length === 0) return 0;

  await prisma.player.updateMany({
    where: { id: { in: waiting.map((p) => p.id) } },
    data: { status: "confirmed", promotedAt: new Date() },
  });

  /**
   * Told, and told after the write.
   *
   * The registration email promises "we'll be in touch if a place opens", and
   * this is the moment it opens. Notifying before the update would announce a
   * change that might then fail; `notifyFieldChange` swallows its own errors,
   * so a bounced message cannot undo a place in the field.
   */
  await notifyFieldChange(
    eventId,
    waiting.map((p) => ({ email: p.email, name: p.name })),
    "promoted",
  );

  return waiting.length;
}
