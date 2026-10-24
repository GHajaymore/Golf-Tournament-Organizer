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
  return countbackBetween(a, b, holeCount, higherWins).order;
}

/**
 * WHAT A COUNTBACK FOUND, AND WHERE — the comparison above with its working
 * kept (2026-10-24, "every figure explains itself").
 *
 * `countbackCompare` IS this function's `order`, so a board that ranks two
 * players by countback and the sentence that says why cannot disagree: they are
 * one call. `decidedBy` is the step that separated them — how many holes from
 * the end, and each card's total over them — or null when nothing did, and then
 * `incomplete` says whether that was because a card is not finished (a countback
 * reads finished cards) or because the cards are level at every step.
 */
export interface CountbackDecision {
  /** Negative when `a` ranks ahead, positive when `b` does, 0 when level. */
  order: number;
  decidedBy: { holes: number; a: number; b: number } | null;
  /** The steps the two were level on before it was decided (or all of them). */
  levelOn: number[];
  /** A card was not complete over a step, so the countback could not be read. */
  incomplete: boolean;
}

export function countbackBetween(
  a: CountbackCard,
  b: CountbackCard,
  holeCount: number,
  higherWins = false,
): CountbackDecision {
  const levelOn: number[] = [];
  for (const n of countbackSegments(holeCount)) {
    const ta = tailTotal(a.holes, n);
    const tb = tailTotal(b.holes, n);
    if (ta === null || tb === null) return { order: 0, decidedBy: null, levelOn, incomplete: true };
    if (ta !== tb) {
      return { order: higherWins ? tb - ta : ta - tb, decidedBy: { holes: n, a: ta, b: tb }, levelOn, incomplete: false };
    }
    levelOn.push(n);
  }
  return { order: 0, decidedBy: null, levelOn, incomplete: false };
}

/** The same decision read from the other card's side: `b` becomes `a`. */
export function fromTheOtherSide(d: CountbackDecision): CountbackDecision {
  return {
    ...d,
    order: d.order === 0 ? 0 : -d.order,
    decidedBy: d.decidedBy ? { holes: d.decidedBy.holes, a: d.decidedBy.b, b: d.decidedBy.a } : null,
  };
}

/** What a stroke competition may be decided on. */
export type RankingBasis = "stableford" | "gross" | "net";

/**
 * A STROKE ROW, MADE COMPARABLE BETWEEN PLAYERS WHO HAVE PLAYED DIFFERENT
 * NUMBERS OF HOLES.
 *
 * A raw total only compares like with like. After the last card is in every
 * player has played the same holes and a total is exactly right; DURING a
 * round it is not, because a player through nine has a lower total than a
 * player through eighteen for no reason but arithmetic — and the board ranked
 * them first.
 *
 * Measured on the fixture 2026-09-18: four players all level par, ordered
 * 34, 56, 60, 63 by net, the 34 being nine holes. So the club's live board
 * named as leader whoever had played least, on the screen in the clubhouse.
 *
 * `parThru` is the missing term for strokes — par for the holes THAT PLAYER
 * played — and `levelPoints` is its twin for points. Both turn a running total
 * into a figure that means the same thing at any stage, and both collapse to a
 * constant once everybody has finished, so a completed round ranks exactly as
 * it always did.
 *
 * LEVEL POINTS COME FROM THE CALLER because the two Stableford variants do not
 * agree about what level is: ordinary Stableford pays 2 for a net par, and
 * Modified pays 0 and goes negative for a bogey. `rankingBasis` is
 * "stableford" for both, so this type cannot tell them apart and must not
 * guess — a wrong constant here would reorder a Modified board silently, which
 * is the failure the raw total already was.
 *
 * Taken on 2026-09-20 on Ajay's word, deferred until then because it moves the
 * cut line and the qualification bubble as well as the board. That is the
 * point rather than a side effect: a cut taken mid-round off raw totals cuts
 * on how far round people are.
 */
export interface BasisScore {
  gross: number;
  net: number;
  points: number;
  /** Par for the holes this player has actually played. */
  parThru: number;
  /** What a level round scores over the holes this player has played. */
  levelPoints: number;
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
  // Relative to what the holes played were worth, never the raw total — see
  // the note on `BasisScore`. Identical ordering once everyone is round,
  // because the term subtracted is then the same for all of them.
  if (basis === "stableford") return s.points - s.levelPoints;
  return (basis === "gross" ? s.gross : s.net) - s.parThru;
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
