/**
 * THE CLUBHOUSE SCREEN'S PAGES (2026-10-24).
 *
 * A TV in the bar shows the public board with nobody to scroll it. When the
 * field is longer than one screen the board is shown a screen at a time, and
 * after the last screen it starts again from the top.
 *
 * Where a page breaks is worked out here, from where the board's rows sit, so
 * that no page cuts a row in half: a name read on one page and its score on the
 * next is a board nobody can read from across a room. Pure — the measuring is
 * the component's (`ClubhouseScreen`), the arithmetic is this file's.
 */

/** How long one page stays up before the next. Long enough to find a name. */
export const CLUBHOUSE_PAGE_MS = 12_000;

/** A row, a heading or a line of the board: where it starts and ends, from the top of the board. */
export interface Atom {
  top: number;
  bottom: number;
}

/** Never more pages than this, whatever the measurements say. */
const MOST_PAGES = 200;

/**
 * Where each page starts, from the top of the board, the first always 0.
 *
 * `view` is how tall one screen of board is; `total` the whole board's height.
 * A board that fits is one page. Otherwise each page ends where the next row
 * that does not fit begins: of the atoms the page's bottom edge cuts through,
 * the innermost (the one starting lowest) — so a table row, not the section it
 * is in. Where the edge falls between rows, the page simply ends there.
 *
 * Every page starts strictly lower than the one before, so it always ends.
 */
export function pageStarts(atoms: readonly Atom[], view: number, total: number): number[] {
  if (!(view > 0) || !(total > view + 1)) return [0];
  const starts = [0];
  let start = 0;
  while (start + view < total - 1 && starts.length < MOST_PAGES) {
    const limit = start + view;
    let next = -1;
    for (const a of atoms) {
      // Cut by this page's bottom edge, and starting below this page's top.
      if (a.top > start + 0.5 && a.top < limit && a.bottom > limit + 0.5) next = Math.max(next, a.top);
    }
    if (next <= start) next = limit;
    start = next;
    starts.push(start);
  }
  return starts;
}

/**
 * How much of the screen a page shows: down to where the next page starts, so
 * the row that page breaks before is not half-shown at the foot of this one.
 * The last page shows the whole screen.
 */
export function pageHeight(starts: readonly number[], index: number, view: number): number {
  const i = Math.max(0, Math.min(index, starts.length - 1));
  return i < starts.length - 1 ? Math.min(view, starts[i + 1] - starts[i]) : view;
}

/** The page after this one, back to the first after the last. */
export function nextPage(index: number, count: number): number {
  if (count <= 1) return 0;
  return (index + 1) % count;
}

/** "Page 2 of 3", or nothing for a board that fits. */
export function pageWords(index: number, count: number): string {
  return count > 1 ? `Page ${Math.min(index, count - 1) + 1} of ${count}` : "";
}
