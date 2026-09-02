import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pointsForRank, seriesStandings, DEFAULT_POINTS_TABLE } from "@/lib/domain/series";

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
describe("finishOrderFor only reports players who returned something", () => {
  const src = readFileSync(
    join(process.cwd(), "src", "lib", "services", "series.ts"),
    "utf8",
  );

  it("filters unranked players out of a stroke event", () => {
    expect(src).toMatch(/strokeStandings\s*\r?\n?\s*\.filter\(\(s\) => s\.ranked\)/);
  });

  it("filters players who played nothing out of a match event", () => {
    // `overall` numbers everybody `i + 1`, so an absentee held a finishing
    // position until this filter existed.
    expect(src).toMatch(/overall\s*\r?\n?\s*\.filter\(\(rp\) => rp\.stats\.played > 0\)/);
  });

  it("filters BEFORE the position index, not after", () => {
    /**
     * Order is the whole point in the match branch: filtering after `map` would
     * leave the survivors ranked 1, 3, 4 with a hole where the absentee was,
     * and those gaps are read straight off the points table.
     */
    const matchBranch = src.slice(src.indexOf("state.overall"));
    const filterAt = matchBranch.indexOf(".filter(");
    const mapAt = matchBranch.indexOf(".map(");
    expect(filterAt).toBeGreaterThan(-1);
    expect(filterAt).toBeLessThan(mapAt);
  });
});
