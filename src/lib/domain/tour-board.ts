/**
 * A leaderboard that reads like the one on television.
 *
 * Everything here is PRESENTATION of numbers the standings already produce —
 * no new arithmetic, and nothing that could disagree with the ranking. It is in
 * the domain because a leaderboard is the thing a club argues about, and "is
 * the tie shown correctly" should be a test rather than a squint at the screen.
 *
 * Three conventions the tour uses and this board did not:
 *
 *  - **T for a shared position.** Two players level on 3 both read "T2", and
 *    the next player down is 4, not 3. Showing "2" twice invites a member to
 *    ask which of them is really second, and the honest answer is neither.
 *  - **F when the round is done.** "Thru 18" is a number a reader has to
 *    compare against the round length; "F" is finished, at a glance, and it is
 *    right for a nine-hole round without anybody doing arithmetic.
 *  - **Under par reads differently from over.** Red on television, and here the
 *    club's second colour — the same one the money screen uses for money coming
 *    to you, because both mean "this is the good direction".
 */

/**
 * Display positions for a column of ranks, with ties marked.
 *
 * Takes the whole column rather than one row, because whether a position is
 * shared is a fact about the FIELD and cannot be decided from one player. That
 * is exactly the bug this replaces: the old board printed `r.rank` per row, so
 * a three-way tie for second printed "2" three times and then jumped to 5, and
 * nothing on screen said the 2s were shared.
 *
 * `hasScore` is separate from the rank because a player with no card yet has a
 * rank in the data and no business showing one on the board.
 */
export function tourPositions(rows: Array<{ rank: number; hasScore: boolean }>): string[] {
  const counts = new Map<number, number>();
  for (const r of rows) {
    if (!r.hasScore) continue;
    counts.set(r.rank, (counts.get(r.rank) ?? 0) + 1);
  }
  return rows.map((r) => {
    if (!r.hasScore) return "—";
    return (counts.get(r.rank) ?? 0) > 1 ? `T${r.rank}` : `${r.rank}`;
  });
}

/**
 * "F" for a finished round, the hole number while they are out, "—" before
 * they start.
 *
 * A round longer than its hole count still reads "F": a card with a
 * nineteenth hole on it is a data problem, and hiding it behind "Thru 19"
 * helps nobody, but neither does the board claiming somebody is still playing.
 */
export function thruText(thru: number, holes: number): string {
  if (thru <= 0) return "—";
  return thru >= holes ? "F" : `${thru}`;
}

/**
 * Which direction a score is going, for colour.
 *
 * Decided here rather than inline so the board cannot come to colour level par
 * as though it were under it — "E" is neither good nor bad and must not borrow
 * the good colour.
 */
export function parTone(toPar: number): "under" | "level" | "over" {
  if (toPar < 0) return "under";
  return toPar > 0 ? "over" : "level";
}

/**
 * The index after which the cut line is drawn, or -1 when there is none.
 *
 * A line is only meaningful when it separates somebody from somebody: an
 * all-advancing field and an all-missing field both get none. Returns the
 * LAST advancing index, and the caller draws the line under that row.
 *
 * Reads the flags rather than re-deriving who advances. The cut is decided in
 * one place and this is a picture of it — a second opinion here is how a board
 * comes to draw the line in a different place from the one the app is using.
 */
export function cutLineAfter(rows: Array<{ advancing: boolean }>): number {
  let last = -1;
  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i].advancing) last = i;
  }
  // Everybody advances, or nobody does — either way the line separates nothing.
  if (last === -1 || last === rows.length - 1) return -1;
  // Somebody above the line is missing it: the flags are not a clean prefix, so
  // a single line would be a lie about who got through.
  for (let i = 0; i < last; i += 1) {
    if (!rows[i].advancing) return -1;
  }
  return last;
}
