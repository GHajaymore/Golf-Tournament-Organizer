"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { logAudit } from "@/lib/services/action-shared";
import { boardChanged } from "@/lib/services/board-refresh";

/**
 * DISQUALIFICATION — the committee's ruling (2026-10-08).
 *
 * In stroke play a disqualified player has no score for the competition (Rule
 * 3.3b(3), and the many breaches whose penalty is DQ). The app had only
 * "withdrawn", so a committee could not record the ruling at all, and the only
 * way to take somebody off the board was to say they had gone home.
 *
 * A DQ'd player leaves the field exactly as a withdrawal does — every field
 * reader is built from `status === "confirmed"` — and appears at the foot of
 * the sheet as DQ, beneath any WD, with no place. Their returned cards are
 * kept: the record stays, the result does not.
 *
 * Staff only, and deliberately NOT behind the setup lock: a ruling is made
 * while the tournament is live, which is exactly when the lock is on. A reason
 * is required and goes into the audit line, because "why was I disqualified?"
 * is the first question and the committee must be able to answer it.
 * Reinstating undoes a ruling made in error.
 */
async function requireStaffEvent(): Promise<string> {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  if (session.role !== "admin" && session.role !== "assistant") {
    throw new Error("Only an organizer or assistant can do that");
  }
  return session.eventId;
}

const REASON_MAX = 200;

export async function disqualifyPlayer(
  playerId: string,
  reason: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const eventId = await requireStaffEvent();
  const why = typeof reason === "string" ? reason.trim().slice(0, REASON_MAX) : "";
  if (!why) return { ok: false, error: "Give the reason — it goes on the record." };
  // Looked up WITHIN this tournament, so an id from another one finds nothing.
  const player = await prisma.player.findFirst({ where: { id: String(playerId), eventId } });
  if (!player) return { ok: false, error: "That player isn't in this tournament." };
  if (player.status !== "confirmed") return { ok: false, error: `${player.name} isn't in the field.` };

  await prisma.player.update({ where: { id: player.id }, data: { status: "disqualified" } });
  await logAudit(eventId, "disqualified", `${player.name} was disqualified: ${why}`);
  boardChanged(eventId);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function reinstatePlayer(playerId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const eventId = await requireStaffEvent();
  const player = await prisma.player.findFirst({ where: { id: String(playerId), eventId } });
  if (!player) return { ok: false, error: "That player isn't in this tournament." };
  if (player.status !== "disqualified") return { ok: false, error: `${player.name} isn't disqualified.` };

  await prisma.player.update({ where: { id: player.id }, data: { status: "confirmed" } });
  await logAudit(eventId, "reinstated", `${player.name} was reinstated — the disqualification was withdrawn.`);
  boardChanged(eventId);
  revalidatePath("/", "layout");
  return { ok: true };
}
