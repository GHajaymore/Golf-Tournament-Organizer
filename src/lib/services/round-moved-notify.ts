import "server-only";
import { prisma } from "@/lib/db";
import { roundMovedNotice, noticesOffWords } from "@/lib/domain/round-moved";
import { isLaunched } from "@/lib/domain/lifecycle-state";
import { roundLabel } from "@/lib/domain/round-label";
import { whoKeysForEntry } from "@/lib/domain/messaging";
import { formattingForEvent, golfTermsForEvent } from "@/lib/services/organization";
import { noticesOffAmong, sendPushTo } from "@/lib/services/push";

/**
 * TELLING THE FIELD A ROUND HAS MOVED (J39/J40 PR 2; design §4.3, proposal P2).
 *
 * Whether it is news is `roundMovedNotice`, pure and tested: a first dating,
 * the same day again, and anything before the event was launched to players
 * tell nobody. This is the plumbing: every confirmed entry, by who-key (a
 * guest's link included), one tag per round so a quick correction replaces the
 * first notice, a tap opens Today. It runs after the day is saved and NEVER
 * THROWS: the move is already true, and a push that fails must not turn it into
 * an error the organizer sees (the `tee-time-notify` contract).
 *
 * Returns the organizer's line for the confirmation — how many entries a push
 * cannot reach — or "" when nothing was sent. No automatic announcement: the
 * app does not write words in the organizer's name.
 */
export async function notifyRoundMoved(opts: { eventId: string; stageId: string; before: string; after: string }): Promise<string> {
  try {
    const [event, stages] = await Promise.all([
      prisma.event.findUnique({ where: { id: opts.eventId }, select: { name: true, status: true } }),
      prisma.stage.findMany({ where: { eventId: opts.eventId }, select: { id: true, type: true }, orderBy: { position: "asc" } }),
    ]);
    if (!event) return "";
    const [fmt, terms] = await Promise.all([formattingForEvent(opts.eventId), golfTermsForEvent(opts.eventId)]);
    const words = roundMovedNotice({
      before: opts.before,
      after: opts.after,
      told: isLaunched(event.status),
      roundLabel: stages.length > 1 ? roundLabel(stages, opts.stageId) : "",
      eventName: event.name,
      locale: fmt.locale,
      organizer: terms.organizer,
    });
    if (!words) return "";
    const field = await prisma.player.findMany({
      where: { eventId: opts.eventId, status: "confirmed" },
      select: { id: true, email: true, standing: true },
    });
    await sendPushTo(
      field.flatMap((p) => whoKeysForEntry(p)),
      { title: words.title, body: words.body, url: "/me", tag: `moved-${opts.stageId}` },
      { eventId: opts.eventId },
    );
    return noticesOffWords(await noticesOffAmong(opts.eventId, field.map((p) => p.id)));
  } catch (e) {
    console.error(`[round-moved] Could not tell the field: ${e instanceof Error ? e.message : "unknown"}`);
    return "";
  }
}
