import "server-only";
import { prisma } from "../db";

/** A prize as a player sees it: what it is, what it is worth, who won it. */
export interface PlayerPrize {
  id: string;
  category: string;
  detail: string;
  /** Whole currency units, as `Prize.amount` stores them. */
  amount: number;
  /** The winner's name once the committee has awarded it, else null. */
  winner: string | null;
}

/**
 * THE PRIZE LIST, FOR THE PEOPLE PLAYING FOR IT (Ajay, 2026-10-05: "players can
 * see the prizes only for the tournament/round they are playing").
 *
 * `/prizes` is the committee's screen, and nothing a player could open read a
 * prize at all — a member could not see what was on offer, or that they had
 * won it. So this hands the list to somebody CONFIRMED in this tournament's
 * field, matched by the registration email every score guard uses, and to
 * nobody else: not a waitlisted or pending entrant, not a member who merely
 * belongs to the club, not a stranger with the public board link. They get [].
 *
 * A prize is club money and never enters a player settle-up (schema note on
 * `Contest`); this is a list to read, nothing more.
 */
export async function prizesForEntrant(eventId: string, email: string): Promise<PlayerPrize[]> {
  const address = email.trim().toLowerCase();
  if (!address) return [];
  const entered = await prisma.player.findFirst({
    where: { eventId, status: "confirmed", email: { equals: address, mode: "insensitive" } },
    select: { id: true },
  });
  if (!entered) return [];

  const prizes = await prisma.prize.findMany({
    where: { eventId },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: { id: true, category: true, detail: true, amount: true, winnerId: true },
  });
  const winnerIds = [...new Set(prizes.map((p) => p.winnerId).filter((id): id is string => !!id))];
  const names = new Map(
    (
      await prisma.player.findMany({
        where: { eventId, id: { in: winnerIds } },
        select: { id: true, name: true },
      })
    ).map((p) => [p.id, p.name]),
  );
  return prizes.map((p) => ({
    id: p.id,
    category: p.category,
    detail: p.detail,
    amount: p.amount,
    winner: p.winnerId ? names.get(p.winnerId) ?? null : null,
  }));
}
