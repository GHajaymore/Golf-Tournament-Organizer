import "server-only";
import { prisma } from "@/lib/db";
import { teeTimeNotices } from "@/lib/domain/tee-time-notice";
import type { TeeSheet } from "@/lib/domain/tee-sheet";
import { sendPushToEmails } from "@/lib/services/push";

/**
 * Turning a published tee sheet into a push to each affected player.
 *
 * The decision — who, and whether it is news or a change — is `teeTimeNotices`,
 * which is pure and tested. This is the plumbing around it: resolve the players
 * to their emails, phrase the line, and hand each to the push rail. It only
 * ever runs when a sheet is PUBLISHED (the organizer's confirm), never on a
 * draft save.
 *
 * Never throws. The sheet is already published in the database by the time this
 * runs; a push that fails must not turn a completed publish into an error the
 * organizer sees. Same contract as `field-notify`.
 */
export async function notifyTeeTimesPublished(opts: {
  eventId: string;
  stageId: string;
  /** The previously stored sheet, for the change diff. Null on a first publish. */
  previous: TeeSheet | null;
  /** The sheet just published. */
  next: TeeSheet;
  /** True when this stage was not published before — everyone drawn is told. */
  firstPublish: boolean;
  /** "Round 3", or "" for a one-round tournament. */
  roundLabel: string;
  eventName: string;
}): Promise<void> {
  try {
    const notices = teeTimeNotices(opts.previous, opts.next, opts.firstPublish);
    if (notices.length === 0) return;

    const players = await prisma.player.findMany({
      where: { eventId: opts.eventId, id: { in: notices.map((n) => n.playerId) } },
      select: { id: true, email: true },
    });
    const emailById = new Map(players.map((p) => [p.id, (p.email ?? "").trim()]));

    const round = opts.roundLabel ? `${opts.roundLabel} · ` : "";
    const event = opts.eventName || "your tournament";

    await Promise.all(
      notices.map((n) => {
        const email = emailById.get(n.playerId);
        if (!email) return Promise.resolve();
        const when = n.time || "your tee time";
        const hole = n.startHole > 1 ? ` from the ${ordinal(n.startHole)}` : "";
        const title = n.kind === "changed" ? "Your tee time has changed" : "Your tee time is set";
        const body = `${round}${when}${hole} · ${event}`;
        // One tag per stage per player collapses a quick correction into a
        // single, latest notification rather than a stack of them.
        return sendPushToEmails([email], { title, body, url: "/me", tag: `tee-${opts.stageId}` });
      }),
    );
  } catch (e) {
    console.error(`[tee-time-notify] Could not notify tee times: ${e instanceof Error ? e.message : "unknown"}`);
  }
}

/** "1st", "2nd", "10th" — for "from the 10th". */
function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}
