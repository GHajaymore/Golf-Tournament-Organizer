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
 * A hole-by-hole match result, or null when the payload is not one.
 *
 * `expected` is the round's own hole count. The array must match it exactly:
 * a nine-hole round scored over eighteen entries is not a long round, it is a
 * different round, and accepting it would let the tiebreakers read holes that
 * were never played.
 */
export function cleanHoleResults(raw: unknown, expected: number): HoleResult[] | null {
  if (!Array.isArray(raw)) return null;
  const want = Math.min(MAX_HOLES, Math.max(1, Math.round(expected)));
  if (raw.length !== want) return null;
  const out: HoleResult[] = [];
  for (const v of raw) {
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
  const want = Math.min(MAX_HOLES, Math.max(1, Math.round(expected)));
  if (raw.length !== want) return null;
  const out: (number | null)[] = [];
  for (const v of raw) {
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
