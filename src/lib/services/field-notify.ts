import "server-only";
import { prisma } from "@/lib/db";
import { sendFieldStatusEmail, type FieldChange } from "@/lib/email";

/**
 * Telling players their place in the field moved.
 *
 * One function rather than the same six lines in each action, because the
 * paths that move players are spread across `tournament.ts` and there will be
 * more of them — a cut, a withdrawal on the day, a merged flight. Each one
 * having to remember to look up the event, filter out the players with no
 * address and swallow its own errors is exactly the guard CLAUDE.md says will
 * be forgotten.
 *
 * Never throws. The field is already correct in the database by the time this
 * runs, and no notification failure may undo a place in it.
 */

/** What the caller has to hand after a status update. */
export interface NotifiablePlayer {
  email: string;
  name: string;
}

/**
 * Notify each player whose status changed, and never fail the caller.
 *
 * Players with no email are skipped silently and deliberately. A roster
 * imported from a club's own records is routinely half addresses and half not,
 * and an organizer who typed no address for somebody has not failed at
 * anything — there is nothing to report and nothing to fix.
 */
export async function notifyFieldChange(
  eventId: string,
  players: NotifiablePlayer[],
  change: FieldChange,
): Promise<void> {
  const reachable = players.filter((p) => p.email.trim());
  if (reachable.length === 0) return;

  try {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { name: true, dates: true, course: true, organizationId: true },
    });
    if (!event) return;

    /**
     * Concurrently, but each send already swallows its own failure, so one bad
     * address cannot stop the rest. Bounded in practice by the size of the
     * waitlist — enlarging a field promotes at most the people queued for it,
     * not the whole roster.
     */
    await Promise.all(
      reachable.map((p) =>
        sendFieldStatusEmail(p.email, {
          change,
          eventName: event.name,
          eventDates: event.dates,
          eventCourse: event.course,
          organizationId: event.organizationId,
          eventId,
          toName: p.name,
        }),
      ),
    );
  } catch (e) {
    // Belt and braces: sendFieldStatusEmail does not throw, but the event
    // lookup can, and a database blip must not turn a completed field change
    // into an error the organizer sees.
    console.error(
      `[field-notify] Could not notify a field change: ${e instanceof Error ? e.message : "unknown"}`,
    );
  }
}
