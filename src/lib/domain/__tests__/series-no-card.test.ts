import { describe, it, expect } from "vitest";
import { pointsForRank, seriesStandings, DEFAULT_POINTS_TABLE } from "@/lib/domain/series";
import { finishingPositions } from "@/lib/services/finish-order";

/**
 * The smallest state `finishingPositions` will read.
 *
 * Only the four fields it actually looks at, cast at the boundary: building a
 * whole EventState here would be fifty lines of scaffolding describing nothing,
 * and every extra field is another thing a reader has to check is not the point
 * of the test.
 */
type PositionsInput = Parameters<typeof finishingPositions>[0];

const noBracket = { winners: { kind: "winners", rounds: [], champion: null } };

function strokeState(
  rows: Array<{ id: string; name: string; rank: number; ranked: boolean }>,
): PositionsInput {
  return {
    isStroke: true,
    brackets: noBracket,
    strokeStandings: rows.map((r) => ({
      player: { id: r.id, name: r.name },
      rank: r.rank,
      ranked: r.ranked,
    })),
    overall: [],
  } as unknown as PositionsInput;
}

/**
 * `rank` is required, because the real `overall` always carries one.
 *
 * It was omitted here while `finishingPositions` numbered by list position and
 * never read it — so the fixture could not express the case that matters: two
 * players `rankPlayers` deliberately gave the SAME rank. Leaving it optional
 * would let that case be written by accident as `undefined === undefined`.
 */
function matchState(
  rows: Array<{ id: string; name: string; played: number; rank: number }>,
): PositionsInput {
  return {
    isStroke: false,
    brackets: noBracket,
    strokeStandings: [],
    overall: rows.map((r) => ({
      player: { id: r.id, name: r.name },
      stats: { played: r.played },
      rank: r.rank,
    })),
  } as unknown as PositionsInput;
}

/**
 * A player who returned no card scores nothing in the order of merit.
 *
 * D5 of the 2026-09-02 exploratory audit. `finishOrderFor` carried unranked
 * players into `pointsForRank` with a rank of 0, and that function is 1-BASED:
 * `table[rank - 1]` reads `table[-1]`, which is undefined and contributes
 * nothing — and then the loop walks FORWARD into `table[0]`, the winner's
 * points. Three non-returners tied at rank 0 scored sixty each, above the
 * player who finished fourth on fifty-five, and each banked a `played` towards
 * `minEvents`. A twenty-player hand-scored event handed all twenty members 34.7
 * points for a round the app does not rank at all.
 *
 * The real fix is at the source, where unranked finishers are now filtered out.
 * This covers the second lock: the function is exported, 1-based, and nothing
 * in its signature says so.
 */
describe("pointsForRank refuses a rank that is not a finishing position", () => {
  const table = DEFAULT_POINTS_TABLE.length ? DEFAULT_POINTS_TABLE : [100, 90, 80, 70, 60];

  it("scores nothing for rank 0", () => {
    // The regression. This returned points from the TOP of the table.
    expect(pointsForRank(table, 0, 1)).toBe(0);
  });

  it("scores nothing for a group of non-returners tied at rank 0", () => {
    /**
     * The shape that produced sixty points each. With `tiedCount` 3 the loop
     * ran table[-1], table[0], table[1] — nothing, then first place, then
     * second — and averaged them.
     */
    expect(pointsForRank(table, 0, 3)).toBe(0);
  });

  it("scores nothing for a negative rank", () => {
    expect(pointsForRank(table, -1, 1)).toBe(0);
    expect(pointsForRank(table, -5, 4)).toBe(0);
  });

  it("scores nothing for a rank that is not a number", () => {
    expect(pointsForRank(table, Number.NaN, 1)).toBe(0);
  });

  describe("and still pays real positions exactly as before", () => {
    it("pays the winner the top of the table", () => {
      expect(pointsForRank(table, 1, 1)).toBe(table[0]);
    });

    it("pays second place the second row", () => {
      expect(pointsForRank(table, 2, 1)).toBe(table[1]);
    });

    it("averages a genuine tie across the places it covers", () => {
      // Two players tied for first share first and second place points.
      expect(pointsForRank(table, 1, 2)).toBe((table[0] + table[1]) / 2);
    });

    it("pays nothing past the end of the table, without throwing", () => {
      // A field longer than the points table is ordinary, not an error.
      expect(pointsForRank(table, table.length + 5, 1)).toBe(0);
    });
  });
});

/**
 * The same fault seen through the order of merit itself, so the arithmetic is
 * asserted where an organizer would read it.
 */
describe("the order of merit ignores a non-finisher", () => {
  const config = { pointsTable: DEFAULT_POINTS_TABLE, bestOf: 0, minEvents: 0 };

  it("does not seat non-returners above the player who finished fourth", () => {
    /**
     * The audit's own numbers, and the default table produces them exactly.
     *
     * `DEFAULT_POINTS_TABLE` pays 100, 80, 65, 55. Three players sharing rank 0
     * ran `table[-1]`, `table[0]`, `table[1]` — nothing, first, second —
     * averaged to (0 + 100 + 80) / 3 = SIXTY each, which is how three people
     * who never returned a card finished above the player on fifty-five.
     */
    const standings = seriesStandings(
      [
        {
          eventId: "e1",
          eventName: "Spring Medal",
          finishers: [
            { memberId: "m1", name: "First", rank: 1 },
            { memberId: "m4", name: "Fourth", rank: 4 },
            // What the old finishOrderFor produced for three no-shows.
            { memberId: "mX", name: "No card A", rank: 0 },
            { memberId: "mY", name: "No card B", rank: 0 },
            { memberId: "mZ", name: "No card C", rank: 0 },
          ],
        },
      ],
      config,
    );

    const totalFor = (id: string) => standings.find((s) => s.memberId === id)?.total ?? 0;

    expect(totalFor("m1")).toBe(100);
    expect(totalFor("m4")).toBe(55);

    for (const absent of ["mX", "mY", "mZ"]) {
      expect(totalFor(absent), `${absent} returned no card and must score nothing`).toBe(0);
      expect(totalFor(absent)).toBeLessThan(totalFor("m4"));
    }
  });

  it("does not credit a non-returner with having played", () => {
    /**
     * The quieter half. Each rank-0 entry also incremented `played`, which is
     * what `minEvents` counts — so somebody who never teed up could qualify for
     * the order of merit on absences alone.
     */
    const standings = seriesStandings(
      [
        {
          eventId: "e1",
          eventName: "Spring Medal",
          finishers: [{ memberId: "mX", name: "No card", rank: 0 }],
        },
      ],
      config,
    );
    const absent = standings.find((s) => s.memberId === "mX");
    // Either absent from the table entirely, or present with nothing to show.
    expect(absent?.total ?? 0).toBe(0);
  });
});

/**
 * The fix at the SOURCE, which the arithmetic above cannot reach.
 *
 * `pointsForRank` refusing rank 0 stops the scoring, but a non-returner that
 * still reaches `seriesStandings` keeps incrementing `played` — and `played` is
 * what `minEvents` counts, so somebody who never teed up could still qualify
 * for the order of merit on absences alone. The filter in `finishOrderFor` is
 * what stops them arriving at all.
 *
 * Asserted by reading the source because the behavioural version needs a whole
 * event — players, cards, standings — to produce one unranked row. The
 * arithmetic is tested properly above; this pins the one line that decides who
 * is handed to it, and names both branches because match play needed it too.
 */
/**
 * The finishing order only reports players who returned something.
 *
 * These were three assertions about the TEXT of `series.ts`, and they broke the
 * moment the rule moved into a shared function — while the behaviour they
 * describe was untouched. That is the second time a source-pinned test here has
 * failed for a refactor rather than a regression, so they are behavioural now:
 * `finishingPositions` is handed a state and asked what it says.
 */
describe("the finishing order only reports players who returned something", () => {
  it("leaves out a stroke player who holds no position", () => {
    const order = finishingPositions(
      strokeState([
        { id: "a", name: "A", rank: 1, ranked: true },
        { id: "dnf", name: "Stopped short", rank: 0, ranked: false },
        { id: "b", name: "B", rank: 2, ranked: true },
      ]),
    );
    expect(order.map((o) => o.playerId)).toEqual(["a", "b"]);
  });

  it("leaves out a match player who played nothing", () => {
    // `overall` numbers everybody in it, so an absentee held a finishing
    // position — and rank 0 read as first place off the points table.
    const order = finishingPositions(
      matchState([
        { id: "a", name: "A", played: 3, rank: 1 },
        { id: "absent", name: "Never teed off", played: 0, rank: 2 },
        { id: "b", name: "B", played: 3, rank: 3 },
      ]),
    );
    expect(order.map((o) => o.playerId)).toEqual(["a", "b"]);
  });

  it("renumbers the survivors 1..N with no gap where the absentee was", () => {
    /**
     * Order is the whole point. Filtering after the index would leave the
     * survivors on 1 and 3, and those gaps are read straight off the points
     * table — so second place would be paid third-place points.
     */
    const order = finishingPositions(
      matchState([
        { id: "a", name: "A", played: 3, rank: 1 },
        { id: "absent", name: "Never teed off", played: 0, rank: 2 },
        { id: "b", name: "B", played: 3, rank: 3 },
      ]),
    );
    expect(order.map((o) => o.rank)).toEqual([1, 2]);
  });

  /**
   * A tie that `rankPlayers` found survives the renumbering.
   *
   * `rank: i + 1` closed the absentee's gap and broke the tie in the same
   * expression. `rankPlayers` gives two players one rank only when the points
   * are level AND every configured tiebreaker returns zero, and it refuses to
   * consult the seed fallback to split them, because that is "exactly what hid
   * the tie". Renumbering by list position consulted that fallback anyway —
   * the sort order for a level field IS the seed.
   *
   * So a halved flight produced a champion. `suggestChampion` refuses to name
   * one when `leaders.length > 1`, and that branch was unreachable for every
   * non-stroke event, because two shared 1s always arrived as a 1 and a 2 —
   * onto the honours board and the season table, permanently.
   */
  it("keeps a tie the standings found, rather than splitting it by position", () => {
    const order = finishingPositions(
      matchState([
        { id: "a", name: "A", played: 3, rank: 1 },
        { id: "b", name: "B", played: 3, rank: 1 },
        { id: "c", name: "C", played: 3, rank: 3 },
      ]),
    );
    expect(order.map((o) => o.rank)).toEqual([1, 1, 3]);
  });

  it("closes an absentee's gap without merging the players either side of it", () => {
    /**
     * Both rules at once, which is where a fix for one breaks the other: the
     * survivors must renumber down over the absentee, and two players who were
     * never level must not become level by landing next to each other.
     */
    const order = finishingPositions(
      matchState([
        { id: "absent", name: "Never teed off", played: 0, rank: 1 },
        { id: "a", name: "A", played: 3, rank: 2 },
        { id: "b", name: "B", played: 3, rank: 2 },
        { id: "c", name: "C", played: 3, rank: 4 },
      ]),
    );
    expect(order.map((o) => o.playerId)).toEqual(["a", "b", "c"]);
    // a and b were level on 2 and stay level, now at the top; c keeps a
    // position that reflects the two players ahead, not the four rows.
    expect(order.map((o) => o.rank)).toEqual([1, 1, 3]);
  });
});
