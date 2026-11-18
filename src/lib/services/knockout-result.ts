import "server-only";
import { prisma } from "@/lib/db";
import { parseFlightPlan } from "@/lib/domain/bracket-flights";
import { bracketDraws, tieByKey } from "@/lib/domain/my-tie";
import { drawRoundWords, laterTieHold, thirdPlaceFrom, type TieHold } from "@/lib/domain/knockout-ties";
import { resolveThirdPlace } from "@/lib/domain/third-place";
import { logAudit } from "./action-shared";
import { loadEventState } from "./tournament";

type EventState = NonNullable<Awaited<ReturnType<typeof loadEventState>>>;

/**
 * WHY THIS TIE'S RESULT IS HELD, asked of the tournament as it stands, or null.
 * `laterTieHold` given every fact it needs, read ONE way for every door that
 * changes or takes back a knockout result: the bracket's tap (`setBracketWinner`)
 * and Undo / Change result (`undoTieResult`). The draw's later ties, a plate drawn
 * from the first round's losers, and the play-off for third (a stored match).
 */
export function resultHeldBecause(state: EventState, key: string): TieHold | null {
  return laterTieHold(bracketDraws(state.brackets), key, {
    plate: state.event.bracketMode === "plate",
    thirdPlace: thirdPlaceFrom(state.matches),
  });
}

/** A tie named as every sentence and audit line names it: "Flight 2 · Semi-finals", or "" when it is not in the draw. */
export function tieRoundWords(state: EventState, key: string): string {
  const tie = tieByKey(bracketDraws(state.brackets), key);
  return tie ? drawRoundWords(tie.draw, tie.round) : "";
}

/**
 * TAKE A KNOCKOUT RESULT BACK — the one delete of a `BracketWinner`, shared by
 * the bracket's tap (`setBracketWinner`, tapping the winner again) and Undo /
 * Change result on Score entry (`undoTieResult`). Not a server action: it
 * trusts its caller to have asked who may, and `resultHeldBecause` whether it may.
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

/**
 * A PLAY-OFF FOR THIRD THAT HAS NOT BEEN PLAYED FOLLOWS THE SEMI-FINALS (review of
 * #1143, F1). It is made from the two beaten semi-finalists and stored as a match
 * outside the draw, so a semi-final changed after it was made left it between the
 * wrong players, and `createThirdPlaceMatch` refuses a second one. Called after
 * every change to a knockout result:
 *
 *   - played (a hole in, or conceded)  untouched: `laterTieHold` refused the change;
 *   - the semi-finals still have losers  its two sides drawn again from them;
 *   - a semi-final has no result now      taken down, to be made again on Rounds
 *                                         when both are played.
 *
 * Each move is on the record. Answers what it did, for the caller's sentence.
 */
export async function syncThirdPlace(eventId: string): Promise<"none" | "kept" | "redrawn" | "removed"> {
  const playoff = await prisma.match.findFirst({
    where: { eventId, round: 0 },
    select: { id: true, playerAId: true, playerBId: true, holes: true, forfeitedBy: true },
  });
  if (!playoff) return "none";
  if (thirdPlaceFrom([{ round: 0, ...playoff }])?.played) return "kept";
  const state = await loadEventState(eventId);
  const pairing = state ? resolveThirdPlace(state.brackets.winners).pairing : null;
  if (!pairing?.a.playerId || !pairing.b.playerId) {
    await prisma.match.deleteMany({ where: { id: playoff.id, eventId } });
    await logAudit(eventId, "third-place", "Took down the play-off for third: a semi-final has no result now. Make it again on Rounds once both are played");
    return "removed";
  }
  const same = [playoff.playerAId, playoff.playerBId].sort().join("|") === [pairing.a.playerId, pairing.b.playerId].sort().join("|");
  if (same) return "kept";
  await prisma.match.updateMany({ where: { id: playoff.id, eventId }, data: { playerAId: pairing.a.playerId, playerBId: pairing.b.playerId } });
  await logAudit(eventId, "third-place", `The play-off for third is now ${pairing.a.name} v ${pairing.b.name}, after a semi-final was changed`);
  return "redrawn";
}
