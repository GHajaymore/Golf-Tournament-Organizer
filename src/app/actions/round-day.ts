"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { logAudit } from "@/lib/services/action-shared";
import { boardChanged } from "@/lib/services/board-refresh";
import { roundLabel } from "@/lib/domain/round-label";
import { holesPlayed } from "@/lib/domain/handicap";
import { hasPins, readPinSheet } from "@/lib/domain/pin-sheet";
import { hoursAndMinutes } from "@/lib/domain/pace";

/**
 * ROUND-DAY SET-UP: the pin sheet and the time allowed.
 *
 * Staff only, and deliberately NOT behind the setup lock — the holes are cut on
 * the morning of the round, which is long after a tournament has launched.
 * Both are public HTTP endpoints like every "use server" export, so the payload
 * is read through `readPinSheet` rather than trusted.
 */

export interface RoundDayResult {
  ok: boolean;
  error?: string;
}

/**
 * Every screen, and the cached public board. Neither write changes a standing,
 * but both change a ROUND row, and the board's cache is keyed on the event —
 * retiring it costs one rebuild and means nothing shown there is ever older
 * than the round it describes.
 */
function refresh(eventId: string) {
  revalidatePath("/", "layout");
  boardChanged(eventId);
}

async function requireStaffEvent(): Promise<string> {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  if (session.role !== "admin" && session.role !== "assistant") {
    throw new Error("Only an organizer or assistant can do that");
  }
  return session.eventId;
}

/** Save (or clear, with an all-empty sheet) where the holes are cut for a round. */
export async function setPinSheet(stageId: string, raw: unknown): Promise<RoundDayResult> {
  const eventId = await requireStaffEvent();
  const stage = await prisma.stage.findFirst({
    where: { id: stageId, eventId },
    select: { id: true, holes: true },
  });
  if (!stage) return { ok: false, error: "That round isn't in this tournament." };
  const { sheet, error } = readPinSheet(raw, holesPlayed(stage.holes));
  if (error) return { ok: false, error };
  const stored = hasPins(sheet) ? JSON.stringify(sheet) : "";
  await prisma.stage.update({ where: { id: stage.id }, data: { pinSheet: stored } });
  const stages = await prisma.stage.findMany({ where: { eventId }, select: { id: true, type: true, position: true } });
  const label = roundLabel(stages, stage.id);
  await logAudit(
    eventId,
    "pin-sheet",
    stored ? `Pin sheet set for ${label} (${sheet.filter(Boolean).length} holes)` : `Pin sheet cleared for ${label}`,
  );
  refresh(eventId);
  return { ok: true };
}

/**
 * The time allowed for a round, in minutes for eighteen holes as a four-ball.
 * Zero puts it back to the club default. Anything outside a plausible day's
 * golf is refused rather than stored: 2h 30 is a very quick four-ball and six
 * hours is a round nobody would set as a target.
 */
export async function setPaceMinutes(stageId: string, minutes: number): Promise<RoundDayResult> {
  const eventId = await requireStaffEvent();
  if (!Number.isInteger(minutes) || (minutes !== 0 && (minutes < 150 || minutes > 360))) {
    return { ok: false, error: "Set a time between 2h 30m and 6h 00m, or leave it on the club default." };
  }
  const updated = await prisma.stage.updateMany({
    where: { id: stageId, eventId },
    data: { paceMinutes: minutes },
  });
  if (updated.count === 0) return { ok: false, error: "That round isn't in this tournament." };
  const stages = await prisma.stage.findMany({ where: { eventId }, select: { id: true, type: true, position: true } });
  await logAudit(
    eventId,
    "pace-set",
    `Time allowed for ${roundLabel(stages, stageId)}: ${minutes ? hoursAndMinutes(minutes) : "club default"}`,
  );
  refresh(eventId);
  return { ok: true };
}
