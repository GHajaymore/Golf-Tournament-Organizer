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

/** What a stroke competition may be decided on. */
export type RankingBasis = "stableford" | "gross" | "net";

/** The three numbers a stroke row carries; one of them is the competition. */
export interface BasisScore {
  gross: number;
  net: number;
  points: number;
}

/**
 * THE ONE NUMBER THIS COMPETITION IS DECIDED BY — and nothing else.
 *
 * The file above says it twice: the countback runs "on the same basis the
 * competition was played on", because "a net comp separated on gross would
 * hand the prize to the low handicapper the countback exists to stop". Both
 * were fixed inside the countback. The SORT that feeds it was not.
 *
 * It compared `x.gross - y.gross || x.net - y.net` on a gross competition and
 * `x.net - y.net || x.gross - y.gross` on a net one. So two players level on
 * the score the competition is actually decided by were separated by the score
 * it is NOT decided by — silently, before the countback was ever consulted,
 * and by a rule no club publishes and no screen names.
 *
 * MEASURED on the seeded Demo Cup, 2026-09-15, a GROSS competition:
 *
 *     rank 3  gross 70  net 64  Elena Petrova
 *     rank 4  gross 70  net 65  Sang-woo Kim
 *     rank 5  gross 70  net 68  AJ
 *
 * Three players level on gross, given three different places off their net
 * scores — in a scratch competition, where handicap is the thing the format
 * exists to exclude. The player's own Rules tab meanwhile told all three:
 * "Countback: last 9 holes, then last 6, then last 3, then the final hole. A
 * tie that survives shares the place." Neither half of that sentence had
 * happened.
 *
 * The same fault runs the other way on a net competition, where it is the
 * worse of the two: a tie on net broken by gross hands the place to the lower
 * handicapper, which is exactly the outcome the paragraph at the top of this
 * file describes and refuses.
 */
export function scoreOnBasis(s: BasisScore, basis: RankingBasis): number {
  return basis === "stableford" ? s.points : basis === "gross" ? s.gross : s.net;
}

/**
 * Negative when `x` finishes ahead. Zero means LEVEL, and level belongs to the
 * countback — never to a second score the competition does not use.
 */
export function compareOnBasis(x: BasisScore, y: BasisScore, basis: RankingBasis): number {
  // Points run the other way: most wins.
  return basis === "stableford"
    ? scoreOnBasis(y, basis) - scoreOnBasis(x, basis)
    : scoreOnBasis(x, basis) - scoreOnBasis(y, basis);
}

/** Whether two rows are level on the score, and so owed a countback. */
export function levelOnBasis(x: BasisScore, y: BasisScore, basis: RankingBasis): boolean {
  return compareOnBasis(x, y, basis) === 0;
}
