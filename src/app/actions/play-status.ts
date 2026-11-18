"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { archiveRefusalOf, assertEventWritable } from "@/lib/services/club-archive";
import { logAudit } from "@/lib/services/action-shared";
import { boardChanged } from "@/lib/services/board-refresh";
import { sendPushTo } from "@/lib/services/push";
import { whoKeysForEntry } from "@/lib/domain/messaging";
import { golfTermsForEvent } from "@/lib/services/organization";
import { cleanSuspendNote, playScreenOf, resumedWords, suspendedWords } from "@/lib/domain/play-status";
import { playStatusForScreen } from "@/lib/services/play-status-screen";

/**
 * SUSPEND AND RESUME PLAY for the whole tournament (Rule 5.7).
 *
 * Staff only: stopping a field is the committee's call. Deliberately NOT behind
 * the setup lock — a live tournament is exactly when this is needed. Every
 * confirmed player who turned notices on is pushed — a guest's link too, by its
 * who-key (J39/J40 PR 2) — and every player screen and the
 * public board carry the banner until play resumes.
 *
 * The push never decides anything: the suspension is already true in the
 * database when it is sent, and `sendPushTo` never throws.
 */
async function requireStaffEvent(): Promise<string> {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  if (session.role !== "admin" && session.role !== "assistant") {
    throw new Error("Only an organizer or assistant can do that");
  }
  await assertEventWritable(session.eventId);
  return session.eventId;
}

/** The staff gate for a press that says its refusals: an archive's comes back as words, never thrown. */
async function staffEventOrRefusal(): Promise<{ eventId: string } | { refused: string }> {
  try {
    return { eventId: await requireStaffEvent() };
  } catch (e) {
    const refused = archiveRefusalOf(e);
    if (refused) return { refused };
    throw e;
  }
}

async function tellTheField(
  eventId: string,
  words: { title: string; body: string },
  eventName: string,
  urgent: boolean,
) {
  const players = await prisma.player.findMany({
    where: { eventId, status: "confirmed" },
    select: { id: true, email: true, standing: true },
  });
  await sendPushTo(
    players.flatMap((p) => whoKeysForEntry(p)),
    // One tag for both, so "resumed" replaces "suspended" on a lock screen
    // rather than stacking under it.
    { title: words.title, body: `${words.body} · ${eventName}`, url: "/me", tag: `play-${eventId}`, urgent },
    // Both "stop now" and "play on" are about this minute: sent at high urgency
    // so a dozing phone wakes for them, and held by the push service for hours,
    // not weeks: through a dead spot, never into tomorrow (safety sweep G-5).
    { eventId, delivery: "play-status" },
  );
}

/**
 * Whether play is suspended in the round of the screen the alarm sits on
 * (`SuspensionAlarm`): the player app, or a round code's `/play`. Whoever that
 * screen is for may ask: it is the same fact the banner on it already shows,
 * and it is decided in one place (`playStatusForScreen`), from the caller's
 * own cookie. `screen` arrives from the client and can only choose which of
 * the caller's own two cookies is read; it never names an event.
 *
 * THE PLAYER APP IS ASKED OF THE PLAYER VIEWER, NEVER OF `getSession()`
 * (J39/J40 PR 2, G1; Rule 5.7, a safety notice). The layout draws the banner
 * from the viewer's event, so the poll must ask the same one: a guest's link
 * has no session at all, and asking `getSession()` read "not suspended" every
 * 20 seconds, so a guest whose screen was open when play stopped heard
 * nothing; a member viewing through a link for another club's outing was asked
 * about their own club's event. `playStatusForScreen` resolves "player"
 * through `getPlayerViewer`, so banner and siren cannot disagree. On
 * GUEST_ACTIONS.
 */
export async function currentPlayStatus(screen?: unknown): Promise<{ suspended: boolean; note: string }> {
  const { suspended, note } = await playStatusForScreen(playScreenOf(screen));
  return { suspended, note };
}

export async function suspendPlay(note: string): Promise<{ ok: boolean; error?: string }> {
  const gate = await staffEventOrRefusal();
  if ("refused" in gate) return { ok: false, error: gate.refused };
  const { eventId } = gate;
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { name: true, playSuspendedAt: true },
  });
  if (!event) return { ok: false, error: "Tournament not found." };
  const why = cleanSuspendNote(note);
  await prisma.event.update({
    where: { id: eventId },
    // Keep the first time it was suspended if it already is — a second press
    // only updates the reason.
    data: { playSuspendedAt: event.playSuspendedAt ?? new Date(), playSuspendedNote: why },
  });
  await logAudit(eventId, "play-suspended", why ? `Play suspended: ${why}` : "Play suspended");
  const { organizer } = await golfTermsForEvent(eventId);
  await tellTheField(eventId, suspendedWords(why, organizer), event.name, true);
  revalidatePath("/", "layout");
  boardChanged(eventId);
  return { ok: true };
}

export async function resumePlay(): Promise<{ ok: boolean; error?: string }> {
  const gate = await staffEventOrRefusal();
  if ("refused" in gate) return { ok: false, error: gate.refused };
  const { eventId } = gate;
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { name: true, playSuspendedAt: true },
  });
  if (!event) return { ok: false, error: "Tournament not found." };
  // Resuming play that was never suspended would buzz every phone for nothing.
  if (!event.playSuspendedAt) return { ok: true };
  await prisma.event.update({ where: { id: eventId }, data: { playSuspendedAt: null, playSuspendedNote: "" } });
  await logAudit(eventId, "play-resumed", "Play resumed");
  await tellTheField(eventId, resumedWords(), event.name, false);
  revalidatePath("/", "layout");
  boardChanged(eventId);
  return { ok: true };
}
