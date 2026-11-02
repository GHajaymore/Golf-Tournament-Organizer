"use server";
import { headers } from "next/headers";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { printKit, savePrintLog, stampWords } from "@/lib/services/print-kit";
import { cardsByFrom, parsePrintLog, signsByFrom, withPrinted } from "@/lib/domain/print-kit";
import { formattingForEvent } from "@/lib/services/organization";
import { requestOrigin } from "@/lib/request-origin";
import { archiveRefusalFor } from "@/lib/services/club-archive";

export type RecordPrintedResult =
  | { ok: true; stamps: Record<string, { words: string; version: number }> }
  | { ok: false; error: string };

async function requireStaffSession() {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  if (session.role !== "admin" && session.role !== "assistant") {
    throw new Error("Organizer access required");
  }
  return session;
}

/** A round's whole kit is a few hundred sheets; more than this is not one press of Print. */
const MAX_SHEETS = 1500;

/**
 * WHAT WENT TO THE PRINTER (decision D), recorded at the press of Print, so
 * the hub and the Tee sheet can later say which printed sheets have stopped
 * being true and print just those.
 *
 * Staff only: the Print kit is a staff screen and this writes the round. The
 * sheets are named by key and the fingerprints the page was drawn with; the
 * kit is rebuilt HERE and each fingerprint checked against it, so the log
 * records what the round says now — and a page opened before somebody moved a
 * group is told to reload rather than stamped as current.
 */
export async function recordPrinted(
  stageId: string,
  sheets: Array<{ key: string; fp: string }>,
  /** How the hub laid the cards and signs out, so the kit rebuilt here has the same sheets. Untrusted: read through the same parsers as the address. */
  by?: { cards?: unknown; signs?: unknown },
): Promise<RecordPrintedResult> {
  const session = await requireStaffSession();
  // A lapsed club's tournament is a read-only archive: nothing is written to it, not even what was printed.
  const archived = await archiveRefusalFor(session.eventId, "organizer");
  if (archived) return { ok: false, error: archived };
  if (typeof stageId !== "string" || !Array.isArray(sheets) || sheets.length === 0 || sheets.length > MAX_SHEETS) {
    return { ok: false, error: "Nothing to print." };
  }
  const stage = await prisma.stage.findFirst({
    where: { id: stageId, eventId: session.eventId },
    select: { id: true, printLog: true },
  });
  if (!stage) return { ok: false, error: "That round isn't in this tournament." };

  const kit = await printKit(session.eventId, {
    stageId,
    origin: requestOrigin(await headers()),
    cardsBy: cardsByFrom(typeof by?.cards === "string" ? by.cards : ""),
    signsBy: signsByFrom(typeof by?.signs === "string" ? by.signs : ""),
  });
  if (kit.round?.id !== stageId) return { ok: false, error: "That round isn't in this tournament." };
  const current = new Map(kit.sheets.map((s) => [s.key, s]));
  const asked = sheets.filter((s) => s && typeof s.key === "string" && typeof s.fp === "string");
  const unknown = asked.filter((s) => !current.has(s.key));
  const changed = asked.filter((s) => current.has(s.key) && current.get(s.key)!.fp !== s.fp);
  if (unknown.length > 0 || changed.length > 0) {
    return {
      ok: false,
      error: "Something on these sheets has changed since this page was opened — reload it and print again, so the paper is what the round says now.",
    };
  }

  const now = new Date();
  const printed = asked.map((s) => current.get(s.key)!);
  const log = withPrinted(parsePrintLog(stage.printLog), printed, now);
  await savePrintLog(session.eventId, stageId, log);

  const { locale } = await formattingForEvent(session.eventId);
  const event = await prisma.event.findUnique({
    where: { id: session.eventId },
    select: { organization: { select: { timeZone: true } } },
  });
  const words = stampWords(now, locale, event?.organization?.timeZone ?? "");
  const stamps: Record<string, { words: string; version: number }> = {};
  for (const s of printed) stamps[s.key] = { words, version: log.sheets[s.key].version };
  revalidatePath("/print");
  revalidatePath("/foursomes");
  return { ok: true, stamps };
}
