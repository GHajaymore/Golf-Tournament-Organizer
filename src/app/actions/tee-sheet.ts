"use server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { boardChanged } from "@/lib/services/board-refresh";
import { parseTeeSheet, validateTeeSheet, type TeeSheet } from "@/lib/domain/tee-sheet";

/**
 * Everything on this screen changed — and so did the public board.
 *
 * `revalidatePath` clears the router cache; it does NOT touch the per-event
 * board entry, which is an `unstable_cache` keyed and tagged separately.
 * Without this, a change here waits out the board's sixty-second backstop
 * before a spectator sees it.
 *
 * The event comes from the SESSION, because every action in this file
 * already operates on the caller's own tournament.
 */
async function refresh() {
  revalidatePath("/", "layout");
  const session = await getSession();
  if (session?.eventId) boardChanged(session.eventId);
}

/**
 * Saving and publishing the tee sheet.
 *
 * Staff only, both of them. A tee sheet decides who plays with whom and when
 * — it is the organizer's decision to make and the organizer's to announce,
 * and no player input reaches these actions at all.
 */

export interface TeeSheetResult {
  ok: boolean;
  error?: string;
}

async function requireStaffSession() {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  if (session.role !== "admin" && session.role !== "assistant") {
    throw new Error("Organizer access required");
  }
  return session;
}

/** A sheet has at most a field's worth of groups; anything bigger is not one. */
const MAX_SHEET_BYTES = 64 * 1024;

/**
 * Save the drawn sheet, optionally publishing it in the same act.
 *
 * Validated against the confirmed field before anything is stored: a player
 * drawn twice tees off in two places at once, and a name outside the field
 * is one nobody can find on the day. Refused whole rather than saved with
 * holes — half a tee sheet is a queue on the first tee.
 */
export async function saveTeeSheet(
  stageId: string,
  sheet: TeeSheet,
  publish: boolean,
): Promise<TeeSheetResult> {
  const session = await requireStaffSession();

  const stage = await prisma.stage.findFirst({
    where: { id: stageId, eventId: session.eventId },
    select: { id: true },
  });
  if (!stage) return { ok: false, error: "That round isn't in this tournament." };

  // Serialize through the parser so only the known shape is ever stored —
  // whatever arrived is arbitrary caller input, not the component's object.
  const clean = parseTeeSheet(JSON.stringify(sheet ?? {}));
  if (!clean) return { ok: false, error: "That isn't a tee sheet." };
  clean.savedAt = new Date().toISOString();

  const json = JSON.stringify(clean);
  if (json.length > MAX_SHEET_BYTES) return { ok: false, error: "That sheet is too large to be one round." };

  const confirmed = await prisma.player.findMany({
    where: { eventId: session.eventId, status: "confirmed" },
    select: { id: true },
  });
  const problems = validateTeeSheet(clean, new Set(confirmed.map((p) => p.id)));
  if (problems.length) return { ok: false, error: problems[0] };

  await prisma.stage.update({
    where: { id: stageId },
    data: { teeSheet: json, teeSheetPublished: publish },
  });
  await refresh();
  return { ok: true };
}

/** Show or hide the saved sheet from players — the announcement, undone-able. */
export async function setTeeSheetPublished(stageId: string, published: boolean): Promise<TeeSheetResult> {
  const session = await requireStaffSession();
  const stage = await prisma.stage.findFirst({
    where: { id: stageId, eventId: session.eventId },
    select: { teeSheet: true },
  });
  if (!stage) return { ok: false, error: "That round isn't in this tournament." };
  if (published && !stage.teeSheet) {
    return { ok: false, error: "Save a sheet before publishing it — there's nothing to show yet." };
  }
  await prisma.stage.updateMany({
    where: { id: stageId, eventId: session.eventId },
    data: { teeSheetPublished: published },
  });
  await refresh();
  return { ok: true };
}
