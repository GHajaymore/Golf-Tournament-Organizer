import "server-only";
import { prisma } from "@/lib/db";
import { lineupNotices } from "@/lib/domain/cup";
import { sendPushToEmails } from "@/lib/services/push";
/** A session, or one match of it added after the lineup was announced. */
interface Announced {
  id: string;
  name: string;
  kind: string;
  matches: { a: string[]; aIds: string[]; b: string[]; bIds: string[] }[];
}

/**
 * Telling each player in an announced session which match they are in.
 *
 * Who and what is `lineupNotices`, which is pure and tested; this resolves the
 * players to their emails and hands each line to the push rail — the same one
 * the tee-time alerts use, opted into on the player's own phone.
 *
 * Never throws: the lineup is already announced in the database by the time
 * this runs, and a push that fails must not turn that into an error the
 * organizer sees. Same contract as `tee-time-notify`.
 */
export async function notifyLineupPublished(eventId: string, session: Announced): Promise<void> {
  try {
    const notices = lineupNotices(session);
    if (notices.length === 0) return;
    const players = await prisma.player.findMany({
      where: { eventId, id: { in: notices.map((n) => n.playerId) } },
      select: { id: true, email: true },
    });
    const emailById = new Map(players.map((p) => [p.id, (p.email ?? "").trim()]));
    await Promise.all(
      notices.map((n) => {
        const email = emailById.get(n.playerId);
        if (!email) return Promise.resolve();
        // One tag per session: a re-announcement replaces the first rather
        // than stacking two notifications for the same match.
        return sendPushToEmails([email], { title: n.title, body: n.body, url: "/me", tag: `lineup-${session.id}` });
      }),
    );
  } catch (e) {
    console.error(`[cup-notify] Could not notify the lineup: ${e instanceof Error ? e.message : "unknown"}`);
  }
}
