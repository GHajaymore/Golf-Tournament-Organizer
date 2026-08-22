import "server-only";
import { prisma } from "../db";
import { loadEventState } from "./tournament";
import {
  suggestChampion,
  honoursYear,
  honoursByYear,
  type ChampionSuggestion,
  type FinishingPosition,
  type HonoursEntry,
} from "../domain/honours";

/**
 * The club's board, and what the app would put on it.
 *
 * Two halves that must not be confused. `honoursBoard` reads the CONFIRMED
 * record — rows a committee has accepted, denormalised so they never change
 * again. `championSuggestions` recomputes what the standings currently say, for
 * the tournaments nobody has confirmed yet.
 *
 * Only the first is the board. The second is a proposal, and it is recomputed
 * every time precisely because it is not the record: a scoring correction
 * should change what the app SUGGESTS and must never change what a club has
 * already hung on the wall.
 */

/** A confirmed line on the board, exactly as it was recorded. */
export interface BoardLine extends HonoursEntry {
  id: string;
  note: string;
}

/** A finished tournament with nobody's name against it yet. */
export interface PendingChampion {
  eventId: string;
  eventName: string;
  dates: string;
  year: number;
  suggestion: ChampionSuggestion;
}

/**
 * Every confirmed entry, newest year first.
 *
 * Read straight from the stored rows and never recomputed. Nothing here loads
 * an event, which is the point: the board renders for a club with twenty years
 * of history in one query, and it renders identically whether or not those
 * tournaments still exist.
 */
export async function honoursBoard(organizationId: string) {
  const rows = await prisma.honoursEntry.findMany({
    where: { organizationId },
    orderBy: [{ year: "desc" }, { eventName: "asc" }],
  });
  return honoursByYear(
    rows.map((r) => ({
      eventId: r.eventId,
      eventName: r.eventName,
      dates: r.dates,
      year: r.year,
      championName: r.championName,
      confirmedBy: r.confirmedBy,
    })),
  );
}

/**
 * The order a finished tournament ended in, from whichever board scored it.
 *
 * Stroke play ranks off `strokeStandings`, everything else off `overall`. Both
 * carry a rank and both leave unranked players at 0 — a card that stopped short
 * holds no position — so `suggestChampion` filters them out rather than reading
 * a zero as first place.
 */
function positionsFrom(state: NonNullable<Awaited<ReturnType<typeof loadEventState>>>): FinishingPosition[] {
  if (state.isStroke) {
    return state.strokeStandings
      .filter((s) => s.ranked)
      .map((s) => ({ playerId: s.player.id, name: s.player.name, rank: s.rank }));
  }
  return state.overall.map((r) => ({
    playerId: r.player.id,
    name: r.player.name,
    rank: r.rank,
  }));
}

/**
 * Completed tournaments with no confirmed champion, and what the app would say.
 *
 * Deliberately only the UNCONFIRMED ones. Recomputing a tournament somebody has
 * already signed off would invite the screen to show a suggestion beside a
 * confirmed name and quietly ask which is right — and the answer is always the
 * confirmed one, so the question should not be asked.
 *
 * This loads full event state per tournament, which is expensive. It is bounded
 * by how many finished tournaments a club has left unconfirmed, which is a
 * number that goes DOWN as the feature is used.
 */
export async function championSuggestions(organizationId: string): Promise<PendingChampion[]> {
  const events = await prisma.event.findMany({
    where: { organizationId, status: "completed" },
    select: { id: true, name: true, dates: true, completedAt: true },
    orderBy: { completedAt: "desc" },
  });
  if (events.length === 0) return [];

  const confirmed = new Set(
    (
      await prisma.honoursEntry.findMany({
        where: { organizationId, eventId: { in: events.map((e) => e.id) } },
        select: { eventId: true },
      })
    ).map((r) => r.eventId),
  );

  const pending: PendingChampion[] = [];
  for (const event of events) {
    if (confirmed.has(event.id)) continue;
    const state = await loadEventState(event.id);
    pending.push({
      eventId: event.id,
      eventName: event.name,
      dates: event.dates,
      year: honoursYear(event.dates, event.completedAt),
      suggestion: state
        ? suggestChampion({ completed: true, positions: positionsFrom(state) })
        : { ok: false, reason: "no-results", tied: [] },
    });
  }
  return pending;
}

/**
 * What one tournament's board entry would say, for the confirm action.
 *
 * Recomputed at the moment of confirming rather than trusted from the screen.
 * The name that goes on a board for decades is not a value to accept off the
 * wire — the same rule `acceptClubHandicap` follows, and for the same reason.
 */
export async function championFor(
  organizationId: string,
  eventId: string,
): Promise<{ event: { name: string; dates: string; year: number }; suggestion: ChampionSuggestion } | null> {
  const event = await prisma.event.findFirst({
    where: { id: eventId, organizationId },
    select: { id: true, name: true, dates: true, status: true, completedAt: true },
  });
  if (!event) return null;

  const state = await loadEventState(eventId);
  return {
    event: {
      name: event.name,
      dates: event.dates,
      year: honoursYear(event.dates, event.completedAt),
    },
    suggestion: state
      ? suggestChampion({ completed: event.status === "completed", positions: positionsFrom(state) })
      : { ok: false, reason: "no-results", tied: [] },
  };
}
