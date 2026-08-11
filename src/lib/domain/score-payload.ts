/**
 * The boundary for scores arriving from a browser.
 *
 * Every score-writing action is typed — `Array<"A" | "B" | "H" | null>`,
 * `(number | null)[]` — and every one of those types is ERASED at runtime. A
 * server action is a public HTTP endpoint, so the argument that arrives is
 * whatever the caller sent, not whatever the signature claims.
 *
 * That mattered more than "somebody could store junk", because the stored
 * value is not inert. Its LENGTH drives scoring:
 *
 *   domain/match.ts        total = holes.length
 *   domain/nassau.ts       segments front/back on holes.length > 9
 *   domain/match-tiebreak  picks tiebreak holes from holes.length
 *
 * So an array of the wrong length does not merely sit in a column — it changes
 * how a match is segmented and ranked. A round-code holder could post forty
 * entries and produce a Nassau result the course cannot generate.
 *
 * Same discipline as card-reading.ts, which already treats model output as
 * hostile: parse rather than trust, and return null rather than coerce, so a
 * caller has to decide what a bad payload means instead of silently saving a
 * repaired version of it.
 */

export type HoleResult = "A" | "B" | "H" | null;

/** Nobody plays more than this in one round; a sane ceiling for any card. */
export const MAX_HOLES = 18;

/** The most strokes a single hole may record before it is obviously not real. */
export const MAX_STROKES_PER_HOLE = 30;

/**
 * Cap and pad to the round's own hole count.
 *
 * TOO LONG is refused, because that is the whole finding: extra entries are
 * read by nassau segmentation and by the tiebreakers, so a longer array
 * changes the result rather than the row.
 *
 * TOO SHORT is padded with nulls, not refused — and getting this wrong once
 * already broke something. Requiring an exact length looks stricter and is
 * simply incorrect, because short cards legitimately exist: a CSV imported
 * with nine columns, and more commonly a round set to nine holes, scored, and
 * then changed to eighteen. Every one of those cards is loaded into the editor
 * exactly as stored (see strokesFor in the entry page, which does not pad), so
 * an exact-length rule would make them permanently unsaveable — an organizer
 * hitting Save on a real card and being told it "doesn't match this round",
 * with no way to fix it.
 *
 * Padding also normalises storage, which is better than merely tolerating the
 * short array: the card comes back the right length for its round.
 */
function fit<T>(raw: unknown[], expected: number, pad: T): unknown[] {
  const want = Math.min(MAX_HOLES, Math.max(1, Math.round(expected)));
  const out = raw.slice(0, want);
  while (out.length < want) out.push(pad);
  return out;
}

/**
 * A hole-by-hole match result, or null when the payload is not one.
 *
 * Null means "this is not a card": a non-array, or an entry that is not a
 * result. A wrong length is a shape problem and is corrected; a wrong VALUE is
 * a content problem and is refused, because there is no honest way to guess
 * what "X" on the seventh was meant to be.
 */
export function cleanHoleResults(raw: unknown, expected: number): HoleResult[] | null {
  if (!Array.isArray(raw)) return null;
  const sized = fit<HoleResult>(raw, expected, null);
  const out: HoleResult[] = [];
  for (const v of sized) {
    if (v === null || v === undefined) {
      out.push(null);
      continue;
    }
    if (v !== "A" && v !== "B" && v !== "H") return null;
    out.push(v);
  }
  return out;
}

/**
 * A stroke-play card, or null when the payload is not one.
 *
 * Rejects rather than clamps. A 0 or a negative is not a score somebody meant
 * to enter, and quietly turning it into a 1 would put a number on a
 * leaderboard that no player wrote on a card.
 */
export function cleanStrokes(raw: unknown, expected: number): (number | null)[] | null {
  if (!Array.isArray(raw)) return null;
  const sized = fit<number | null>(raw, expected, null);
  const out: (number | null)[] = [];
  for (const v of sized) {
    if (v === null || v === undefined) {
      out.push(null);
      continue;
    }
    if (typeof v !== "number" || !Number.isInteger(v)) return null;
    if (v < 1 || v > MAX_STROKES_PER_HOLE) return null;
    out.push(v);
  }
  return out;
}

/** Who won a match, or null. Narrow enough that a typo cannot become a result. */
export function cleanWinner(raw: unknown): "A" | "B" | "H" | null {
  return raw === "A" || raw === "B" || raw === "H" ? raw : null;
}

/**
 * A margin such as "3&2", "2 up", "1 up" — free text a committee may word its
 * own way, so this bounds it rather than enumerating it.
 *
 * Long enough for anything a scorer writes, short enough that the field cannot
 * be used to store something else.
 */
export const MAX_MARGIN = 24;

export function cleanMargin(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().slice(0, MAX_MARGIN) : "";
}
