/**
 * Adding up a stroke-play card.
 *
 * This arithmetic used to live inside loadEventState, which totals every card
 * in the event. That is right for a medal played over two days and wrong for a
 * league, where the question is always "what happened THIS week" — and the
 * obvious fix, writing the sum a second time for the weekly view, is how two
 * screens end up disagreeing about a player's net score.
 *
 * So it lives here, taking whichever cards it is given. The event totals pass
 * all of them; the weekly view passes one round's worth. One implementation,
 * so there is nothing to drift.
 *
 * Handicap resolution stays with the caller: which tee a player used and
 * whether a round is nine holes or eighteen are facts about the event, not
 * about addition.
 */

export interface StrokeCard {
  playerId: string;
  stageId: string;
  /** Per hole; null where nothing has been entered yet. */
  strokes: (number | null)[];
}

export interface StrokeAgg {
  gross: number;
  /** Holes actually played, so a partial round still ranks honestly. */
  thru: number;
  /** Par for the holes played — not for the whole course. */
  parThru: number;
  strokesReceived: number;
  points: number;
}

/** Par and stroke index for one round, as that round is actually played. */
export interface RoundCard {
  pars: number[];
  /** Stroke index per hole; 1 is hardest. */
  holeDifficulty: number[];
}

export interface StrokeAggOptions {
  /**
   * The course THIS card's round was played on.
   *
   * Was a single pars/holeDifficulty pair for every card in the event, which
   * is right for a medal at one club and wrong for anything else: a two-course
   * tournament scored round two against round one's par and stroke index, so
   * every net score, every to-par figure and every Stableford point on the
   * second course was computed from the wrong card. `Stage.courseId` existed
   * and `courseForRound` had zero production callers.
   */
  courseFor: (stageId: string) => RoundCard;
  /** Playing handicap for this player on this round, allowance already applied. */
  handicapFor: (playerId: string, stageId: string) => number;
  holeStrokesReceived: (handicap: number, si: number, allocationHoles: number) => number;
  stablefordPointsForHole: (strokes: number, par: number, holeStrokes: number) => number;
  allocationHoles: (holes: number) => number;
}

export const emptyAgg = (): StrokeAgg => ({
  gross: 0,
  thru: 0,
  parThru: 0,
  strokesReceived: 0,
  points: 0,
});

/**
 * Total the given cards per player.
 *
 * Strokes are allocated per hole actually played rather than by docking a full
 * handicap off a partial gross, so a net score is meaningful through nine as
 * well as through eighteen — which matters most in exactly the case this was
 * extracted for, a league night that gets rained off.
 */
export function aggregateStroke(cards: StrokeCard[], opts: StrokeAggOptions): Map<string, StrokeAgg> {
  const out = new Map<string, StrokeAgg>();

  for (const card of cards) {
    // Per card, not once for the run: two rounds of the same tournament can be
    // at different clubs, and the allocation is a fact about the card in front
    // of the player.
    const { pars, holeDifficulty } = opts.courseFor(card.stageId);
    const alloc = opts.allocationHoles(holeDifficulty.length);
    const handicap = opts.handicapFor(card.playerId, card.stageId);
    const a = out.get(card.playerId) ?? emptyAgg();

    card.strokes.forEach((s, i) => {
      if (typeof s !== "number" || s <= 0) return;
      a.gross += s;
      a.thru += 1;
      a.parThru += pars[i] ?? 0;
      const holeStrokes = opts.holeStrokesReceived(handicap, holeDifficulty[i] ?? 18, alloc);
      a.strokesReceived += holeStrokes;
      a.points += opts.stablefordPointsForHole(s, pars[i] ?? 0, holeStrokes);
    });

    out.set(card.playerId, a);
  }

  return out;
}

/** Net is gross less the strokes received, rounded once at the end. */
export const netOf = (a: StrokeAgg): number => a.gross - Math.round(a.strokesReceived);
