import { describe, it, expect } from "vitest";
import { aggregateStroke, emptyAgg, netOf, type StrokeCard } from "../stroke-agg";
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
    expect(emptyAgg()).toEqual({ gross: 0, thru: 0, parThru: 0, strokesReceived: 0, points: 0 });
  });

  it("rounds the net once, at the end", () => {
    // Rounding each round's strokes received and then adding is how a two-round
    // net total drifts a shot from the sum of its own cards.
    const a = aggregateStroke([card("r1", 5), card("r2", 5)], opts(() => HOME, 9)).get("p1")!;
    expect(netOf(a)).toBe(a.gross - Math.round(a.strokesReceived));
  });
});
