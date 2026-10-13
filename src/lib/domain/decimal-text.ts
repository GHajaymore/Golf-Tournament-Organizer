/**
 * A FIGURE TYPED WITH A DECIMAL COMMA IS THE SAME FIGURE.
 *
 * Germany, France and Spain write a handicap index "12,4" and a course rating
 * "71,3" — all three are on the World Handicap System, all three are languages
 * a club can choose here, and a phone set to any of them offers a comma on its
 * decimal keypad and no point at all. Until 2026-10-13 every reader of such a
 * figure was `Number()` or `parseFloat()`:
 *
 *   a handicap on the entry form or the roster   refused — "Enter your handicap
 *                                                as a number, like 12.4"
 *   a handicap on a casual round                 read as NOTHING: the player
 *                                                was put on scratch, silently
 *   a course rating                              cut at the comma: 71,3 was
 *                                                stored as 71.0, which moves
 *                                                every course handicap on that tee
 *
 * Found the same night as the amounts (`minorUnitsFrom`), by asking what else
 * reads a decimal somebody typed. This is the narrow half of that answer: ONE
 * comma between digits is a decimal mark. Anything else is handed back as it
 * came, so a reader that refuses nonsense still refuses it — "1,2,3" is not
 * made into a number here, and neither is "12,4abc".
 */
export function decimalPoint(text: string | null | undefined): string {
  const typed = String(text ?? "").trim();
  return /^[+-]?\d*,\d+$/.test(typed) ? typed.replace(",", ".") : typed;
}
