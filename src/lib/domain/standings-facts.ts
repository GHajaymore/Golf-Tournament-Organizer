import { rankedScore, unitIsNet, type RankedRow } from "./ranked-score";
import { todaysThru, type TodayFields } from "./scoreboard";

/** A board row, as much of it as these facts read. */
export type FactRow = RankedRow & TodayFields & { rank: number; ranked: boolean; name: string; gross: number; net: number };

/**
 * THE STROKE LEADERBOARD, AS FACTS FOR A DRAFTED MESSAGE (2026-10-09).
 *
 * `draftFactsFor` read `state.strokeStandings` straight off the engine, which
 * is one step BEFORE the board: `standingRows` is where a net board's to-par
 * is put on the net basis (`toParOnBasis`). So on a net medal the model was
 * handed the GROSS to-par of a field ranked on net — the April Medal fault of
 * 2026-09-22, in the one reader that writes sentences a club then sends. A
 * Stableford round was announced as "stroke play" with no points at all, and
 * a missed-cut row could be listed with a place it does not hold.
 *
 * So the facts are the board's own rows, read through the board's own
 * readers: `rankedScore` for the figure the board ranks on, `todaysThru` for
 * how far round. Rows without a place are left out — the model narrates the
 * leaders, and an unplaced row has nothing to lead with.
 */
export function standingsFactLines(
  rows: readonly FactRow[],
  opts: { isStableford: boolean; unit: string },
  limit = 10,
): { heading: string; lines: string[]; names: string[] } {
  const placed = rows.filter((r) => r.ranked && r.started && r.rank > 0);
  const shared = (rank: number) => placed.filter((r) => r.rank === rank).length > 1;
  const isNet = unitIsNet(opts.unit);
  const heading = opts.isStableford
    ? "Leaderboard (Stableford points, most first):"
    : `Leaderboard (${opts.unit || "strokes"}, fewest first):`;

  const shown = placed.slice(0, limit);
  const lines = shown.map((r) => {
    const place = shared(r.rank) ? `T${r.rank}` : String(r.rank);
    const figure = rankedScore(r, { isStroke: true, isStableford: opts.isStableford, isNet }).text;
    const score = opts.isStableford
      ? `${figure} pts (gross ${r.gross})`
      : `${figure === "E" ? "level par" : figure} (gross ${r.gross}, net ${r.net})`;
    const t = todaysThru(r, r.holesOwed);
    const thru = t.thru >= t.owed ? "finished" : `through ${t.thru}`;
    return `  ${place}. ${r.name} — ${score}, ${thru}`;
  });
  return { heading, lines, names: shown.map((r) => r.name) };
}
