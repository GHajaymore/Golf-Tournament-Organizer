// Stroke-play scoring: gross/net/to-par from per-hole gross strokes.

export interface StrokeCard {
  gross: number;
  front: number;
  back: number;
  played: number;
  /** Gross minus rounded course handicap. */
  net: number;
  /** Gross minus par of holes played (e.g. -2, +3, 0 = level). */
  toPar: number;
}

export function computeStrokeCard(
  strokes: (number | null)[],
  pars: number[],
  handicap: number,
): StrokeCard {
  let gross = 0;
  let front = 0;
  let back = 0;
  let played = 0;
  let parPlayed = 0;
  for (let i = 0; i < strokes.length; i += 1) {
    const s = strokes[i];
    if (s == null || !Number.isFinite(s)) continue;
    gross += s;
    played += 1;
    parPlayed += pars[i] ?? 0;
    if (i < 9) front += s;
    else back += s;
  }
  return {
    gross,
    front,
    back,
    played,
    net: gross - Math.round(handicap),
    toPar: gross - parPlayed,
  };
}

export function toParText(toPar: number): string {
  if (toPar === 0) return "E";
  return toPar > 0 ? `+${toPar}` : `${toPar}`;
}
