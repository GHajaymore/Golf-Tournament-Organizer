import "server-only";
import { prisma } from "../db";
import { loadEventState } from "./tournament";
import { finishingPositions } from "./finish-order";
import {
  seriesStandings,
  DEFAULT_POINTS_TABLE,
  type EventFinish,
  type SeriesConfig,
  type SeriesStanding,
} from "../domain/series";

/**
 * Reading a season out of the tournaments that make it up.
 *
 * The engine takes finishing positions; this is the part that works out what
 * a finishing position *is* for each format. A stroke-play round ranks on
 * strokes, a Stableford round on points, a round robin on match points — and
 * the standings for all three already exist, so this reads the order they
 * produce rather than recomputing anything.
 */

export interface SeriesView {
  id: string;
  name: string;
  description: string;
  pointsTable: number[];
  bestOf: number;
  minEvents: number;
  status: string;
  eventCount: number;
}

function parseTable(json: string): number[] {
  if (!json.trim()) return DEFAULT_POINTS_TABLE;
  try {
    const v = JSON.parse(json) as unknown;
    if (Array.isArray(v) && v.every((n) => typeof n === "number" && Number.isFinite(n))) {
      return v as number[];
    }
  } catch {
    // fall through
  }
  return DEFAULT_POINTS_TABLE;
}

export function configOf(s: { pointsTable: string; bestOf: number; minEvents: number }): SeriesConfig {
  return { pointsTable: parseTable(s.pointsTable), bestOf: s.bestOf, minEvents: s.minEvents };
}

export async function seriesForOrg(organizationId: string): Promise<SeriesView[]> {
  const rows = await prisma.series.findMany({
    where: { organizationId },
    include: { _count: { select: { events: true } } },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });
  return rows.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    pointsTable: parseTable(s.pointsTable),
    bestOf: s.bestOf,
    minEvents: s.minEvents,
    status: s.status,
    eventCount: s._count.events,
  }));
}

/**
 * The finishing order of one tournament, as the season should read it.
 *
 * Reuses the tournament's own standings rather than re-deriving a winner. Two
 * places computing "who won" is two places to disagree, and the leaderboard
 * an organizer published is the answer the season has to honour.
 *
 * Only members are returned. An entry with no roster link cannot be tracked
 * across a season — there is nothing to join it to next week — so it is
 * dropped rather than counted under a name that might belong to two people.
 */
export async function finishOrderFor(eventId: string): Promise<EventFinish | null> {
  const state = await loadEventState(eventId);
  if (!state) return null;

  const memberByPlayer = new Map(
    state.players.filter((p) => p.memberId).map((p) => [p.id, p.memberId as string]),
  );

  /**
   * How this tournament finished — the same answer the honours board gets.
   *
   * Two things were wrong here and both now live in `finishingPositions`.
   *
   * ONLY PLAYERS WHO RETURNED SOMETHING. A no-show has `ranked: false` and a
   * rank of 0, and that rank was carried straight into `pointsForRank`, which
   * is 1-based. `table[rank - 1]` is then `table[-1]` — undefined, so nothing
   * for the first slot — and the loop walks FORWARD from there into `table[0]`,
   * the winner's points. Three non-returners tied at rank 0 therefore scored
   * sixty each, above the player who actually finished fourth on fifty-five,
   * and each banked a `played` towards `minEvents`. A twenty-player
   * hand-scored event handed all twenty members 34.7 points for a round the
   * app does not even rank.
   *
   * AND A KNOCKOUT IS DECIDED BY ITS DRAW. Neither branch could see one: a
   * knockout has no points, so every player sat on zero and sorted by seed,
   * which is handicap order. The season table scored the whole field in
   * handicap order — and after the filter above, scored nobody at all, since
   * a player whose only golf was in the bracket has `played` of 0.
   */
  const ordered = finishingPositions(state);

  const finishers = ordered
    .filter((o) => memberByPlayer.has(o.playerId))
    .map((o) => ({ memberId: memberByPlayer.get(o.playerId)!, name: o.name, rank: o.rank }));

  return { eventId, eventName: state.event.name, finishers };
}

export interface SeriesTable {
  series: SeriesView;
  events: Array<{ id: string; name: string; dates: string; counted: boolean }>;
  standings: SeriesStanding[];
  /** Entries dropped because they had no roster link, so nothing is silently lost. */
  unlinked: number;
}

/**
 * A season's table.
 *
 * Only finished tournaments count. A round in progress has a leaderboard that
 * changes every time a card comes in, and letting that move the order of merit
 * would show players a season position that reverses itself an hour later.
 */
export async function seriesTable(seriesId: string): Promise<SeriesTable | null> {
  const series = await prisma.series.findUnique({
    where: { id: seriesId },
    include: { events: { orderBy: { createdAt: "asc" } } },
  });
  if (!series) return null;

  const finished = series.events.filter((e) => e.status === "completed");
  const finishes: EventFinish[] = [];
  let unlinked = 0;

  for (const e of finished) {
    const f = await finishOrderFor(e.id);
    if (!f) continue;
    const entered = await prisma.player.count({ where: { eventId: e.id, status: "confirmed" } });
    unlinked += Math.max(0, entered - f.finishers.length);
    finishes.push(f);
  }

  const config = configOf(series);
  return {
    series: {
      id: series.id,
      name: series.name,
      description: series.description,
      pointsTable: config.pointsTable,
      bestOf: series.bestOf,
      minEvents: series.minEvents,
      status: series.status,
      eventCount: series.events.length,
    },
    events: series.events.map((e) => ({
      id: e.id,
      name: e.name,
      dates: e.dates,
      counted: e.status === "completed",
    })),
    standings: seriesStandings(finishes, config),
    unlinked,
  };
}
