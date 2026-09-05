import { describe, it, expect } from "vitest";
import { aggregateStroke, emptyAgg, isRanked, netOf, type StrokeCard } from "../stroke-agg";
import { holeStrokesReceived, stablefordPointsForHole, allocationHoles } from "../index";

/**
 * Adding up stroke-play cards across rounds.
 *
 * The 2026-08-12 audit's stroke-play block. This function took ONE par and
 * stroke-index array for every card it was given, so a tournament played over
 * two courses scored the second round against the first course's card — every
 * net score, every to-par figure and every Stableford point computed from the
 * wrong holes. `Stage.courseId` was already stored and `courseForRound` had
 * zero production callers.
 *
 * The arithmetic is asserted against the Rules of Handicapping: strokes are
 * received hole by hole off that hole's stroke index (Rule 6.2a), so a net
 * score is meaningful through nine as well as eighteen.
 */

/** An 18-hole par 72 with a conventional 1..18 stroke index. */
const HOME = {
  pars: new Array(18).fill(4) as number[],
  holeDifficulty: Array.from({ length: 18 }, (_, i) => i + 1),
};

/**
 * Par 70 (36 out, 34 in), with the stroke index running the other way — the
 * hardest hole is the 18th here and the 1st at home.
 */
const AWAY = {
  pars: [3, 5, 4, 4, 3, 4, 5, 4, 4, 4, 3, 4, 4, 4, 4, 3, 4, 4] as number[],
  holeDifficulty: Array.from({ length: 18 }, (_, i) => 18 - i),
};

const opts = (
  courseFor: (stageId: string) => { pars: number[]; holeDifficulty: number[] },
  handicap = 0,
) => ({
  courseFor,
  handicapFor: () => handicap,
  holeStrokesReceived,
  stablefordPointsForHole,
  allocationHoles,
});

const card = (stageId: string, strokes: number): StrokeCard => ({
  playerId: "p1",
  stageId,
  strokes: new Array(18).fill(strokes),
});

describe("a card is scored against the course it was played on", () => {
  it("takes par from the round, not from the tournament", () => {
    // Round 1 at the home course (par 72), round 2 away (par 70). Eighteen
    // fours at each is 72 twice: level par at home, two OVER at the away
    // course. Scoring both against par 72 reports the player level for the
    // tournament when they are two over.
    const cards = [card("r1", 4), card("r2", 4)];
    const agg = aggregateStroke(cards, opts((id) => (id === "r1" ? HOME : AWAY)));
    const a = agg.get("p1")!;

    expect(a.gross).toBe(144);
    expect(a.parThru, "par 72 + par 70").toBe(142);
    expect(a.gross - a.parThru, "two over for the tournament").toBe(2);
  });

  it("would have said level par when both rounds shared one card", () => {
    // The bug, stated as the difference it made.
    const cards = [card("r1", 4), card("r2", 4)];
    const wrong = aggregateStroke(cards, opts(() => HOME)).get("p1")!;
    expect(wrong.gross - wrong.parThru).toBe(0);
  });

  it("allocates handicap strokes off the round's own stroke index", () => {
    // Rule 6.2a: strokes are received on the holes with the lowest stroke
    // index. Over a full eighteen a 4-handicap receives four strokes whichever
    // course it is, so eighteen holes cannot tell the two allocations apart —
    // the front nine can. HOME's four hardest holes are 1-4 and AWAY's are
    // 15-18, so a player who plays only the front nine receives four strokes
    // at home and NONE away.
    const frontNine: StrokeCard = {
      playerId: "p1",
      stageId: "r1",
      strokes: [...new Array(9).fill(5), ...new Array(9).fill(null)],
    };
    const home = aggregateStroke([frontNine], opts(() => HOME, 4)).get("p1")!;
    const away = aggregateStroke([frontNine], opts(() => AWAY, 4)).get("p1")!;

    expect(home.gross, "the same nine scores, either way").toBe(away.gross);
    expect(home.strokesReceived).toBe(4);
    expect(away.strokesReceived).toBe(0);
    // Which is four shots of difference in the net score, from the stroke
    // index alone.
    expect(netOf(home)).toBe(netOf(away) - 4);
  });

  it("resolves the course once per round, not once per run", () => {
    // Two cards, two rounds, two courses, in one aggregate — the case a single
    // pars array cannot represent at all.
    const seen: string[] = [];
    aggregateStroke([card("r1", 4), card("r2", 4)], opts((id) => {
      seen.push(id);
      return id === "r1" ? HOME : AWAY;
    }));
    expect(seen).toEqual(["r1", "r2"]);
  });
});

describe("what it counts", () => {
  it("counts only holes actually played", () => {
    // A rained-off nine still ranks honestly: par is par for the holes played,
    // not for the whole course.
    const nine: StrokeCard = {
      playerId: "p1",
      stageId: "r1",
      strokes: [...new Array(9).fill(4), ...new Array(9).fill(null)],
    };
    const a = aggregateStroke([nine], opts(() => HOME)).get("p1")!;
    expect(a.thru).toBe(9);
    expect(a.gross).toBe(36);
    expect(a.parThru).toBe(36);
  });

  it("ignores a hole with no score rather than reading it as zero", () => {
    const gap: StrokeCard = { playerId: "p1", stageId: "r1", strokes: new Array(18).fill(4) };
    gap.strokes[5] = null;
    gap.strokes[6] = 0;
    const a = aggregateStroke([gap], opts(() => HOME)).get("p1")!;
    expect(a.thru).toBe(16);
    expect(a.gross).toBe(64);
  });

  it("gives an empty aggregate for a player with no card", () => {
    expect(aggregateStroke([], opts(() => HOME)).get("p1")).toBeUndefined();
    // holesByStage starts empty too — a player with no card has no round to
    // count back over, which is different from having a round of zeros.
    expect(emptyAgg()).toEqual({
      gross: 0,
      thru: 0,
      parThru: 0,
      // Nothing owed and nothing stopped short: a player with no card has not
      // failed to finish one. `isRanked` reads this as unranked on `thru`
      // alone, which is what keeps a field yet to tee off off the sheet.
      holesOwed: 0,
      stoppedShort: false,
      strokesReceived: 0,
      points: 0,
      holesByStage: new Map(),
    });
  });

  it("rounds the net once, at the end", () => {
    // Rounding each round's strokes received and then adding is how a two-round
    // net total drifts a shot from the sum of its own cards.
    const a = aggregateStroke([card("r1", 5), card("r2", 5)], opts(() => HOME, 9)).get("p1")!;
    expect(netOf(a)).toBe(a.gross - Math.round(a.strokesReceived));
  });
});

/**
 * A card that stopped short.
 *
 * Rule 3.2a(3): a match ends when one side leads by more holes than remain, so
 * a match won 5&4 leaves four holes that were never played. Rule 3.2b: a hole
 * or a match may be conceded, and a conceded hole carries no score at all.
 *
 * Nothing here may invent a number for those holes. Ranking on the holes
 * actually played would present fourteen against somebody else's eighteen as
 * comparable, and net double bogey — the right answer for a handicap record —
 * puts a score on a results board the player never made.
 */
describe("a finished card with holes that were never played", () => {
  /** Fourteen holes returned out of eighteen, as a 5&4 match leaves. */
  const short = (finished: boolean): StrokeCard => ({
    playerId: "p1",
    stageId: "r1",
    strokes: [...new Array(14).fill(4), null, null, null, null],
    finished,
  });

  it("is flagged as stopped short, and only when the match is over", () => {
    const done = aggregateStroke([short(true)], opts(() => HOME)).get("p1")!;
    expect(done.thru).toBe(14);
    expect(done.holesOwed).toBe(18);
    expect(done.stoppedShort).toBe(true);
    expect(isRanked(done)).toBe(false);

    // The identical card, mid-round. An ordinary live leaderboard reads "thru
    // 14" and ranks it, and always has; this must not regress.
    const live = aggregateStroke([short(false)], opts(() => HOME)).get("p1")!;
    expect(live.thru).toBe(14);
    expect(live.stoppedShort).toBe(false);
    expect(isRanked(live)).toBe(true);
  });

  it("leaves a finished card that went the distance ranked", () => {
    const full: StrokeCard = { playerId: "p1", stageId: "r1", strokes: new Array(18).fill(4), finished: true };
    const a = aggregateStroke([full], opts(() => HOME)).get("p1")!;
    expect(a.stoppedShort).toBe(false);
    expect(isRanked(a)).toBe(true);
  });

  it("counts holes owed off the round's own card, not the stored array", () => {
    // A nine-hole round is nine owed, however long the array happens to be.
    const nine = { pars: new Array(9).fill(4) as number[], holeDifficulty: [1, 2, 3, 4, 5, 6, 7, 8, 9] };
    const a = aggregateStroke(
      [{ playerId: "p1", stageId: "r1", strokes: new Array(9).fill(4), finished: true }],
      opts(() => nine),
    ).get("p1")!;
    expect(a.holesOwed).toBe(9);
    expect(a.stoppedShort).toBe(false);
  });

  it("does not rank a player who returned nothing", () => {
    expect(isRanked(emptyAgg())).toBe(false);
  });
});

/**
 * Two cards in one round.
 *
 * A Round Robin stage holds the whole round robin, so a flight of four gives
 * each player three matches — three cards, one round. The totals add up (par
 * and strokes received both accumulate per hole played); the countback cannot,
 * because it reads a card and there is no single card to read.
 */
describe("more than one card for the same round", () => {
  it("adds the totals and empties that round's countback card", () => {
    const a = aggregateStroke(
      [
        { playerId: "p1", stageId: "r1", strokes: new Array(18).fill(4) },
        { playerId: "p1", stageId: "r1", strokes: new Array(18).fill(5) },
      ],
      opts(() => HOME),
    ).get("p1")!;
    expect(a.thru).toBe(36);
    expect(a.gross).toBe(18 * 4 + 18 * 5);
    expect(a.holesOwed).toBe(36);
    // Emptied rather than left holding whichever card was queried last, which
    // would separate a tie on an arbitrary one of the two.
    // Points too: a Stableford countback reads that array, so leaving it
    // populated would separate a points tie on one arbitrary card of the two.
    expect(a.holesByStage.get("r1")).toEqual({ gross: [], net: [], points: [] });
  });

  it("keeps the countback card for a round the player played once", () => {
    const a = aggregateStroke(
      [
        { playerId: "p1", stageId: "r1", strokes: new Array(18).fill(4) },
        { playerId: "p1", stageId: "r2", strokes: new Array(18).fill(5) },
      ],
      opts(() => HOME),
    ).get("p1")!;
    expect(a.holesByStage.get("r1")!.gross).toHaveLength(18);
    expect(a.holesByStage.get("r2")!.gross).toHaveLength(18);
  });
});
