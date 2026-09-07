/**
 * Which rows moved, and by how far — the decision behind the leaderboard's
 * one animation.
 *
 * WHY THERE IS ONLY ONE. `globals.css` deliberately removed the hover
 * translation on cards, on the grounds that "a moving surface is read as a
 * glitch, not as affordance". That is the rule, and this is its exception:
 * when a score lands and positions change, the movement IS the information.
 * A spectator watching a group come up the 18th wants to see who went past
 * whom, and a table that silently redraws in a new order has thrown that away.
 * Motion belongs on data changes, never on chrome.
 *
 * Kept as a pure function because it is the only part worth testing. The DOM
 * half — measure, then play — is four lines of plumbing in `FlipList`; the
 * judgements are all here, where a node environment can reach them.
 */

/** A row's vertical position, keyed by whatever identifies the row. */
export type RowOffsets = ReadonlyMap<string, number>;

export interface RowShift {
  key: string;
  /**
   * How far to translate the row so it STARTS where it used to be. Positive
   * means it moved up the board and will animate downward back to rest.
   */
  dy: number;
}

/**
 * Below this many pixels a "move" is a sub-pixel layout wobble — a font
 * settling, a scrollbar appearing — not a position change. Animating those
 * makes an idle board shimmer.
 */
const MIN_SHIFT = 1;

export function reorderShifts(
  before: RowOffsets,
  after: RowOffsets,
  options: { reduceMotion?: boolean; minShift?: number } = {},
): RowShift[] {
  // Not a preference to read and then ignore. Somebody who has asked their
  // device for less motion is frequently somebody for whom it causes nausea,
  // and a leaderboard that lurches is exactly the kind that does it.
  if (options.reduceMotion) return [];

  const min = options.minShift ?? MIN_SHIFT;
  const shifts: RowShift[] = [];

  for (const [key, to] of after) {
    const from = before.get(key);
    // A row that was not on the previous board is new to it — a player whose
    // first score has just landed. It has not MOVED, it has arrived, and
    // sliding it in from a position it never held would be inventing a story.
    //
    // THIS IS ALSO WHAT MAKES THE FIRST RENDER SILENT, and it is worth saying
    // here because the obvious alternative is a separate `before.size === 0`
    // early return. That guard was written, and mutation testing found it
    // could not fail: on a first render every row takes this branch anyway, so
    // deleting the early return changed no behaviour and no test. A guard that
    // cannot fail is not protection, it is a comment that costs a branch — so
    // the rule lives once, here, where it is actually load-bearing.
    if (from === undefined) continue;
    const dy = from - to;
    if (Math.abs(dy) < min) continue;
    shifts.push({ key, dy });
  }

  return shifts;
}
