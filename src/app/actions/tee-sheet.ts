"use server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { boardChanged } from "@/lib/services/board-refresh";
import { parseTeeSheet, validateTeeSheet, type TeeSheet } from "@/lib/domain/tee-sheet";
import { roundLabel } from "@/lib/domain/round-label";
import { notifyTeeTimesPublished } from "@/lib/services/tee-time-notify";

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
    // The old sheet and its published flag are the baseline for the change
    // diff — read before the update overwrites them.
    select: { id: true, teeSheet: true, teeSheetPublished: true },
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

  /**
   * Publishing is the confirm, so it is the only act that notifies. A draft
   * save changes nothing a player can see and pings nobody. The diff baseline
   * is the sheet as it stood BEFORE this write; a first publish (the stage was
   * not published) tells everyone drawn, a re-publish only whom it moved.
   */
  if (publish) {
    const [event, stages] = await Promise.all([
      prisma.event.findUnique({ where: { id: session.eventId }, select: { name: true } }),
      prisma.stage.findMany({
        where: { eventId: session.eventId },
        select: { id: true, type: true },
        orderBy: { position: "asc" },
      }),
    ]);
    await notifyTeeTimesPublished({
      eventId: session.eventId,
      stageId,
      previous: parseTeeSheet(stage.teeSheet ?? ""),
      next: clean,
      firstPublish: !stage.teeSheetPublished,
      roundLabel: roundLabel(stages, stageId),
      eventName: event?.name ?? "",
    });
  }

  await refresh();
  return { ok: true };
}

/** Show or hide the saved sheet from players — the announcement, undone-able. */
export async function setTeeSheetPublished(stageId: string, published: boolean): Promise<TeeSheetResult> {
  const session = await requireStaffSession();
  const stage = await prisma.stage.findFirst({
    where: { id: stageId, eventId: session.eventId },
    select: { teeSheet: true, teeSheetPublished: true },
  });
  if (!stage) return { ok: false, error: "That round isn't in this tournament." };
  if (published && !stage.teeSheet) {
    return { ok: false, error: "Save a sheet before publishing it — there's nothing to show yet." };
  }
  await prisma.stage.updateMany({
    where: { id: stageId, eventId: session.eventId },
    data: { teeSheetPublished: published },
  });

  // Publishing an already-drawn sheet from behind the toggle is a first
  // announcement too — tell everyone drawn. Only on the false->true edge, so
  // re-affirming a published sheet pings nobody, and unpublishing never does.
  if (published && !stage.teeSheetPublished) {
    const sheet = parseTeeSheet(stage.teeSheet ?? "");
    if (sheet) {
      const [event, stages] = await Promise.all([
        prisma.event.findUnique({ where: { id: session.eventId }, select: { name: true } }),
        prisma.stage.findMany({
          where: { eventId: session.eventId },
          select: { id: true, type: true },
          orderBy: { position: "asc" },
        }),
      ]);
      await notifyTeeTimesPublished({
        eventId: session.eventId,
        stageId,
        previous: null,
        next: sheet,
        firstPublish: true,
        roundLabel: roundLabel(stages, stageId),
        eventName: event?.name ?? "",
      });
    }
  }

  await refresh();
  return { ok: true };
}
