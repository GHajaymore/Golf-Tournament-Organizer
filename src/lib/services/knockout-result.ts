import "server-only";
import { prisma } from "@/lib/db";
import { parseFlightPlan } from "@/lib/domain/bracket-flights";
import { bracketDraws } from "@/lib/domain/my-tie";
import { laterTieRefusal, thirdPlaceFrom } from "@/lib/domain/knockout-ties";
import type { loadEventState } from "./tournament";

type EventState = NonNullable<Awaited<ReturnType<typeof loadEventState>>>;

/**
 * WHY THIS TIE'S RESULT IS HELD, asked of the tournament as it stands, or null.
 * `laterTieRefusal` given every fact it needs, read ONE way for every door that
 * changes or takes back a knockout result: the bracket's tap (`setBracketWinner`)
 * and Undo / Change result (`undoTieResult`). The draw's later ties, a plate drawn
 * from the first round's losers, and the play-off for third (a stored match).
 */
export function resultHeldBecause(state: EventState, key: string): string | null {
  return laterTieRefusal(bracketDraws(state.brackets), key, {
    plate: state.event.bracketMode === "plate",
    thirdPlace: thirdPlaceFrom(state.matches),
  });
}

/**
 * TAKE A KNOCKOUT RESULT BACK — the one delete of a `BracketWinner`, shared by
 * the bracket's tap (`setBracketWinner`, tapping the winner again) and Undo /
 * Change result on Score entry (`undoTieResult`). Not a server action: it
 * trusts its caller to have asked who may, and `laterTieRefusal` whether it may.
 *
 * Answers whether there was a result to take back.
 */
export async function clearTieResult(eventId: string, key: string): Promise<boolean> {
  const gone = await prisma.bracketWinner.deleteMany({ where: { eventId, key } });
  if (gone.count === 0) return false;
  /**
   * Clearing the last result re-opens the draw.
   *
   * Without this a frozen draw would be a one-way door: an organizer who
   * recorded a result by mistake, undid it, and then fixed the qualifying
   * scores would be stuck with a bracket seeded from the wrong standings and
   * no way in the UI to say so. A bracket with no results has not started,
   * so there is no draw to protect.
   */
  const remaining = await prisma.bracketWinner.count({ where: { eventId } });
  if (remaining === 0) {
    // A FLAT draw is what the first result wrote down, and is what this
    // re-opens. A division into flights was made by the organizer before any
    // result and is not a by-product of one: clearing the last result leaves
    // it exactly as they arranged it.
    const kept = await prisma.event.findUnique({ where: { id: eventId }, select: { bracketDraw: true } });
    if (!parseFlightPlan(kept?.bracketDraw)) {
      await prisma.event.update({ where: { id: eventId }, data: { bracketDraw: "" } });
    }
  }
  return true;
}
