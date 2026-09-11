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
  let place = 0;
  let seen = 0;
  let previous: number | null = null;

  return rows.map((row) => {
    seen += 1;
    // A rank equal to the one before keeps that row's place; anything else
    // takes the place its position in the list implies.
    if (previous === null || row.rank !== previous) place = seen;
    previous = row.rank;
    return { ...row, rank: place };
  });
}
