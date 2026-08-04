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
    strokesReceived += strokeIndex ? holeStrokesReceived(handicap, strokeIndex[i] ?? 18) : Math.round(handicap) / strokes.length;
  }
  return {
    gross,
    front,
    back,
    played,
    net: gross - Math.round(strokesReceived),
    toPar: gross - parPlayed,
  };
}

export function toParText(toPar: number): string {
  if (toPar === 0) return "E";
  return toPar > 0 ? `+${toPar}` : `${toPar}`;
}
