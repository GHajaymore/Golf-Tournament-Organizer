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
}

/**
 * "T2" for a shared position, "2" for a solo one, "" when they have no score.
 *
 * Returns the text rather than a boolean so the caller cannot render the
 * convention two different ways on two different screens.
 */
export function positionLabel(rows: PositionRow[], playerId: string): string {
  const mine = rows.find((r) => r.id === playerId);
  if (!mine || mine.thru <= 0) return "";
  const sharing = rows.filter((r) => r.thru > 0 && r.rank === mine.rank).length;
  return sharing > 1 ? `T${mine.rank}` : `${mine.rank}`;
}
