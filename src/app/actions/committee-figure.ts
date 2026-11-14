"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { assertEventWritable } from "@/lib/services/club-archive";
import { logAudit } from "@/lib/services/action-shared";
import { boardChanged } from "@/lib/services/board-refresh";
import { roundHasReturnedCard } from "@/lib/services/round-handicap";
import { isFinished } from "@/lib/domain/lifecycle-state";
import { roundLabel } from "@/lib/domain/round-label";
import {
  BAND_MAX,
  BAND_MIN,
  BAND_REFUSAL,
  CORRECTION_NEEDS_REASON,
  CORRECTION_REASON_MAX,
  correctionAuditLine,
  mayCorrectStrokes,
} from "@/lib/domain/committee-figure";

/**
 * CORRECT THE STROKES OF A PLAYER WITH NO HANDICAP INDEX, ONCE A CARD IS IN (lane N; the panel's §12.2,
 * asked for in PR A by the review of #1144).
 *
 * Until PR B, a round's first card freezes every confirmed player's figure — for a player with no index,
 * the conversion of a stored index 0, a scratch golfer — and `setRoundHandicapOverride` then refuses for
 * everybody ("Clear the round's scores to score it again"). That leaves the one figure the Rules make the
 * Committee's own arithmetic (Rules of Golf 3.3b(4)) fixed at a number nobody chose, and the only way out
 * was to clear the whole round.
 *
 * So this is a committee correction for exactly that player and nobody else:
 *
 *   WHO MAY      staff of the tournament (organizer or assistant organizer), as Give.
 *   WHOM         a confirmed player with no index, in a round scored net (`mayCorrectStrokes`, beside the
 *                rule), in a round that has a card in — before that, Give is the way (`setRoundHandicapOverride`).
 *   WHAT         whole strokes, 0 to 54 (the band's range), refused otherwise: no rounding at this door.
 *   WHY          a reason is required, and kept: the audit line names the old figure, the new one, who and why.
 *   HOW          that one row's `override` and `frozen` in one statement (`frozenExact` null, the mark for a
 *                committee's own figure). Nobody else's row is touched. Net is derived on read, so every
 *                board, countback and point follows from the next read.
 *   NOT          once results are released: reopen the tournament first, so a prize list never moves silently.
 */

export interface CorrectStrokesResult {
  ok: boolean;
  error?: string;
}

async function requireStaffEvent(): Promise<string> {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  if (session.role !== "admin" && session.role !== "assistant") {
    throw new Error("Organizer access required");
  }
  await assertEventWritable(session.eventId);
  return session.eventId;
}

export async function correctRoundStrokes(stageId: unknown, playerId: unknown, strokes: unknown, reason: unknown): Promise<CorrectStrokesResult> {
  const eventId = await requireStaffEvent();
  if (typeof stageId !== "string" || typeof playerId !== "string" || !stageId || !playerId) {
    return { ok: false, error: "Choose the round and the player." };
  }
  // Whole strokes only, and a number: "12" or 12.4 is refused, never read or rounded.
  if (typeof strokes !== "number" || !Number.isInteger(strokes) || strokes < BAND_MIN || strokes > BAND_MAX) {
    return { ok: false, error: BAND_REFUSAL };
  }
  const why = typeof reason === "string" ? reason.trim() : "";
  if (!why) return { ok: false, error: CORRECTION_NEEDS_REASON };
  if (why.length > CORRECTION_REASON_MAX) return { ok: false, error: `Keep the reason under ${CORRECTION_REASON_MAX} characters.` };

  // Both ids against THIS tournament: the pair is caller-supplied and half a unique key.
  const [event, stages, player] = await Promise.all([
    prisma.event.findUnique({ where: { id: eventId }, select: { status: true } }),
    prisma.stage.findMany({ where: { eventId }, select: { id: true, type: true, position: true, scoringBasis: true } }),
    prisma.player.findFirst({ where: { id: playerId, eventId, status: "confirmed" }, select: { name: true, handicapSource: true } }),
  ]);
  const stage = stages.find((s) => s.id === stageId);
  if (!stage) return { ok: false, error: "That round isn't in this tournament." };
  if (!player) return { ok: false, error: "That player isn't in the field." };
  if (!event || isFinished(event.status)) {
    return { ok: false, error: "Results are released. Reopen the tournament to correct a round's strokes." };
  }
  if (!mayCorrectStrokes(stage, player)) {
    return { ok: false, error: `${player.name} has a handicap index, or this round is scored gross: nothing to correct here.` };
  }
  if (!(await roundHasReturnedCard(eventId, stageId))) {
    return { ok: false, error: "No card is in for this round yet. Give the strokes at the top of Rounds & formats." };
  }

  const before = await prisma.roundHandicap.findUnique({ where: { stageId_playerId: { stageId, playerId } }, select: { frozen: true } });
  const frozenAt = new Date();
  await prisma.roundHandicap.upsert({
    where: { stageId_playerId: { stageId, playerId } },
    update: { override: strokes, frozen: strokes, frozenExact: null, frozenAt },
    create: { eventId, stageId, playerId, override: strokes, frozen: strokes, frozenExact: null, frozenAt },
  });
  await logAudit(
    eventId,
    "strokes-corrected",
    correctionAuditLine({ name: player.name, round: roundLabel(stages, stageId) || "a round", from: before?.frozen ?? null, to: strokes, reason: why }),
  );
  revalidatePath("/", "layout");
  boardChanged(eventId);
  return { ok: true };
}
