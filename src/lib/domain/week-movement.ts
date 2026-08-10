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
