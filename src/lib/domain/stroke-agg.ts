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
  /**
   * No more holes are coming for this card.
   *
   * Absent (the ordinary stroke-play case) means the round is still open, so a
   * gap is a hole not yet played rather than a hole never played. Match cards
   * set it — a match won 5&4 leaves four holes that will never be returned.
   * See `stoppedShort`.
   */
  finished?: boolean;
}

export interface StrokeAgg {
  gross: number;
  /** Holes actually played, so a partial round still ranks honestly. */
  thru: number;
  /** Par for the holes played — not for the whole course. */
  parThru: number;
  /**
   * Holes the cards counted here cover — the length of each round's card,
   * summed over the cards seen. `thru` against this is "14 of 18".
   *
   * Counted per CARD rather than per round, because a Round Robin stage holds
   * the whole round robin: three matches inside one round is three cards and
   * three eighteens owed.
   */
  holesOwed: number;
  /**
   * A card stopped short: FINISHED, with holes that were never played.
   *
   * The 5&4 case, and the one thing that decides whether this player is ranked
   * on a stroke board. Rule 3.2b — a conceded hole has no score, and nothing
   * may invent one for it. Neither "rank on holes played" (14 against somebody
   * else's 18 look comparable and are not) nor net double bogey (right for a
   * handicap record, wrong on a results board) is available here, so the honest
   * answer is to show the card and leave the player unranked.
   *
   * False while a round is merely in progress, which is what keeps an ordinary
   * live leaderboard — "thru 12, −1" — ranking exactly as it always has.
   */
  stoppedShort: boolean;
  strokesReceived: number;
  points: number;
  /**
   * Per-hole scores, kept per round, for the countback.
   *
   * Keyed by stage rather than concatenated, because a countback reads the
   * LAST ROUND'S card — "the last nine" means the closing nine of the round
   * just played, not the tail of a two-day total. Concatenating would also
   * make the answer depend on the order the cards happened to be queried in,
   * which is the defect this whole feature exists to remove.
   *
   * Both bases are carried because the countback must run on whichever one the
   * competition was played on: a net comp separated on gross hands the prize
   * to exactly the low handicapper a countback exists to stop.
   *
   * EMPTIED where a player holds more than one card for the same round — see
   * `aggregateStroke`. A countback reads a card; it cannot read two at once.
   */
  holesByStage: Map<string, { gross: (number | null)[]; net: (number | null)[] }>;
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
  holesOwed: 0,
  stoppedShort: false,
  strokesReceived: 0,
  points: 0,
  holesByStage: new Map(),
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
  /**
   * How many cards each player has returned for each round.
   *
   * One, for every card that comes out of `Scorecard` — the table is unique on
   * `(stageId, playerId)`. Match cards broke that assumption: a Round Robin
   * stage holds the whole round robin, so a flight of four gives each player
   * three matches, three cards, and one stage. The totals add up correctly (par
   * and strokes received both accumulate per hole played), but the countback
   * cannot: `holesByStage.set` would silently keep whichever card was queried
   * last and separate a tie on it.
   */
  const cardsPerStage = new Map<string, number>();

  for (const card of cards) {
    // Per card, not once for the run: two rounds of the same tournament can be
    // at different clubs, and the allocation is a fact about the card in front
    // of the player.
    const { pars, holeDifficulty } = opts.courseFor(card.stageId);
    const alloc = opts.allocationHoles(holeDifficulty.length);
    const handicap = opts.handicapFor(card.playerId, card.stageId);
    const a = out.get(card.playerId) ?? emptyAgg();

    // This round's card, hole by hole, for the countback. Sized to the round
    // rather than to what was returned, so an unplayed hole stays null and the
    // countback can tell "did not finish" from "finished well".
    const perHole = {
      gross: Array.from({ length: card.strokes.length }, () => null) as (number | null)[],
      net: Array.from({ length: card.strokes.length }, () => null) as (number | null)[],
    };

    let returned = 0;
    card.strokes.forEach((s, i) => {
      if (typeof s !== "number" || s <= 0) return;
      returned += 1;
      a.gross += s;
      a.thru += 1;
      a.parThru += pars[i] ?? 0;
      const holeStrokes = opts.holeStrokesReceived(handicap, holeDifficulty[i] ?? 18, alloc);
      a.strokesReceived += holeStrokes;
      a.points += opts.stablefordPointsForHole(s, pars[i] ?? 0, holeStrokes);
      perHole.gross[i] = s;
      perHole.net[i] = s - holeStrokes;
    });

    // The round's own card decides how many holes are owed, not the length of
    // whatever array was stored — a nine-hole round played off an eighteen-hole
    // course is nine.
    a.holesOwed += pars.length;
    // A finished card with gaps is the 5&4 case: those holes were conceded and
    // will never be played. See StrokeAgg.stoppedShort.
    if (card.finished && returned < pars.length) a.stoppedShort = true;

    const key = `${card.playerId} ${card.stageId}`;
    const seen = (cardsPerStage.get(key) ?? 0) + 1;
    cardsPerStage.set(key, seen);
    // The first card for a round is that round's countback card. A second one
    // means the question has no single answer, so the entry is emptied rather
    // than overwritten — `countbackCompare` reads an empty card as "cannot
    // separate", which is the treatment it already gives an incomplete one.
    a.holesByStage.set(card.stageId, seen === 1 ? perHole : { gross: [], net: [] });

    out.set(card.playerId, a);
  }

  return out;
}

/** Net is gross less the strokes received, rounded once at the end. */
export const netOf = (a: StrokeAgg): number => a.gross - Math.round(a.strokesReceived);

/**
 * Whether this player takes a POSITION on a stroke/to-par board.
 *
 * The one reader of that rule, so a board, a cut and a qualification list can
 * never disagree about who is on the sheet — which they already have once, over
 * who advances.
 *
 * Three states, and the middle one is the reason this is not simply "is the
 * card complete":
 *
 *   - complete card                → ranked.
 *   - incomplete, still in play    → ranked, provisionally. An ordinary live
 *                                    leaderboard reads "thru 12, −1" and always
 *                                    has; nothing here changes it.
 *   - finished but incomplete      → SHOWN, not ranked. The 5&4 card.
 *
 * Note what this does NOT decide: whether the match is settled, whether the
 * round is complete, or whether its pots pay out. Those are a different
 * question with a different answer for the same match — `matchSettled` — and
 * merging the two is the defect `docs/scoring-input-model.md` was written to
 * prevent.
 */
export const isRanked = (a: StrokeAgg): boolean => a.thru > 0 && !a.stoppedShort;
