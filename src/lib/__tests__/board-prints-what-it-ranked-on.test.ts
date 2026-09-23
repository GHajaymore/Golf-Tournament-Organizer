import { describe, expect, it } from "vitest";
import { chargedHoles, type StrokeAgg } from "../domain/stroke-agg";
import { compareOnBasis, scoreOnBasis, type BasisScore } from "../domain/stroke-countback";
import { rankedScore, toParCell, toParOnBasis, unitIsNet } from "../domain/ranked-score";
import type { RankingBasis } from "../domain/stroke-countback";

/**
 * ONE SENTENCE, EVERY UNIT: the number a board PRINTS runs in the order the
 * board is SORTED in.
 *
 * This has now been the same defect three times, on three different units, and
 * each time it was found by looking at a screen rather than by a test:
 *
 *   match points   a board headed "Ranked by match points", sorted by match
 *                  points, with no match points on it — every row a dash
 *   net strokes    the April Medal, 2026-09-22: sorted 53, 61, 63, 65 on net
 *                  and printing +10, +9, -1, +20, the GROSS to-par
 *   Stableford     the Thursday league, 2026-09-22: sorted on points-vs-level
 *                  and printing the raw total — 135, 170, 133, 128 down a
 *                  board captioned "Stableford points (higher is better)"
 *
 * The first two were fixed one at a time, and `verify-public-boards.mjs` pins
 * the rule — for the one board its fixture can build. A rule pinned on one cell
 * of a five-cell axis is how the same defect arrives a third time wearing a
 * different unit, so this enumerates the axis instead.
 *
 * It asserts over the ENGINE's own comparator and the two readers that print
 * for it — `rankedScore` for the player and public boards, `toParCell` for the
 * console table and Reports — because those two drifting apart is itself a
 * shipped defect this repo has had: the share link read -18 and the console
 * +10 about the same round on the same afternoon.
 *
 * WHAT THIS DOES NOT CLOSE, said here because a green file reads as a shut
 * door. Mutating `chargedHoles` back to the old behaviour turns the Stableford
 * cases red and leaves the two STROKE units green — correctly, because they
 * are asking a different question. A board can read perfectly downward and
 * still be ranked wrong: in the fixture below the absentee's one round at +4
 * out-ranks two rounds at +6, and the column is monotonic the whole way down.
 *
 * Points can express a missed round — it costs the points it was worth — and
 * strokes cannot, so the stroke answer is that the player holds no position at
 * all, which is `isRanked` rather than a printed cell. That needs a round to
 * know whether it is OVER, and nothing in the schema says so: `Stage` has
 * `holes` and `playedOn` and no status. "Not the active round" is good enough
 * for the level term, where every player carries the same charge and a future
 * empty round shifts the whole board by a constant — and nowhere near good
 * enough for unranking somebody, where it would unrank the entire field the
 * moment a round exists that nobody has played. In `docs/deferred-register.md`.
 */

const UNITS: { unit: string; basis: RankingBasis; isStableford: boolean }[] = [
  { unit: "gross strokes", basis: "gross", isStableford: false },
  { unit: "net strokes", basis: "net", isStableford: false },
  { unit: "Stableford points", basis: "stableford", isStableford: true },
  { unit: "modified Stableford points", basis: "stableford", isStableford: true },
];

/** A round's worth of holes, and the two rounds every case below is built on. */
const ROUNDS = [
  { id: "r1", holes: 18 },
  { id: "r2", holes: 18 },
];

function agg(played: Record<string, number>): Pick<StrokeAgg, "holesPlayedByStage"> {
  return { holesPlayedByStage: new Map(Object.entries(played)) };
}

/**
 * A row as `strokeStandings` builds one, with `levelPoints` taken from the
 * engine rather than restated here — restating it would let this test agree
 * with a broken engine.
 */
function row(opts: {
  gross: number;
  net: number;
  points: number;
  parThru: number;
  played: Record<string, number>;
  activeRoundId: string | null;
  levelPerHole: number;
}): BasisScore & { thru: number; toPar: number; parKnown: boolean } {
  const thru = Object.values(opts.played).reduce((a, b) => a + b, 0);
  return {
    gross: opts.gross,
    net: opts.net,
    points: opts.points,
    parThru: opts.parThru,
    levelPoints:
      opts.levelPerHole * chargedHoles(agg(opts.played), ROUNDS, opts.activeRoundId),
    thru,
    toPar: opts.gross - opts.parThru,
    parKnown: opts.parThru > 0,
  };
}

/** What each reader actually puts in the cell, for a board on this unit. */
function printedCells(
  rows: ReturnType<typeof row>[],
  unit: string,
  isStableford: boolean,
): { fromRankedScore: number[]; fromToParCell: string[] } {
  const isNet = unitIsNet(unit);
  return {
    fromRankedScore: rows.map((r) => {
      const printed = rankedScore(
        {
          pts: "",
          points: r.points,
          // The engine hands out the to-par of the figure it ranked on; both
          // readers print what they are given. See `standingRows`.
          toPar: toParOnBasis(r, isNet),
          thru: r.thru,
          holesOwed: 36,
          parKnown: r.parKnown,
          started: true,
        },
        { isStroke: true, isStableford, isNet },
      );
      return Number(printed.text.replace(/^E$/, "0").replace("+", ""));
    }),
    fromToParCell: rows.map((r) =>
      isStableford ? String(r.points) : toParCell({ toPar: toParOnBasis(r, isNet), parKnown: r.parKnown }),
    ),
  };
}

/** Strictly non-improving down the board, on whichever way this unit runs. */
function readsDownward(cells: number[], higherWins: boolean): boolean {
  for (let i = 1; i < cells.length; i += 1) {
    if (higherWins ? cells[i] > cells[i - 1] : cells[i] < cells[i - 1]) return false;
  }
  return true;
}

describe("a board prints the figure it ranked on", () => {
  /**
   * THE CASE THAT BROKE, generalised: a two-round competition, settled, in
   * which the players did not all play both rounds.
   *
   * It is the only shape that separates "has not played those holes yet" from
   * "did not turn up", and every board in the app had been looked at in the
   * other one.
   */
  for (const { unit, basis, isStableford } of UNITS) {
    it(`${unit}: a settled two-round board with uneven attendance reads downward`, () => {
      const levelPerHole = unit === "modified Stableford points" ? 0 : 2;
      const mk = (played: Record<string, number>, gross: number, net: number, points: number) =>
        row({
          gross,
          net,
          points,
          // Par 72 a round, charged for the rounds this player actually played.
          parThru: 72 * Object.keys(played).length,
          played,
          activeRoundId: null, // settled: nothing in flight
          levelPerHole,
        });

      // Two full attendances and one player who missed the second round. The
      // absentee's raw totals are SMALLER on every unit, which is the trap:
      // fewer strokes reads as better, and fewer points reads as worse.
      const field = [
        mk({ r1: 18, r2: 18 }, 150, 136, 80), // played both, best
        mk({ r1: 18, r2: 18 }, 158, 144, 72), // played both
        mk({ r1: 18 }, 76, 68, 40), // missed round two
      ];

      const sorted = [...field].sort((a, b) => compareOnBasis(a, b, basis));
      const higherWins = basis === "stableford";
      const { fromRankedScore, fromToParCell } = printedCells(sorted, unit, isStableford);

      expect(
        readsDownward(fromRankedScore, higherWins),
        `${unit}: player board prints ${fromRankedScore.join(", ")} down its own order`,
      ).toBe(true);

      // The two readers must agree about the cell, not merely each be sorted.
      expect(fromToParCell.map((c) => Number(c.replace(/^E$/, "0").replace("+", "")))).toEqual(
        fromRankedScore,
      );
    });
  }

  /**
   * THE CONTROL, and the reason the case above cannot be satisfied by deleting
   * the normalisation outright.
   *
   * Mid-round, a player thru 9 must NOT out-rank a player thru 18 on a smaller
   * total. That is what `levelPoints` exists for and it still has to hold.
   */
  it("a round in flight still normalises, so a short card does not lead on a small total", () => {
    const inFlight = "r2";
    const thru9 = row({
      gross: 108,
      net: 98,
      points: 58,
      parThru: 108,
      played: { r1: 18, r2: 9 },
      activeRoundId: inFlight,
      levelPerHole: 2,
    });
    const thru18 = row({
      gross: 144,
      net: 130,
      points: 74,
      parThru: 144,
      played: { r1: 18, r2: 18 },
      activeRoundId: inFlight,
      levelPerHole: 2,
    });

    // 58 points off 27 holes is +4 on level; 74 off 36 is +2. The smaller
    // total is ahead, and that is correct.
    expect(scoreOnBasis(thru9, "stableford")).toBe(4);
    expect(scoreOnBasis(thru18, "stableford")).toBe(2);
    expect(compareOnBasis(thru9, thru18, "stableford")).toBeLessThan(0);
  });

  /**
   * THE RULE ITSELF, stated where it cannot be satisfied by a coincidence of
   * the fixture: with every round settled, a points board IS the points total.
   */
  it("with nothing in flight, a Stableford board ranks on the plain points total", () => {
    const played3 = { r1: 18, r2: 18 };
    const missed = { r1: 18 };
    const a = row({ gross: 0, net: 0, points: 70, parThru: 144, played: played3, activeRoundId: null, levelPerHole: 2 });
    const b = row({ gross: 0, net: 0, points: 40, parThru: 72, played: missed, activeRoundId: null, levelPerHole: 2 });

    // Both charged the whole competition — 36 holes — so the order is 70 v 40.
    expect(a.levelPoints).toBe(72);
    expect(b.levelPoints).toBe(72);
    expect(compareOnBasis(a, b, "stableford")).toBeLessThan(0);
  });

  /**
   * And the shape that produced the whole investigation, in one assertion: the
   * seeded club's league, four weeks in, week four still being played.
   *
   * Greta's 135 came off three weeks and Kwame's 170 off four. The board put
   * Greta first. Nobody runs a league on points per hole.
   */
  it("a player who missed a settled week does not out-rank one who played it", () => {
    const rounds = [
      { id: "w1", holes: 18 },
      { id: "w2", holes: 18 },
      { id: "w3", holes: 18 },
      { id: "w4", holes: 18 },
    ];
    const level = (played: Record<string, number>) =>
      2 * chargedHoles(agg(played), rounds, "w4");

    const greta = { points: 135, levelPoints: level({ w1: 18, w2: 18, w4: 18 }) };
    const kwame = { points: 170, levelPoints: level({ w1: 18, w2: 18, w3: 18, w4: 18 }) };

    // Week four is in flight, so both are charged their own week-four holes and
    // the three settled weeks in full. Same term, so the points decide.
    expect(greta.levelPoints).toBe(kwame.levelPoints);
    const base = { gross: 0, net: 0, parThru: 0 };
    expect(compareOnBasis({ ...base, ...kwame }, { ...base, ...greta }, "stableford")).toBeLessThan(0);
  });
});
