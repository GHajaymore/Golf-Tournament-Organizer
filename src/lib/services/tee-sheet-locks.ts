import "server-only";
import { prisma } from "../db";
import { clubWallClock } from "../domain/club-clock";
import { cleanIsoDate } from "../domain/round-dates";
import { slotLocks, type SlotLocks } from "../domain/tee-sheet-moves";
import type { TeeSheet } from "../domain/tee-sheet";
import { isPlayingRound } from "../stage-types";
import { zoneOfEvent } from "./club-clock";

/**
 * WHICH SLOTS OF A SAVED SHEET HAVE BEGUN, asked of the CLUB'S clock.
 *
 * The one reader of the facts `slotLocks` is told, for the screen (which draws
 * the reasons) and for `moveInTeeSheet` (which refuses on them), so the two
 * cannot read the day differently. The round's day is its own `playedOn`, or
 * the tournament's first day for the first round (as `lastTeeFor` reads it);
 * "now" is the instant read in the club's zone (`clubWallClock`), never the
 * server's own day. A card is in when the player holds a Scorecard row for the
 * round with a stroke on it — a row with none is not a card anybody returned.
 */
export async function slotLocksFor(eventId: string, stageId: string, sheet: TeeSheet): Promise<SlotLocks> {
  const [zone, stage, firstRound, cards] = await Promise.all([
    zoneOfEvent(eventId),
    prisma.stage.findFirst({ where: { id: stageId, eventId }, select: { playedOn: true } }),
    prisma.stage.findMany({ where: { eventId }, orderBy: { position: "asc" }, select: { id: true, type: true } }),
    prisma.scorecard.findMany({ where: { eventId, stageId }, select: { playerId: true, strokes: true } }),
  ]);
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { startOn: true } });
  const roundDay = cleanIsoDate(stage?.playedOn) || (firstRound.find((s) => isPlayingRound(s.type))?.id === stageId ? cleanIsoDate(event?.startOn) : "");
  const cardsIn = new Set(
    cards
      .filter((c) => {
        try {
          return (JSON.parse(c.strokes) as unknown[]).some((s) => typeof s === "number" && s >= 1);
        } catch {
          return false;
        }
      })
      .map((c) => c.playerId),
  );
  return slotLocks(sheet, { roundDay, now: clubWallClock(zone), cardsIn });
}
