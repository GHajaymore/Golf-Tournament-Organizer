/**
 * Whether a player's position is SHARED, and how to say it.
 *
 * The player's own screen showed a bare rank — "Position 2" — taken straight
 * from the standings. When three players are level on 2 the standings correctly
 * give all three rank 2, and the board correspondingly prints 2 three times;
 * but on `/me` that number is addressed to one person. Telling somebody they
 * are second when two others are equally second is the number they will quote
 * in the bar, and it is not what the results sheet says.
 *
 * Whether a position is shared is a fact about the FIELD, so it cannot be read
 * off one row — which is exactly why the screen got it wrong: `meFor` had the
 * whole list in hand and passed on only the one row.
 *
 * A player with no score does not share anything. Two players on rank 2 where
 * only one has started is not a tie: the other has not begun, and marking it
 * joint would tell somebody they are level with a player who has not teed off.
 */

export interface PositionRow {
  id: string;
  rank: number;
  /** Holes played. Zero means they have not started. */
  thru: number;
  /**
   * Whether this row holds a position at all.
   *
   * A card that stopped short — a match won 5&4, four holes conceded and never
   * played — is shown on the board without one, and its `rank` is 0. Without
   * this, every such row would look level with every other and a player would
   * be told they were "T0".
   */
  ranked: boolean;
}

/**
 * "T2" for a shared position, "2" for a solo one, "" when they have none.
 *
 * Returns the text rather than a boolean so the caller cannot render the
 * convention two different ways on two different screens.
 */
export function positionLabel(rows: PositionRow[], playerId: string): string {
  const mine = rows.find((r) => r.id === playerId);
  // Both, and they are different questions. `thru` is whether a card exists to
  // report on; `ranked` is whether it earned a place. A 5&4 card has the first
  // and not the second.
  if (!mine || mine.thru <= 0 || !mine.ranked) return "";
  const sharing = rows.filter((r) => r.thru > 0 && r.ranked && r.rank === mine.rank).length;
  return sharing > 1 ? `T${mine.rank}` : `${mine.rank}`;
}
