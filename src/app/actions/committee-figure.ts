"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { assertEventWritable } from "@/lib/services/club-archive";
import { logAudit } from "@/lib/services/action-shared";
import { boardChanged } from "@/lib/services/board-refresh";
import { roundHandicapsFor, roundHasReturnedCard } from "@/lib/services/round-handicap";
import { sideNamesOf } from "@/lib/services/side-names";
import { isFinished } from "@/lib/domain/lifecycle-state";
import { roundLabel } from "@/lib/domain/round-label";
import {
  BAND_MAX,
  BAND_MIN,
  BAND_REFUSAL,
  CORRECTION_NEEDS_REASON,
  CORRECTION_REASON_MAX,
  correctionAuditLine,
  correctionClosedSaid,
  correctionMatchSaid,
  matchResultStored,
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
 *                The strokes for a higher par (6.2b) are kept on the row, so the one rule prices it.
 *   NOT          once results are released (reopen the tournament first, so a prize list never moves
 *                silently); on a closed round (its results stand); nor while the player has a stored match
 *                result in the round, which keeps the strokes it was derived with until PR B re-derives it.
 *   CONFIRMED    the band shows who, from what and to what, and what is worked out again, before the press.
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
    prisma.stage.findMany({ where: { eventId }, select: { id: true, type: true, position: true, scoringBasis: true, closedAt: true } }),
    prisma.player.findFirst({
      where: { id: playerId, eventId, status: "confirmed" },
      select: { name: true, handicapSource: true, teamMemberships: { select: { teamId: true } } },
    }),
  ]);
  const stage = stages.find((s) => s.id === stageId);
  if (!stage) return { ok: false, error: "That round isn't in this tournament." };
  if (!player) return { ok: false, error: "That player isn't in the field." };
  const label = roundLabel(stages, stageId) || "This round";
  if (!event || isFinished(event.status)) {
    return { ok: false, error: "Results are released. Reopen the tournament to correct a round's strokes." };
  }
  // A CLOSED ROUND'S RESULTS STAND (re-review R2): a cut or a draw may already have been made from them.
  if (stage.closedAt != null) return { ok: false, error: correctionClosedSaid(label) };
  if (!mayCorrectStrokes(stage, player)) {
    return { ok: false, error: `${player.name} has a handicap index, or this round is scored gross: nothing to correct here.` };
  }
  if (!(await roundHasReturnedCard(eventId, stageId))) {
    return { ok: false, error: "No card is in for this round yet. Give the strokes at the top of Rounds & formats." };
  }
  /**
   * A STORED MATCH RESULT IS NOT RE-DERIVED HERE (re-review R1). A stroke card's net is worked out on read,
   * so it follows the corrected figure; a match result derived from cards is stored, with the strokes it
   * was worked out with. Re-deriving it belongs to PR B's sink, so until then the correction is refused
   * for a player — or a side they play on — with a result stored in this round, and the way on is named.
   */
  const sides = player.teamMemberships.map((m) => m.teamId);
  const matches = await prisma.match.findMany({
    where: {
      eventId,
      stageId,
      OR: [{ playerAId: playerId }, { playerBId: playerId }, ...(sides.length ? [{ teamAId: { in: sides } }, { teamBId: { in: sides } }] : [])],
    },
    select: { playerAId: true, playerBId: true, teamAId: true, teamBId: true, holes: true, forfeitedBy: true },
  });
  const played = matches.find((m) => matchResultStored(m));
  if (played) {
    const onA = played.playerAId === playerId || sides.includes(played.teamAId);
    const otherTeam = onA ? played.teamBId : played.teamAId;
    const otherPlayer = onA ? played.playerBId : played.playerAId;
    const opponent = otherTeam
      ? (await sideNamesOf(eventId, [otherTeam])).get(otherTeam)
      : (await prisma.player.findFirst({ where: { id: otherPlayer, eventId }, select: { name: true } }))?.name;
    return { ok: false, error: correctionMatchSaid(player.name, label, opponent ?? "") };
  }

  const before = await prisma.roundHandicap.findUnique({ where: { stageId_playerId: { stageId, playerId } }, select: { frozen: true, frozenParStrokes: true } });
  /**
   * THE STROKES FOR TEES OF A HIGHER PAR (Rule 6.2b; re-review R3). A row the freeze wrote carries the
   * field's figure; a late entrant has no row, and a frozen row with none reads nought for ever. So the
   * figure is taken from the round's own list (`roundHandicapsFor`, the path the board prices with) when
   * the row lacks it, and the round is then priced by the one rule (`roundPlayingHandicap`, via
   * `playingHandicapPartsInRound`) like every other frozen row.
   */
  const parStrokes =
    before?.frozenParStrokes ?? (await roundHandicapsFor(eventId, stageId)).find((v) => v.playerId === playerId)?.parStrokes ?? 0;
  const frozenAt = new Date();
  await prisma.roundHandicap.upsert({
    where: { stageId_playerId: { stageId, playerId } },
    update: { override: strokes, frozen: strokes, frozenExact: null, frozenParStrokes: parStrokes, frozenAt },
    create: { eventId, stageId, playerId, override: strokes, frozen: strokes, frozenExact: null, frozenParStrokes: parStrokes, frozenAt },
  });
  await logAudit(
    eventId,
    "strokes-corrected",
    correctionAuditLine({ name: player.name, round: label, from: before?.frozen ?? null, to: strokes, reason: why }),
  );
  revalidatePath("/", "layout");
  boardChanged(eventId);
  return { ok: true };
}
