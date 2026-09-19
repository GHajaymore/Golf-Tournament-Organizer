import "server-only";
import { prisma } from "../db";
import { parseTeeSheet } from "../domain/tee-sheet";
import { publishedFoursomes, partnersOf } from "../domain/group-entry";
import { cardRevision, NO_CARD_REVISION } from "../domain/pending-card";
import { isCardLocked } from "../domain/card-approval";

/** A partner's card as the marker's phone needs it. */
export interface PartnerCard {
  id: string;
  name: string;
  strokes: (number | null)[];
  /** The stored card's revision, so a stale write comes back as a conflict. */
  revision: string;
  status: string;
}

/**
 * The cards a player may keep for their group on this round, beside their own.
 *
 * The SAME rule `saveScorecard` enforces — `publishedFoursomes` over the
 * round's own sheet and the confirmed field — so the screen never offers a
 * card the action would refuse. A partner whose card is already approved is
 * left out: it is locked, and a row of numbers nobody can change is not
 * something to keep score on.
 */
export async function partnerCardsFor(input: {
  eventId: string;
  stage: { id: string; teeSheet: string; teeSheetPublished: boolean };
  playerId: string;
  holes: number;
  confirmed: readonly { id: string; name: string }[];
}): Promise<PartnerCard[]> {
  const byId = new Map(input.confirmed.map((p) => [p.id, p.name]));
  const foursomes = publishedFoursomes(
    parseTeeSheet(input.stage.teeSheet),
    input.stage.teeSheetPublished,
    new Set(byId.keys()),
  );
  const ids = partnersOf(input.playerId, foursomes);
  if (ids.length === 0) return [];

  const rows = await prisma.scorecard.findMany({
    where: { eventId: input.eventId, stageId: input.stage.id, playerId: { in: ids } },
    select: { playerId: true, strokes: true, status: true },
  });
  const rowOf = new Map(rows.map((r) => [r.playerId, r]));

  return ids.flatMap((id) => {
    const row = rowOf.get(id);
    if (row && isCardLocked(row.status)) return [];
    let raw: (number | null)[] = [];
    try {
      raw = row ? (JSON.parse(row.strokes) as (number | null)[]) : [];
    } catch {
      raw = [];
    }
    // Sized to the round the same way `meFor` sizes the player's own card, so
    // the revision hashes the same array the phone will hold.
    const strokes = Array.from({ length: input.holes }, (_, i) => raw[i] ?? null);
    return [
      {
        id,
        name: byId.get(id) ?? "",
        strokes,
        // No card yet is NO_CARD_REVISION, not "" — the empty string means
        // "write unconditionally" to the server (see the card page).
        revision: row ? cardRevision(strokes) : NO_CARD_REVISION,
        status: row?.status ?? "entered",
      },
    ];
  });
}
