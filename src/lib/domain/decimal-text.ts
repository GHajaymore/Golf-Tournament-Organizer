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
  const typed = plainFigure(text);
  return /^[+-]?\d*,\d+$/.test(typed) ? typed.replace(",", ".") : typed;
}

/**
 * WHAT WAS TYPED, IN THE DIGITS AND MARKS AN ASCII KEYBOARD WOULD HAVE GIVEN.
 *
 * A Japanese keyboard in its ordinary mode types full-width digits — and its
 * own point, comma, plus and minus — and a phone or a spreadsheet will write a
 * true minus sign (U+2212) where a golfer meant a hyphen. `Number("\uFF11\uFF12")`
 * is NaN, so every one of those was "not a number" in a language this app
 * sells in. Nothing else is touched: this does not guess at a figure, it only
 * spells the same figure the way the readers below expect.
 */
export function plainFigure(text: string | null | undefined): string {
  return String(text ?? "")
    .replace(/[\uFF10-\uFF19]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/\uFF0E/g, ".")
    .replace(/\uFF0C/g, ",")
    .replace(/\uFF0B/g, "+")
    .replace(/[\u2212\uFF0D]/g, "-")
    .trim();
}

/**
 * ONE READING OF A NUMBER SOMEBODY TYPED, FOR EVERY BOX IN THE APP.
 *
 * A count on 2026-10-13 found 48 places on the screens that read a typed number
 * their own way: `parseFloat`, `parseInt`, `Number`, each with its own idea of
 * what to do next. They disagree about exactly the inputs that matter:
 *
 *   "72a"     parseInt says 72, parseFloat says 72, Number says not a number
 *   "7l.3"    (an L for a 1) parseFloat says 7
 *   "1e3"     Number says 1000
 *   "0x10"    Number says 16
 *   ""        Number says 0 — which for a handicap is SCRATCH
 *   "12,4"    all three get it wrong, differently (see `decimalPoint`)
 *
 * So a typo was a figure in one box and a refusal in the next, and a box left
 * empty was nought. This says only what was typed: nothing, a number, or
 * something that is not one. WHAT TO DO ABOUT EACH IS THE BOX'S DECISION, and
 * it has to make it — the three are different answers and the type makes a
 * caller look at which it got.
 *
 * A number here is digits with at most one decimal mark and an optional sign.
 * No exponent, no hex, no "Infinity", no thousands separators (an amount of
 * money has those, and its own reader: `minorUnitsFrom`).
 */
export type TypedFigure = { kind: "blank" } | { kind: "number"; value: number } | { kind: "unreadable"; text: string };

/** A figure that may have a decimal part: a handicap index, a course rating, a points value. */
export function readDecimal(text: string | null | undefined): TypedFigure {
  const typed = decimalPoint(text);
  if (typed === "") return { kind: "blank" };
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(typed)) return { kind: "unreadable", text: typed };
  const value = Number(typed);
  if (!Number.isFinite(value)) return { kind: "unreadable", text: typed };
  // "-0" and "+0" are nought, not the minus zero a comparison calls a different number.
  return { kind: "number", value: value === 0 ? 0 : value };
}

/** A whole number: a par, a slope, a count of players. "4.0" is not one, and neither is "4.5". */
export function readWhole(text: string | null | undefined): TypedFigure {
  const typed = plainFigure(text);
  if (typed === "") return { kind: "blank" };
  if (!/^[+-]?\d+$/.test(typed)) return { kind: "unreadable", text: typed };
  const value = Number(typed);
  if (!Number.isSafeInteger(value)) return { kind: "unreadable", text: typed };
  return { kind: "number", value: value === 0 ? 0 : value };
}

/**
 * The number, or what the box has decided to use where there is none.
 *
 * For a box whose blank and whose typo mean the same thing to it — a per-hole
 * yardage, which is optional and scores nothing. A box that must tell them
 * apart (a handicap: blank is "no index", a typo is a typo) reads `kind`.
 */
export function figureOr(read: TypedFigure, otherwise: number): number {
  return read.kind === "number" ? read.value : otherwise;
}
