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
 * Standard USGA/R&A stroke allocation for a single hole: one stroke per full
 * lap of the card in the course handicap, plus one more on the hardest
 * `h % holeCount` holes by stroke index (1 = hardest).
 *
 * `holeCount` is the number of holes strokes are being spread across — 18 for
 * a full round, 9 for a nine-hole one. It was hardcoded to 18, which quietly
 * swallowed strokes in nine-hole rounds: a nine-hole course handicap of 10
 * allocated only 9 (SI 1–9 once each, the tenth lost) instead of a second
 * stroke landing on SI 1. Exactly the players the allowance exists for.
 */
export function holeStrokesReceived(courseHandicap: number, strokeIndex: number, holeCount = 18): number {
  const h = Math.round(courseHandicap);
  const n = holeCount === 9 ? 9 : 18;

  /**
   * A PLUS HANDICAP GIVES STROKES BACK, and the arithmetic above cannot say so.
   *
   * Two pieces of JavaScript conspire. `Math.floor` rounds toward negative
   * infinity, so `Math.floor(-2 / 18)` is -1 rather than 0 — a stroke handed
   * back on EVERY hole. And `%` keeps the sign of the left operand, so
   * `-2 % 18` is -2, and no stroke index in 1..18 is ever `<= -2`, so the
   * second term never fires to correct it.
   *
   * The result was that a plus-2 gave back EIGHTEEN strokes instead of two —
   * and so did a plus-1 and a plus-5, because the magnitude was discarded
   * entirely. The best player in the field was scored about sixteen shots
   * worse than they played, in net stroke play, Stableford points, team cards,
   * net skins and every settle-up that reads them.
   *
   * The correct allocation is the mirror of receiving: strokes come back on
   * the EASIEST holes first (highest stroke index), where a receiving player
   * would be given them last. WHS puts a plus-2's two strokes on SI 18 and 17.
   */
  if (h < 0) {
    const given = -h;
    const back = Math.floor(given / n) + (strokeIndex > n - (given % n) ? 1 : 0);
    // Negating zero yields -0, which is not 0 to Object.is, renders as "-0" on
    // a scorecard, and survives arithmetic into a net total.
    return back === 0 ? 0 : -back;
  }

  return Math.floor(h / n) + (strokeIndex <= h % n ? 1 : 0);
}

/**
 * The wrap base for a round, from its stroke-index array.
 *
 * Snapped to the only cards golf is played on: nine holes or eighteen. Callers
 * pass the round's own SI array, which the app slices to the round length — so
 * nine means a nine-hole round, and anything else (including the short arrays
 * tests use as shorthand) allocates on the standard eighteen. Inferring the
 * base from the raw length made a one-hole fixture hand out eighteen strokes
 * on one hole, which is not a competition anyone has played.
 */
export function allocationHoles(strokeIndexLength: number): 9 | 18 {
  return strokeIndexLength === 9 ? 9 : 18;
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
  /**
   * What the ROUND says, where the caller knows it better than this function can.
   *
   * Both of these were faults on the one screen that calls this. The entry card
   * printed a net total and a Stableford total derived from the raw Handicap
   * INDEX passed as `handicap`, while the dots printed beside them came from the
   * server-resolved Playing Handicap — three to five strokes apart on the same
   * screen, and one stroke apart at minimum, since Stroke Play carries a 95%
   * allowance and needs no course ratings to diverge. And it scored a Modified
   * Stableford round on the STANDARD table: two eagles and sixteen pars read 40
   * on the card and 10 on the board.
   *
   * Both are answered by letting the caller supply the truth it already holds,
   * rather than by this function guessing from an index.
   */
  opts?: {
    /**
     * Per-hole strokes received, resolved on the server.
     *
     * Wins over `handicap` outright when present. `PlayerCard.tsx` was fixed
     * this way already and its comment names this defect by location; this is
     * the same fix on the screen that comment points at.
     */
    shotsPerHole?: number[];
    /**
     * The points table this format is played on.
     *
     * Defaults to standard Stableford, which is what every existing caller
     * means. The services pick their table with `stablefordTableFor`, which
     * keys by stage because points accumulate across rounds; a screen scoring
     * one round already knows its format and asks `boardKind` directly. Either
     * way the choice is made by the caller, which is the only place that can
     * make it — this function has never been told which competition it is in.
     */
    pointsForHole?: (grossOnHole: number, par: number, strokesOnHole: number) => number;
  },
): StrokeCard {
  const pointsForHole = opts?.pointsForHole ?? stablefordPointsForHole;
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
    /**
     * The round's own allocation first, then this function's best guess.
     *
     * A caller that already knows what the server allocated must not have it
     * recomputed from an index here — that is precisely how the totals and the
     * dots on the entry card came to disagree.
     */
    const holeStrokes =
      opts?.shotsPerHole
        ? (opts.shotsPerHole[i] ?? 0)
        : strokeIndex
          ? holeStrokesReceived(handicap, strokeIndex[i] ?? 18, allocationHoles(strokeIndex.length))
          : Math.round(handicap) / strokes.length;
    strokesReceived += holeStrokes;
    points += pointsForHole(s, pars[i] ?? 0, holeStrokes);
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

/**
 * Re-rank a slice of a card's stroke index to 1..N for the holes being played.
 *
 * A stroke index is a ranking of eighteen holes against each other. Take nine
 * of them for a front- or back-nine game and the numbers that come with them
 * are still 1..18 — the front nine of a normal card carries the odd values
 * 1,3,5,…,17 — but the allocation has to compare them against 1..9.
 *
 * Left un-ranked, the comparison `strokeIndex <= handicap % 9` is false for
 * nearly every hole, so every player received exactly `floor(handicap / 9)`
 * strokes: a blanket one-a-hole for anyone from 9 to 17, and none at all below
 * 9. In a Thursday-night nine where the field is bunched, that hands the same
 * stroke to everybody, every hole halves, no skin is ever won outright, and
 * the pot refunds itself. It is the reason this was reported as "the pot never
 * pays".
 *
 * Ranking preserves the relative difficulty the club set, which is the only
 * thing the eighteen-hole numbers are really saying. Ties keep their input
 * order, so a card with a duplicated index still yields distinct ranks rather
 * than two holes sharing one.
 */
export function rankStrokeIndex(sliced: number[]): number[] {
  const order = sliced
    .map((si, at) => ({ si: Number.isFinite(si) ? si : Number.MAX_SAFE_INTEGER, at }))
    .sort((a, b) => a.si - b.si || a.at - b.at);
  const ranks = new Array<number>(sliced.length);
  order.forEach((entry, i) => {
    ranks[entry.at] = i + 1;
  });
  return ranks;
}
