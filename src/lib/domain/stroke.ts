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

/**
 * Modified Stableford points for one hole.
 *
 * The point of the variant is that it changes how you play rather than just
 * how you count: birdies and eagles are worth enough to justify going for a
 * green, and a bogey costs you, so laying up all day loses. The scale below is
 * the widely used one (albatross 8, eagle 5, birdie 2, par 0, bogey -1, worse
 * -3); tours and clubs run their own variants, so this is a default rather
 * than a rule.
 *
 * Unlike standard Stableford there is no floor at zero — a blow-up hole is
 * meant to hurt.
 */
export function modifiedStablefordForHole(
  grossOnHole: number,
  par: number,
  strokesOnHole: number,
): number {
  const net = grossOnHole - strokesOnHole;
  const diff = net - par;
  if (diff <= -3) return 8; // albatross or better
  if (diff === -2) return 5; // eagle
  if (diff === -1) return 2; // birdie
  if (diff === 0) return 0; // par
  if (diff === 1) return -1; // bogey
  return -3; // double bogey or worse
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

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

/**
 * Parse a spoken sequence of hole scores — digits, number words ("four"),
 * or par/birdie/eagle/bogey/double/triple relative to each hole's par — into
 * gross strokes, starting at `startIndex` and advancing one hole per
 * recognized token. Unrecognized filler words ("and", "then") are skipped.
 */
export function parseStrokesTranscript(transcript: string, pars: number[], startIndex: number): number[] {
  const tokens = transcript.toLowerCase().replace(/-/g, " ").split(/[\s,]+/).filter(Boolean);
  const results: number[] = [];
  let hole = startIndex;
  let j = 0;
  while (j < tokens.length && hole < pars.length) {
    const t = tokens[j];
    const par = pars[hole] ?? 4;
    if (t === "double" && tokens[j + 1] === "bogey") { results.push(par + 2); j += 2; hole += 1; continue; }
    if (t === "triple" && tokens[j + 1] === "bogey") { results.push(par + 3); j += 2; hole += 1; continue; }
    if (t === "double") { results.push(par + 2); j += 1; hole += 1; continue; }
    if (t === "triple") { results.push(par + 3); j += 1; hole += 1; continue; }
    if (t === "bogey") { results.push(par + 1); j += 1; hole += 1; continue; }
    if (t === "par") { results.push(par); j += 1; hole += 1; continue; }
    if (t === "birdie") { results.push(par - 1); j += 1; hole += 1; continue; }
    if (t === "eagle") { results.push(par - 2); j += 1; hole += 1; continue; }
    if (t === "albatross") { results.push(par - 3); j += 1; hole += 1; continue; }
    if (/^\d+$/.test(t)) { results.push(parseInt(t, 10)); j += 1; hole += 1; continue; }
    if (t in NUMBER_WORDS) { results.push(NUMBER_WORDS[t]); j += 1; hole += 1; continue; }
    j += 1;
  }
  return results;
}
