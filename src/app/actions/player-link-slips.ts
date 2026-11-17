"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { assertEventWritable } from "@/lib/services/club-archive";
import { checkRateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/services/action-shared";
import { newLinksFor, printSlips, slipStateFor } from "@/lib/services/player-link-slips";
import { SLIP_WORDS } from "@/lib/domain/player-link-slips";

/**
 * PLAYER LINK SLIPS, PRESSED (J39/J40 PR 3; design §3.1, A10 to A12). Staff of
 * the tournament only, refused in a lapsed club's archive (showing or making a
 * link is; turning one off is not, and that stays on the panel).
 *
 * THE CODES LEAVE THE SERVER ONLY AS THE ANSWER TO A PRESS (S7): the Print kit
 * renders a count and a button, never a code; the slips are drawn in the browser
 * from this answer and dropped after printing. Every press is on the record by
 * who and how many, never with a code, and a bulk print is budgeted (`link-slips`).
 *
 * In its own file, beside the link's panel actions (`actions/player-link.ts`):
 * the slips add no new kind of code and change nothing the panel does.
 */

async function requireStaffSession() {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  if (session.role !== "admin" && session.role !== "assistant") throw new Error("Organizer access required");
  await assertEventWritable(session.eventId);
  return session;
}

const asId = (v: unknown): string => (typeof v === "string" && v.length > 0 && v.length <= 64 ? v : "");
/** A lost sheet is one event's guests: never more than a field holds. */
const MOST_AT_ONCE = 200;

export type SlipsResult =
  | { ok: true; eventName: string; slips: Array<{ name: string; code: string }>; skipped: string }
  | { ok: false; error: string };

/** PRINT: every confirmed guest's slip, or with `onlyNew` the ones not yet printed for the link as it is now. */
export async function printPlayerLinkSlips(onlyNew: unknown): Promise<SlipsResult> {
  const session = await requireStaffSession();
  const budget = await checkRateLimit("link-slips", `${session.userId}:${session.eventId}`);
  if (!budget.allowed) return { ok: false, error: budget.message };
  const printed = await printSlips(session.eventId, session.name, onlyNew === true);
  if (printed.slips.length > 0) {
    await logAudit(session.eventId, "player-link.slips", `Player link slips printed by ${session.name} (${printed.slips.length})`);
  }
  revalidatePath("/print");
  return {
    ok: true,
    eventName: printed.eventName,
    slips: printed.slips,
    skipped: SLIP_WORDS.skipped(printed.turnedOff, printed.expired),
  };
}

/**
 * A LOST SHEET: a new link for each guest named, in one press (the screen confirms
 * first). Each id is resolved inside the session's event as a guest entry, so a
 * member's or another event's id makes nothing. Every old slip and every phone
 * holding an old link stop at once (the version goes up).
 */
export async function newPlayerLinksFor(playerIds: unknown): Promise<{ ok: true; made: number } | { ok: false; error: string }> {
  const session = await requireStaffSession();
  if (!Array.isArray(playerIds) || playerIds.length === 0 || playerIds.length > MOST_AT_ONCE) {
    return { ok: false, error: "Choose the guests whose links to replace." };
  }
  const ids = [...new Set(playerIds.map(asId).filter(Boolean))];
  const made = await newLinksFor(session.eventId, ids, session.name);
  if (made > 0) await logAudit(session.eventId, "player-link.new-for-all", `${made} player links replaced with new ones by ${session.name}`);
  revalidatePath("/print");
  return { ok: true, made };
}

export type SlipStateResult = { ok: true; line: string; outOfDate: boolean } | { ok: false };

/** The panel's slip line for one guest: printed when, or out of date after New link (A12). Never a code. */
export async function playerLinkSlipState(playerId: unknown): Promise<SlipStateResult> {
  const session = await requireStaffSession();
  const state = await slipStateFor(session.eventId, asId(playerId));
  if (!state || !state.printed) return { ok: false };
  return { ok: true, outOfDate: state.outOfDate, line: state.outOfDate ? SLIP_WORDS.panelOutOfDate : SLIP_WORDS.panelPrinted(state.printedDay) };
}
