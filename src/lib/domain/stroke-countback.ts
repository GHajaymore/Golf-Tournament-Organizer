/**
 * Separating two cards on the same score — the standard countback.
 *
 * Stroke play had no tiebreak at all. Two players on 72 finished 1st and 2nd
 * by whatever order the field array happened to be in, which is seed order,
 * silently and with no shared position anywhere. A club secretary needs an
 * answer to this every single week, and "the lower seed wins" is not one.
 *
 * The rule implemented here is the one the Committee Procedures recommend and
 * the one clubs actually print on the sheet: compare the LAST NINE holes, then
 * the last six, then the last three, then the final hole. It is a countback on
 * the same basis the competition was played on — net for a net competition,
 * gross for a scratch one — because a net comp separated on gross would hand
 * the prize to the low handicapper the countback exists to stop.
 *
 * Two deliberate departures from "just sort them":
 *
 *   - **A tie that survives every step stays a tie.** Players share the
 *     position (T2, T2, then 4th), which is what a results sheet prints and
 *     what tells a committee it has a play-off to run. Inventing an order
 *     there is the original defect wearing a better suit.
 *   - **The countback is only ever a tiebreak.** It never reorders players who
 *     are not level on the score itself.
 *
 * For a nine-hole competition the ladder starts at the last six — a "last
 * nine" of a nine-hole round is the whole round, which is the number that was
 * already equal.
 */

/** One player's card for countback purposes, on the basis being ranked. */
export interface CountbackCard {
  playerId: string;
  /** The competition score — net for a net comp, gross for a scratch one. */
  total: number;
  /**
   * Per-hole scores on the SAME basis as `total`, in hole order. A hole not
   * returned is null, which the countback treats as unplayable rather than
   * guessing.
   */
  holes: (number | null)[];
}

/**
 * The segments compared, in order, for a round of this many holes.
 *
 * Expressed as "how many holes from the end", which is exactly how the rule is
 * written and how a committee reads it off the card.
 */
export function countbackSegments(holeCount: number): number[] {
  if (holeCount >= 18) return [9, 6, 3, 1];
  if (holeCount >= 9) return [6, 3, 1];
  // Anything shorter than nine is a scratch fixture or a test; the only
  // meaningful cut left is the last hole.
  return holeCount > 1 ? [1] : [];
}

/** Sum of the last `n` holes, or null when any of them was not returned. */
function tailTotal(holes: (number | null)[], n: number): number | null {
  if (holes.length < n) return null;
  let sum = 0;
  for (let i = holes.length - n; i < holes.length; i += 1) {
    const v = holes[i];
    if (v == null || !Number.isFinite(v)) return null;
    sum += v;
  }
  return sum;
}

/**
 * Compare two cards by countback. Negative means `a` ranks ahead.
 *
 * Returns 0 when the countback cannot separate them — either because they
 * matched at every step, or because a card is incomplete. An incomplete card
 * is NOT ranked behind a complete one: a countback is a tiebreak between two
 * finished rounds, and using it to punish a missing hole would decide a
 * competition on a data-entry gap.
 */
export function countbackCompare(
  a: CountbackCard,
  b: CountbackCard,
  holeCount: number,
  /**
   * Which way the numbers run.
   *
   * Strokes: fewer is better, and that is the default so every existing caller
   * keeps its meaning. POINTS: more is better, and comparing them the other way
   * round hands a Stableford tie to whoever scored least.
   *
   * A parameter rather than negating at the call site, because the direction is
   * a fact about the basis being compared and belongs next to the comparison.
   */
  higherWins = false,
): number {
  for (const n of countbackSegments(holeCount)) {
    const ta = tailTotal(a.holes, n);
    const tb = tailTotal(b.holes, n);
    if (ta === null || tb === null) return 0;
    if (ta !== tb) return higherWins ? tb - ta : ta - tb;
  }
  return 0;
}

export interface CountbackRanked<T extends CountbackCard> {
  card: T;
  /** 1-based. Shared by everyone still level after the countback. */
  rank: number;
  /** True when somebody else holds the same position. */
  tied: boolean;
  /** How far the countback got, for the results sheet: "last 6", or "" . */
  separatedBy: string;
}

/**
 * Rank a field, breaking ties by countback and leaving real ties tied.
 *
 * Stable: cards level on everything keep the order they arrived in, so two
 * runs over the same field produce the same sheet.
 */
export function rankByCountback<T extends CountbackCard>(
  cards: T[],
  holeCount: number,
): CountbackRanked<T>[] {
  const ordered = cards
    .map((card, at) => ({ card, at }))
    .sort((x, y) => {
      if (x.card.total !== y.card.total) return x.card.total - y.card.total;
      const cb = countbackCompare(x.card, y.card, holeCount);
      if (cb !== 0) return cb;
      return x.at - y.at;
    });

  const out: CountbackRanked<T>[] = [];
  for (let i = 0; i < ordered.length; i += 1) {
    const { card } = ordered[i];
    const prev = i > 0 ? ordered[i - 1].card : null;
    // Level on the score AND unseparated by countback: the same position.
    const sharesWithPrev =
      prev !== null &&
      prev.total === card.total &&
      countbackCompare(prev, card, holeCount) === 0;

    const rank = sharesWithPrev ? out[i - 1].rank : i + 1;
    out.push({ card, rank, tied: false, separatedBy: "" });
    if (sharesWithPrev) out[i - 1].tied = true;
    if (sharesWithPrev) out[i].tied = true;
  }

  // Label how each player was separated from the one above, for the sheet.
  for (let i = 1; i < out.length; i += 1) {
    const above = out[i - 1].card;
    const here = out[i].card;
    if (above.total !== here.total) continue;
    for (const n of countbackSegments(holeCount)) {
      const ta = tailTotal(above.holes, n);
      const tb = tailTotal(here.holes, n);
      if (ta === null || tb === null) break;
      if (ta !== tb) {
        out[i].separatedBy = n === 1 ? "last hole" : `last ${n}`;
        break;
      }
    }
  }

  return out;
}
