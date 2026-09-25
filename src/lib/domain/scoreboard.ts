/**
 * THE HAND-HUNG SCOREBOARD — how the player's Today screen reads, chosen by
 * the club on 2026-09-19 ("go with the scorecard look", design D).
 *
 * A scoreboard beside the 18th green hangs a surname, a position, holes
 * played and a total on tiles. This module turns the board's own rows into
 * those tiles. It decides only how to SAY a row — every number comes from
 * `standingRows` and `rankedScore`, the same as the Board tab, so the two
 * screens cannot disagree about who leads.
 */

import { holdsPosition } from "./shared-position";

export interface BoardRow {
  id: string;
  name: string;
  rank: number;
  ranked: boolean;
  /**
   * Whether this row has a RESULT in this round yet — a match player who has
   * not teed off is `ranked` but not `started`, and holds no position. Same
   * fact `standingRows` computes for the player's own screen; see
   * `holdsPosition`.
   */
  started: boolean;
  thru: number;
  holesOwed: number;
  absent?: boolean;
}

/**
 * Surnames, upper-cased, the way they are painted on a board — and told apart
 * where two players share one: "S. KIM" and "J. KIM". A player with one name
 * keeps it.
 */
export function boardNames(names: readonly string[]): string[] {
  const parts = names.map((n) => n.trim().split(/\s+/).filter(Boolean));
  const surname = (p: string[]) => (p.length ? p[p.length - 1] : "").toUpperCase();
  const count = new Map<string, number>();
  for (const p of parts) count.set(surname(p), (count.get(surname(p)) ?? 0) + 1);
  return parts.map((p) => {
    const s = surname(p);
    if ((count.get(s) ?? 0) > 1 && p.length > 1) return `${p[0][0].toUpperCase()}. ${s}`;
    return s || "—";
  });
}

/**
 * "1", "T3" — a shared position carries the T a scoreboard paints. Counted
 * over the whole field, not the rows shown, so a tie with somebody below the
 * fold is still a tie. An unranked row has no position.
 */
export function positionLabel(
  row: Pick<BoardRow, "rank" | "ranked" | "started">,
  all: readonly Pick<BoardRow, "rank" | "ranked" | "started">[],
): string {
  if (!holdsPosition(row) || row.rank <= 0) return "–";
  const shared = all.filter((r) => holdsPosition(r) && r.rank === row.rank).length > 1;
  return shared ? `T${row.rank}` : String(row.rank);
}

/**
 * The THRU tile: holes played, "F" when the card is in, "–" before a shot.
 * The same thresholds as the Board tab's "thru 14" / "F".
 */
export function thruTile(row: Pick<BoardRow, "thru" | "holesOwed" | "absent">, holes: number): string {
  if (row.absent || row.thru <= 0) return "–";
  const owed = row.holesOwed > 0 ? row.holesOwed : holes;
  return row.thru >= owed ? "F" : String(row.thru);
}

/**
 * Which rows hang on the small board: the leaders, and the player themself.
 *
 * The top `limit` in board order. If the player is further down, their row is
 * added at the end with `gap` set, so the screen can draw the break a real
 * board shows between the leaders and the rest — a player always finds
 * themself on it.
 */
export function leadersWithYou<T extends { id: string }>(
  rows: readonly T[],
  youId: string,
  limit: number,
): { row: T; gap: boolean }[] {
  const top = rows.slice(0, limit).map((row) => ({ row, gap: false }));
  if (!youId || top.some((t) => t.row.id === youId)) return top;
  const you = rows.find((r) => r.id === youId);
  return you ? [...top, { row: you, gap: true }] : top;
}

export type TileMark = "under" | "over" | "par" | "blank";

/**
 * How a hole's tile is marked on the card board: red and ringed under par,
 * boxed over par — the marking a printed card uses. No par, no mark: a score
 * is never called a birdie against a par the round does not have.
 */
export function tileMark(stroke: number | null | undefined, par: number | undefined): TileMark {
  if (stroke === null || stroke === undefined) return "blank";
  if (!par) return "par";
  if (stroke < par) return "under";
  if (stroke > par) return "over";
  return "par";
}
