import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { clubWallClock } from "../domain/club-clock";
import { cleanIsoDate } from "../domain/round-dates";
import { slotLocks, type SlotLocks } from "../domain/tee-sheet-moves";
import { zoneOfEventOn } from "./club-clock";
import type { TeeSheet } from "../domain/tee-sheet";
import { isPlayingRound } from "../stage-types";

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
export async function slotLocksFor(eventId: string, stageId: string, sheet: TeeSheet, db: Prisma.TransactionClient = prisma): Promise<SlotLocks> {
  // The club's zone is `zoneOfEventOn`'s answer (`zoneOfEvent`'s one reader), on the same client as the rest.
  const [zone, event, stage, firstRound, cards] = await Promise.all([
    zoneOfEventOn(db, eventId),
    db.event.findUnique({ where: { id: eventId }, select: { startOn: true } }),
    db.stage.findFirst({ where: { id: stageId, eventId }, select: { playedOn: true } }),
    db.stage.findMany({ where: { eventId }, orderBy: { position: "asc" }, select: { id: true, type: true } }),
    db.scorecard.findMany({ where: { eventId, stageId }, select: { playerId: true, strokes: true } }),
  ]);
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
  const locks = slotLocks(sheet, { roundDay, now: clubWallClock(zone), cardsIn });
  return locks;
}
