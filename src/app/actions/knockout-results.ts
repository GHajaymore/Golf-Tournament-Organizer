"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { assertEventWritable, archiveRefusalOf } from "@/lib/services/club-archive";
import { logAudit } from "@/lib/services/action-shared";
import { boardChanged } from "@/lib/services/board-refresh";
import { loadEventState } from "@/lib/services/tournament";
import { clearTieResult } from "@/lib/services/knockout-result";
import { bracketDraws, tieByKey, marginWords } from "@/lib/domain/my-tie";
import { resultLine, tieStillHolds } from "@/lib/domain/knockout-play-by";
import { laterTieRefusal } from "@/lib/domain/knockout-ties";

/** Organizer or Assistant Organizer, of a tournament that may still be written. */
async function requireStaffEvent(): Promise<string> {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  if (session.role !== "admin" && session.role !== "assistant") {
    throw new Error("Only an organizer or assistant can do that");
  }
  await assertEventWritable(session.eventId);
  return session.eventId;
}

/**
 * UNDO, AND CHANGE RESULT, ON A KNOCKOUT TIE (simplicity review, cut 3, 2026-11-14).
 *
 * Takes a recorded result off a tie, so the tie is waiting on a result again and
 * its winner leaves the tie it went on to. "Change result" on Score entry is this
 * and then the tie's two name buttons, which record through `recordTieResult`, the
 * one write of a knockout result from a list: there is no second write path.
 *
 * Like `recordTieResult` it is sent the tie's key AND its two players, so it
 * takes back the result of the tie the secretary was looking at, or nothing.
 * Refused, in words for the place the press was, when the winner has already
 * played on (`laterTieRefusal`, the same rule the bracket's tap asks): the later
 * result is named, and taking that back first is the way out.
 *
 * Staff only. Every Undo is on the record: who (the audit line's actor), when
 * (its time) and what (the round, both players, the result taken back).
 */
export async function undoTieResult(input: { key: string; players: string[] }): Promise<{ ok: boolean; error?: string; said?: string }> {
  let eventId: string;
  try {
    eventId = await requireStaffEvent();
  } catch (e) {
    const archived = archiveRefusalOf(e);
    if (archived) return { ok: false, error: archived };
    throw e;
  }
  const { key, players } = input ?? ({} as typeof input);
  if (typeof key !== "string" || !Array.isArray(players) || players.length !== 2) {
    return { ok: false, error: "Choose the tie to take back." };
  }
  const state = await loadEventState(eventId);
  if (!state) return { ok: false, error: "That tournament isn't available." };
  const draws = bracketDraws(state.brackets);
  const tie = tieByKey(draws, key);
  const m = tie?.match;
  if (!tie || !m) return { ok: false, error: "That tie isn't in the draw any more. Reload to see the draw as it is." };
  if (!tieStillHolds(m, players)) {
    return { ok: false, error: "The draw has changed: that place now holds a different tie. Reload to see the draw as it is." };
  }
  if (!m.winnerId) return { ok: false, error: "That tie has no result to take back." };
  const later = laterTieRefusal(draws, key, { plate: state.event.bracketMode === "plate" });
  if (later) return { ok: false, error: later };

  const stored = (await prisma.bracketWinner.findFirst({ where: { eventId, key }, select: { result: true } }))?.result ?? "";
  const round = tie.draw ? `${tie.draw} · ${tie.round}` : tie.round;
  const was = `${resultLine(round, m)}${marginWords(stored)}`;
  if (!(await clearTieResult(eventId, key))) return { ok: false, error: "That tie has no result to take back." };
  await logAudit(eventId, "knockout.undo", `${was}: taken back on Score entry`);
  revalidatePath("/", "layout");
  boardChanged(eventId);
  return { ok: true, said: was };
}
