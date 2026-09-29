"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { logAudit } from "@/lib/services/action-shared";
import { boardChanged } from "@/lib/services/board-refresh";
import { sendPushToEmails } from "@/lib/services/push";
import { golfTermsForEvent } from "@/lib/services/organization";
import { cleanSuspendNote, resumedWords, suspendedWords } from "@/lib/domain/play-status";

/**
 * SUSPEND AND RESUME PLAY for the whole tournament (Rule 5.7).
 *
 * Staff only: stopping a field is the committee's call. Deliberately NOT behind
 * the setup lock — a live tournament is exactly when this is needed. Every
 * confirmed player with an address is pushed, and every player screen and the
 * public board carry the banner until play resumes.
 *
 * The push never decides anything: the suspension is already true in the
 * database when it is sent, and `sendPushToEmails` never throws.
 */
async function requireStaffEvent(): Promise<string> {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  if (session.role !== "admin" && session.role !== "assistant") {
    throw new Error("Only an organizer or assistant can do that");
  }
  return session.eventId;
}

async function tellTheField(
  eventId: string,
  words: { title: string; body: string },
  eventName: string,
  urgent: boolean,
) {
  const players = await prisma.player.findMany({
    where: { eventId, status: "confirmed" },
    select: { email: true },
  });
  await sendPushToEmails(
    players.map((p) => p.email ?? ""),
    // One tag for both, so "resumed" replaces "suspended" on a lock screen
    // rather than stacking under it.
    { title: words.title, body: `${words.body} · ${eventName}`, url: "/me", tag: `play-${eventId}`, urgent },
  );
}

/**
 * Whether play is suspended in the caller's tournament, for the alarm on an
 * open player screen (`SuspensionAlarm`). Any signed-in member may ask: it is
 * the same fact the banner on their screen already shows.
 */
export async function currentPlayStatus(): Promise<{ suspended: boolean; note: string }> {
  const session = await getSession();
  if (!session?.eventId) return { suspended: false, note: "" };
  const event = await prisma.event.findUnique({
    where: { id: session.eventId },
    select: { playSuspendedAt: true, playSuspendedNote: true },
  });
  return { suspended: !!event?.playSuspendedAt, note: event?.playSuspendedNote ?? "" };
}

export async function suspendPlay(note: string): Promise<{ ok: boolean; error?: string }> {
  const eventId = await requireStaffEvent();
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
  const eventId = await requireStaffEvent();
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
