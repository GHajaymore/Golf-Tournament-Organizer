/**
 * Season-long standings — an order of merit across many tournaments.
 *
 * The identity that matters here is the **Member**, not the Player. A Player
 * row belongs to one event; the same golfer entering twelve league rounds is
 * twelve Player rows. Aggregating on them would give one person twelve
 * separate lines on the table, each with a twelfth of their points. The roster
 * exists precisely so there is one record of a person to hang a season on.
 *
 * Three rules do most of the work, and each exists because leagues actually
 * run this way:
 *
 *   **Points from finishing position.** A table maps 1st, 2nd, 3rd… to points.
 *   Ties share what the tied positions are collectively worth, rather than
 *   both taking the higher — two players tied for 2nd take the average of 2nd
 *   and 3rd, so the total awarded never exceeds what the table allocates.
 *
 *   **Best N of M.** Most seasons let a player drop their worst rounds, so
 *   missing a week isn't fatal and turning up to everything isn't required.
 *
 *   **A minimum to qualify.** Someone who played once and won shouldn't top a
 *   twelve-round order of merit. They are shown, but unranked, because
 *   hiding them makes the table look wrong to the person who played.
 */

export interface SeriesConfig {
  /** Points for 1st, 2nd, 3rd… Positions past the end score nothing. */
  pointsTable: number[];
  /** Count only this many best results. 0 counts everything. */
  bestOf: number;
  /** Events a member must play before they are ranked. 0 ranks everyone. */
  minEvents: number;
}

/** One tournament's finishing order. Ties share a rank. */
export interface EventFinish {
  eventId: string;
  eventName: string;
  /** rank is 1-based; several members may share one. */
  finishers: Array<{ memberId: string; name: string; rank: number }>;
}

export interface SeriesEntry {
  eventId: string;
  eventName: string;
  rank: number;
  points: number;
  /** False when this result was dropped by the best-of rule. */
  counted: boolean;
}

export interface SeriesStanding {
  memberId: string;
  name: string;
  /** Points after the best-of rule. */
  total: number;
  /** Every result, including the ones dropped. */
  entries: SeriesEntry[];
  played: number;
  /** Null when the member hasn't met the minimum. */
  position: number | null;
  /** Finishing positions, best first — the countback for ties. */
  finishes: number[];
}

export const DEFAULT_POINTS_TABLE = [100, 80, 65, 55, 50, 45, 40, 36, 32, 29, 26, 24, 22, 20, 18, 16, 14, 12, 10, 8];

/**
 * What one finishing position is worth, given how many share it.
 *
 * Tied players take the average of the positions they collectively occupy. Two
 * tied for 2nd occupy 2nd and 3rd, so each takes (80 + 65) / 2 = 72.5 — the
 * pair receives exactly what those two places were worth, which is the point.
 * Awarding both 80 would invent points the table never allocated and let a
 * congested event outscore a clean one.
 */
export function pointsForRank(table: number[], rank: number, tiedCount: number): number {
  /**
   * A rank below 1 is not a finishing position, and must score nothing.
   *
   * This table is 1-BASED, so `table[rank - 1]` on a rank of 0 reads
   * `table[-1]` — undefined, contributing nothing — and then the loop below
   * walks FORWARD into `table[0]`, which is the winner's points. A group of
   * non-returners sharing rank 0 was therefore paid from the top of the table
   * downwards, out-scoring the players who finished behind them.
   *
   * `finishOrderFor` no longer sends unranked players here, which is the real
   * fix. This is the second lock on the same door: the function is exported and
   * 1-based, and nothing in its signature says so.
   */
  if (!Number.isFinite(rank) || rank < 1) return 0;

  const n = Math.max(1, tiedCount);
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += table[rank - 1 + i] ?? 0;
  return sum / n;
}

/**
 * The order of merit.
 *
 * Deliberately takes finishing *positions* rather than scores. A season can
 * mix stroke play, Stableford and match play, and those produce numbers that
 * cannot be added together — position is the only currency every format
 * shares. It is also what every league table an organizer has ever seen uses.
 */
export function seriesStandings(events: EventFinish[], config: SeriesConfig): SeriesStanding[] {
  const table = config.pointsTable.length ? config.pointsTable : DEFAULT_POINTS_TABLE;
  const byMember = new Map<string, SeriesStanding>();

  for (const ev of events) {
    // How many share each rank, so ties split correctly.
    const atRank = new Map<number, number>();
    for (const f of ev.finishers) atRank.set(f.rank, (atRank.get(f.rank) ?? 0) + 1);

    for (const f of ev.finishers) {
      const points = pointsForRank(table, f.rank, atRank.get(f.rank) ?? 1);
      const existing = byMember.get(f.memberId) ?? {
        memberId: f.memberId,
        name: f.name,
        total: 0,
        entries: [],
        played: 0,
        position: null,
        finishes: [],
      };
      // A later event's name wins, so a member who changed their name on the
      // roster shows the current one rather than whichever event loaded first.
      existing.name = f.name || existing.name;
      existing.entries.push({
        eventId: ev.eventId,
        eventName: ev.eventName,
        rank: f.rank,
        points,
        counted: true,
      });
      byMember.set(f.memberId, existing);
    }
  }

  const standings = [...byMember.values()].map((s) => {
    // Best-of: keep the highest-scoring results, mark the rest as dropped
    // rather than deleting them — an organizer needs to see what was left out.
    const order = [...s.entries].sort((a, b) => b.points - a.points);
    const keep = config.bestOf > 0 ? Math.min(config.bestOf, order.length) : order.length;
    const kept = new Set(order.slice(0, keep));
    for (const e of s.entries) e.counted = kept.has(e);

    return {
      ...s,
      played: s.entries.length,
      total: s.entries.filter((e) => e.counted).reduce((sum, e) => sum + e.points, 0),
      finishes: s.entries.map((e) => e.rank).sort((a, b) => a - b),
    };
  });

  // Rank the qualified; everyone else keeps a null position and sorts after.
  const qualified = standings.filter((s) => s.played >= config.minEvents);
  const short = standings.filter((s) => s.played < config.minEvents);

  qualified.sort((a, b) => b.total - a.total || countback(a.finishes, b.finishes) || a.name.localeCompare(b.name));
  qualified.forEach((s, i) => {
    // Equal totals share a position, as a league table should.
    const prev = qualified[i - 1];
    s.position = prev && prev.total === s.total && countback(prev.finishes, s.finishes) === 0
      ? prev.position
      : i + 1;
  });
  short.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  return [...qualified, ...short];
}

/**
 * Break a points tie on finishing positions: most wins, then most seconds, and
 * so on. Returns a comparator value, negative when `a` ranks ahead.
 *
 * This is the countback every club uses when two players finish level, and it
 * settles almost every case — a season of identical results is vanishingly
 * rare, and alphabetical order catches what's left.
 */
export function countback(a: number[], b: number[]): number {
  // The depth is the deepest *finishing position* either player recorded, not
  // how many they played. Using the array length stops the loop early: two
  // players with [1,3] and [1,4] both have length 2, so place 3 is never
  // examined and a genuine difference reads as a tie.
  const depth = Math.max(0, ...a, ...b);
  for (let place = 1; place <= depth; place += 1) {
    const countA = a.filter((r) => r === place).length;
    const countB = b.filter((r) => r === place).length;
    if (countA !== countB) return countB - countA;
  }
  return 0;
}

/** A points table an organizer can read back, for the settings screen. */
export function describeTable(table: number[]): string {
  const head = table.slice(0, 3).join(", ");
  return table.length <= 3
    ? `${head} points`
    : `${head}… down to ${table[table.length - 1]} for ${ordinal(table.length)}`;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}
