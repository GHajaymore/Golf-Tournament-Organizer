/**
 * Numbering a flight without losing the dead heats.
 *
 * The board's "By flight" view splits the overall standings into per-flight
 * tables and renumbers each from one, which is right: a player who is 9th in
 * the tournament is 2nd in their flight, and the flight is what they are
 * playing for. It did that with `map((r, i) => ({ ...r, rank: i + 1 }))`.
 *
 * That throws away every tie. `rankPlayers` shares a rank only when the club's
 * whole tiebreak chain comes back level — its own comment calls that "two
 * players nothing separates share a place" — and the stroke board has always
 * shared ranks too. Two players in the same flight who genuinely cannot be
 * separated arrived here sharing an overall rank and were printed 1 and 2.
 *
 * It decides prizes. A club day pays a flight winner, and this is the table
 * they read to find one.
 *
 * The same mistake `week-movement` had, found the same way: a ranking that
 * knew about ties handed to a renumbering that did not. There the fix was to
 * carry the rank through; here the number genuinely has to change, so the
 * TIES are carried instead.
 *
 * The signal is the overall rank itself, and it is exact rather than a
 * heuristic: two rows share an overall rank if and only if nothing separated
 * them, so they must share a flight place. Two rows with different overall
 * ranks were separated by something, so they must not.
 */

/**
 * Renumber from 1 within a list already in ranking order, sharing a place
 * wherever the incoming rank is shared.
 *
 * Overall 5, 9, 9, 14 becomes 1, 2, 2, 4 — the next place after a shared one
 * skips, exactly as it does on the board this list came from.
 */
export function placesWithin<T extends { rank: number }>(rows: readonly T[]): T[] {
  const places = placesByValue(rows, (r) => r.rank, () => true);
  return rows.map((row, i) => ({ ...row, rank: places[i] as number }));
}

/**
 * THE SAME RULE WHERE THERE IS NO INCOMING RANK — only the score the table is
 * ranked by.
 *
 * `placesWithin` exists because a list that KNEW about ties was handed to a
 * renumbering that did not. Three boards have the same fault with nothing to
 * carry through: they are the sole board for their round, they sort by a
 * score, and they print the row's index as its position. What separates two
 * rows level on that score is then whatever the sort's last fallback happened
 * to be — and all three read, measured 2026-09-15:
 *
 *     skins                 b.skins - a.skins || a.playerId.localeCompare(...)
 *     modified Stableford   b.points - a.points || a.gross - b.gross
 *                                               || a.name.localeCompare(...)
 *     team                  b.points - a.points || a.name.localeCompare(...)
 *
 * So two players on three skins each were printed 1st and 2nd **in cuid
 * order**, and two sides level on points were placed **alphabetically** — on
 * the organizer's console, on Reports, and on the public share link anybody
 * can open. Skins is the sharpest of the three because it decides money: the
 * pot divides by skins won, so the column contradicted the payout beside it.
 *
 * This does not invent a tiebreak. Where a board has one it should apply it
 * and the rows will not be level here; where it has none, two equal scores
 * share a place, which is what a results sheet prints.
 *
 * Returns one entry per row, in the same order — `null` for a row that holds
 * no position at all, which every caller already renders as a dash.
 */
export function placesByValue<T>(
  rows: readonly T[],
  /** The number the list is ranked by — skins, points, net strokes. */
  valueOf: (row: T) => number,
  /**
   * Whether this row holds a position. A side with no card and a player with
   * no skins are on the sheet without one, and must not take a place off
   * somebody who earned it — nor share one with each other.
   */
  placed: (row: T) => boolean,
): (number | null)[] {
  let place = 0;
  let seen = 0;
  let previous: number | null = null;
  let previousPlaced = false;

  return rows.map((row) => {
    if (!placed(row)) {
      // Not counted, so it cannot push the next placed row down — and it ends
      // any run, so two unplaced rows never share a place with each other.
      previous = null;
      previousPlaced = false;
      return null;
    }
    seen += 1;
    const value = valueOf(row);
    // Equal to the row before keeps that row's place; anything else takes the
    // place its position in the list implies.
    if (!previousPlaced || previous === null || value !== previous) place = seen;
    previous = value;
    previousPlaced = true;
    return place;
  });
}

/**
 * A place, written the way it is read: 1st, 2nd, 3rd, 11th, 21st.
 *
 * Beside `placesByValue` because a place and the words for it belong together
 * — and because there were already two private copies of this in the codebase
 * (`domain/series.ts`, `domain/voice-query.ts`) and a third in `WeekClient`
 * when a fourth was nearly written for the player's own screen. Those are
 * worth collapsing into this one; they are not touched here because a
 * rewording pass over three screens is not part of a scoring fix.
 */
export function placeLabel(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${teen ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;
}
