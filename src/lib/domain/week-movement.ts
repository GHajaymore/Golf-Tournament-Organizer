/**
 * What last night did to the table.
 *
 * A position is a fact and every app shows it. A position CHANGE is what a
 * league actually talks about — "I was fourth, I'm second now" — and it is
 * the thing none of the incumbents put on the weekly sheet.
 *
 * It has to be right in the awkward cases or it is worse than absent, because
 * a wrong arrow is read as an accusation. Specifically:
 *
 *  - Ties share a position, so two players level on 34 points are both 2nd
 *    and the next player is 4th. Splitting them arbitrarily would show one of
 *    them a movement they did not earn.
 *  - A player appearing for the first time has not "climbed" from anywhere.
 *    New is not the same as up, and pretending otherwise gives somebody who
 *    joined in week six a green arrow past people who played every week.
 */

export type Direction = "asc" | "desc";

export interface MovementInput {
  playerId: string;
  name?: string;
  /** Points, or net strokes — whichever the league ranks on. */
  value: number;
  /**
   * The place a ranker that knows MORE than `value` has already given this
   * row. Omit it and the position is derived from `value` alone, which is the
   * right answer for a stroke league where equal strokes really are equal.
   *
   * It is not the right answer for match play. `rankPlayers` breaks a tie on
   * points with the club's own configured chain — head-to-head, holes-won
   * ratio, fewest holes lost, lower handicap — and only shares a place when
   * every one of them comes back level. Re-deriving the number from points
   * here throws that work away after it has been done.
   */
  rank?: number;
}

export interface WeekRow {
  playerId: string;
  name: string;
  value: number;
  position: number;
  /** Positions gained since the week before. Negative is a drop. */
  change: number;
  /** True when this is the player's first appearance in the table. */
  isNew: boolean;
}

/**
 * Rank, sharing a position across equal values.
 *
 * Returns position by player id, so a caller can compare two weeks without
 * caring how either was sorted.
 */
export function positions(rows: MovementInput[], dir: Direction): Map<string, number> {
  /**
   * A RANKER THAT KNEW MORE HAS ALREADY ANSWERED THIS.
   *
   * The week sheet's table and the leaderboard disagreed about the same
   * league, on the same night. Read off Demo Cup on 2026-09-11 — four players
   * all on 10.5 points, 3 played, 2-1-0, +7 holes:
   *
   *     /leaderboard   3  Diego Alvarez    4  Tom Halloran
   *                    5  Grace Okafor     6  Lucia Romano
   *     /week          3  Diego Alvarez    3  Tom Halloran
   *                    3  Grace Okafor     3  Lucia Romano
   *
   * The leaderboard is right: `rankPlayers` separated them on the club's own
   * tiebreak chain and shares a place only when every link comes back level.
   * The week sheet was handed that ranking by `chainRoundStandings` — under a
   * comment promising "the same math the leaderboard uses, so the two cannot
   * disagree" — and then passed nothing but `totalPoints` down here, where the
   * place was worked out again from the one column.
   *
   * The ORDER was never wrong, because the rows arrive sorted and `Array.sort`
   * is stable. Only the numbers printed beside them were, which is the half a
   * player reads.
   *
   * All-or-nothing on purpose. A half-ranked list would mix two answers to the
   * same question, which is the fault being fixed rather than a smaller
   * version of it.
   */
  const ranked = rows.length > 0 && rows.every((r) => typeof r.rank === "number");
  if (ranked) return new Map(rows.map((r) => [r.playerId, r.rank as number]));

  const sorted = [...rows].sort((a, b) => (dir === "asc" ? a.value - b.value : b.value - a.value));
  const out = new Map<string, number>();
  let pos = 0;
  let seen = 0;
  let last: number | null = null;
  for (const r of sorted) {
    seen += 1;
    // A new value takes the position its rank implies; an equal value keeps
    // the position of the one before it, so 1, 2, 2, 4 rather than 1, 2, 2, 3.
    if (last === null || r.value !== last) pos = seen;
    out.set(r.playerId, pos);
    last = r.value;
  }
  return out;
}

/**
 * The table after this week, annotated with what moved.
 *
 * `before` may be empty — that is week one, where nobody has moved and
 * nobody is flagged as new either, because "new" against nothing is just
 * everybody.
 */
export function movementBetween(
  after: MovementInput[],
  before: MovementInput[],
  dir: Direction,
): WeekRow[] {
  const now = positions(after, dir);
  const then = positions(before, dir);
  const firstWeek = before.length === 0;

  return [...after]
    .sort((a, b) => (dir === "asc" ? a.value - b.value : b.value - a.value))
    .map((r) => {
      const position = now.get(r.playerId) ?? 0;
      const prev = then.get(r.playerId);
      return {
        playerId: r.playerId,
        name: r.name ?? "",
        value: r.value,
        position,
        // Climbing means the number got smaller, so the change is previous
        // minus current.
        change: prev === undefined ? 0 : prev - position,
        isNew: !firstWeek && prev === undefined,
      };
    });
}
