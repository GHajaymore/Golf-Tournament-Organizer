/**
 * Whether a player's position is SHARED, and how to say it.
 *
 * The player's own screen showed a bare rank — "Position 2" — taken straight
 * from the standings. When three players are level on 2 the standings correctly
 * give all three rank 2 (and the boards now print T2 for each — see
 * `placeText`); on `/me` that number is addressed to one person. Telling somebody they
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
  /**
   * Whether this player has a RESULT in this round yet.
   *
   * Not the same as holes played, which is what this used to ask. A match-play
   * round stores its results on the matches rather than in scorecards, so
   * `thru` is zero for everybody in it however much golf they have played —
   * and a player 3-0-0 and top of their flight was told their position was
   * "–" while the console, the dashboard and their own Board tab all showed
   * them first.
   *
   * The format knows which fact answers this, so the answer is computed where
   * the format is known — see `standingRows` — rather than inferred here from
   * a column that means different things on different boards.
   */
  started: boolean;
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
 * Whether a row holds a position at all — the single rule every board asks.
 *
 * Both halves, and they are different questions. `started` is whether there is
 * a result to report on; `ranked` is whether it earned a place. A 5&4 card has
 * the first and not the second; a match player who has not teed off has
 * neither, yet is `ranked: true` in the standings (a match row always is) — so
 * a board that gated on `ranked` alone painted them a position the hero on
 * `/me` refused. In stroke play `ranked` already implies `started` (a card with
 * no holes is not ranked — see `isRanked`), so this only changes the match
 * boards, bringing them into line with the player's own screen.
 *
 * Every reader that prints a position — the scoreboard tiles, both leaderboard
 * tables and the player's own row — goes through this, so the four cannot
 * disagree about who has a place. Pinned by `holds-position.test.ts`.
 */
export function holdsPosition(row: { ranked: boolean; started: boolean }): boolean {
  return row.ranked && row.started;
}

type Placed = { rank: number; ranked: boolean; started: boolean };

/**
 * The ranks that more than one position-holding row sits on.
 *
 * Built once per board rather than asked per row: a board printing every
 * row's place would otherwise re-scan the field for each line. Rows without a
 * position are left out for the reason in the file note — a player who has not
 * teed off is not level with anybody.
 */
export function sharedRanks(rows: readonly Placed[]): Set<number> {
  const seen = new Set<number>();
  const shared = new Set<number>();
  for (const r of rows) {
    if (!holdsPosition(r) || r.rank <= 0) continue;
    if (seen.has(r.rank)) shared.add(r.rank);
    else seen.add(r.rank);
  }
  return shared;
}

/**
 * "T9" or "9" for a row that holds a position — the golf convention.
 *
 * THE BOARDS PRINT IT TOO, since 2026-09-25. They used to print the bare rank
 * and let the repeated number show the tie ("2" three times), on the view that
 * only `/me` addresses one person. But every tournament board and results sheet
 * prints "T9", and a board reading 9, 9, 11, 12 looks to anybody who does not
 * already know the convention like a numbering mistake — the skipped 10 most of
 * all. It was read exactly that way on the seeded club's medal board during a
 * test pass. With the prefix the skip explains itself: T9, T9, 11, 12.
 *
 * The caller decides what a row WITHOUT a position shows (each board has its
 * own dash); this only answers for rows that hold one.
 */
export function placeText(row: Placed, shared: ReadonlySet<number>): string {
  return shared.has(row.rank) ? `T${row.rank}` : `${row.rank}`;
}

/**
 * "T2" for a shared position, "2" for a solo one, "" when they have none.
 *
 * Returns the text rather than a boolean so the caller cannot render the
 * convention two different ways on two different screens.
 */
export function positionLabel(rows: PositionRow[], playerId: string): string {
  const mine = rows.find((r) => r.id === playerId);
  if (!mine || !holdsPosition(mine)) return "";
  return placeText(mine, sharedRanks(rows));
}
