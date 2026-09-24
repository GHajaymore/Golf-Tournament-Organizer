import "server-only";
import { prisma } from "../db";
import { isContestKind, type ContestKind } from "../domain/contests";

/**
 * The on-course competitions a player should see on Today.
 *
 * Reads the round's Contests exactly as the organizer set them up — closest to
 * the pin, long drive — for the round in focus, plus any that hang off the whole
 * outing (`stageId: ""`). Nothing new is stored; this is the same data the money
 * screen reads, surfaced where a player can act on it: knowing which hole to go
 * for while they play, not after.
 *
 * The component decides which KINDS to show (on-course only); this just returns
 * the round's contests, ordered by hole so the card reads down the course.
 */
export interface DayContest {
  id: string;
  kind: ContestKind;
  name: string;
  hole: number;
  buyInCents: number;
}

export async function todayContestsFor(
  eventId: string,
  stageId: string | null,
): Promise<DayContest[]> {
  if (!stageId) return [];
  const rows = await prisma.contest.findMany({
    where: { eventId, OR: [{ stageId }, { stageId: "" }] },
    select: { id: true, kind: true, name: true, hole: true, buyInCents: true },
    orderBy: [{ hole: "asc" }, { createdAt: "asc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    // Stored as free text; an unknown kind reads as "other" rather than crashing
    // the Today screen — the same narrowing the money screen uses.
    kind: (isContestKind(r.kind) ? r.kind : "other") as ContestKind,
    name: r.name,
    hole: r.hole,
    buyInCents: r.buyInCents,
  }));
}
