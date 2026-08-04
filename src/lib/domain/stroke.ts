// Stroke-play scoring: gross/net/to-par from per-hole gross strokes.

export interface StrokeCard {
  gross: number;
  front: number;
  back: number;
  played: number;
  /** Gross minus handicap strokes received on the holes played so far. */
  net: number;
  /** Gross minus par of holes played (e.g. -2, +3, 0 = level). */
  toPar: number;
  /** Stableford points earned on the holes played so far (higher is better). */
  points: number;
}

/**
 * Standard USGA/R&A stroke allocation for a single hole: a player gets one
 * extra stroke per full 18 in their course handicap, plus one more on the
 * `h % 18` hardest holes by stroke index (1 = hardest, 18 = easiest).
 */
export function holeStrokesReceived(courseHandicap: number, strokeIndex: number): number {
  const h = Math.round(courseHandicap);
  return Math.floor(h / 18) + (strokeIndex <= h % 18 ? 1 : 0);
}

/**
 * Standard Stableford points for one hole: 2 for a net par, +1 per stroke
 * better (birdie 3, eagle 4, ...), -1 per stroke worse, floored at 0 for a
 * net double-bogey or worse (a hole that bad simply scores nothing, rather
 * than going negative).
 */
export function stablefordPointsForHole(grossOnHole: number, par: number, strokesOnHole: number): number {
  const net = grossOnHole - strokesOnHole;
  return Math.max(0, 2 - (net - par));
}

export function computeStrokeCard(
  strokes: (number | null)[],
  pars: number[],
  handicap: number,
  strokeIndex?: number[],
): StrokeCard {
  let gross = 0;
  let front = 0;
  let back = 0;
  let played = 0;
  let parPlayed = 0;
  let strokesReceived = 0;
  let points = 0;
  for (let i = 0; i < strokes.length; i += 1) {
    const s = strokes[i];
    if (s == null || !Number.isFinite(s)) continue;
    gross += s;
    played += 1;
    parPlayed += pars[i] ?? 0;
    if (i < 9) front += s;
    else back += s;
    // Allocate strokes per hole actually played, so net is accurate mid-round
    // (not the full handicap subtracted against a partial gross). Falls back
    // to a flat full-handicap split if course stroke-index data is unknown.
    const holeStrokes = strokeIndex ? holeStrokesReceived(handicap, strokeIndex[i] ?? 18) : Math.round(handicap) / strokes.length;
    strokesReceived += holeStrokes;
    points += stablefordPointsForHole(s, pars[i] ?? 0, holeStrokes);
  }
  return {
    gross,
    front,
    back,
    played,
    net: gross - Math.round(strokesReceived),
    toPar: gross - parPlayed,
    points,
  };
}

export function toParText(toPar: number): string {
  if (toPar === 0) return "E";
  return toPar > 0 ? `+${toPar}` : `${toPar}`;
}
