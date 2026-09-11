import { describe, it, expect } from "vitest";
import { cutLineTies } from "../standings";
import { cutSettledOnCountback } from "../cut";
import { readSource } from "@/lib/__tests__/source";

/**
 * A tie for the last qualifying place is not the software's to break.
 *
 * Stroke standings share a rank when a countback cannot separate two players,
 * and the board prints "8" twice — correctly. Qualification then takes the
 * first N of that list, and the order inside a tied pair is whatever the sort's
 * last fallback left, which is seed: handicap order. So the board showed two
 * players level, and the app advanced one and eliminated the other without
 * saying how it chose. The exported sheet carried both rows at rank 8, one
 * "Advancing" and one "Eliminated", and that sheet gets pinned up.
 *
 * Under the Rules that tie is decided by a play-off, or by a countback the
 * committee published beforehand (Committee Procedures 5A). This finds it so
 * every screen can say a decision is outstanding.
 */

const row = (
  id: string,
  rank: number,
  advancing: boolean,
  groupId: string | null = null,
  ranked = true,
) => ({ id, rank, ranked, advancing, groupId });

describe("finding a tie the cut line runs through", () => {
  it("finds the two players printed on the same position, one in and one out", () => {
    const ties = cutLineTies(
      [row("a", 7, true), row("b", 8, true), row("c", 8, false), row("d", 10, false)],
      "overall",
    );

    expect(ties).toHaveLength(1);
    expect(ties[0].rank).toBe(8);
    expect(ties[0].playerIds.sort()).toEqual(["b", "c"]);
  });

  it("says nothing when the cut falls in a gap", () => {
    // The ordinary case, and by far the common one: ranks 8 and 9 are two
    // different positions and the line between them is a real result.
    expect(cutLineTies([row("a", 8, true), row("b", 9, false)], "overall")).toEqual([]);
  });

  it("says nothing about a shared position entirely inside the cut", () => {
    // Two players tied for 3rd when 8 advance have nothing to play off for.
    expect(
      cutLineTies([row("a", 3, true), row("b", 3, true), row("c", 9, false)], "overall"),
    ).toEqual([]);
  });

  it("says nothing about a shared position entirely outside it", () => {
    expect(
      cutLineTies([row("a", 1, true), row("b", 12, false), row("c", 12, false)], "overall"),
    ).toEqual([]);
  });

  it("does not pair players from different flights under a per-flight cut", () => {
    /**
     * Ranks are assigned across the whole field, so two players in different
     * flights routinely share one. Under a per-flight cut they are in separate
     * races and have no place to argue over — reporting a play-off between
     * them would send two players to the first tee for nothing.
     */
    const rows = [row("a", 8, true, "flightA"), row("b", 8, false, "flightB")];
    expect(cutLineTies(rows, "perFlight")).toEqual([]);
    // Overall, the same two rows ARE a tie for one place.
    expect(cutLineTies(rows, "overall")).toHaveLength(1);
  });

  it("finds a tie inside one flight under a per-flight cut", () => {
    const ties = cutLineTies(
      [
        row("a", 4, true, "flightA"),
        row("b", 4, false, "flightA"),
        row("c", 9, true, "flightB"),
      ],
      "perFlight",
    );
    expect(ties).toHaveLength(1);
    expect(ties[0].playerIds.sort()).toEqual(["a", "b"]);
  });

  it("reports every flight that is tied, closest position first", () => {
    const ties = cutLineTies(
      [
        row("a", 6, true, "flightA"),
        row("b", 6, false, "flightA"),
        row("c", 3, true, "flightB"),
        row("d", 3, false, "flightB"),
      ],
      "perFlight",
    );
    expect(ties.map((t) => t.rank)).toEqual([3, 6]);
  });

  it("ignores a player who holds no position at all", () => {
    /**
     * An unranked row has rank 0 — a card that stopped short. Counting those
     * would report every non-finisher as tied with every other, and rank 0 is
     * not a position anyone can be level on.
     */
    expect(
      cutLineTies(
        [row("a", 0, false, null, false), row("b", 0, true, null, false), row("c", 1, true)],
        "overall",
      ),
    ).toEqual([]);
  });

  it("handles a rank that is not a number without inventing a tie", () => {
    expect(
      cutLineTies(
        [
          { id: "a", rank: Number.NaN, ranked: true, advancing: true, groupId: null },
          { id: "b", rank: Number.NaN, ranked: true, advancing: false, groupId: null },
        ],
        "overall",
      ),
    ).toEqual([]);
  });

  it("reports all three when a position is shared by three players", () => {
    // Two places left and three players level: all three go to the play-off,
    // not just the two the slice happened to separate.
    const ties = cutLineTies(
      [row("a", 7, true), row("b", 7, true), row("c", 7, false)],
      "overall",
    );
    expect(ties[0].playerIds.sort()).toEqual(["a", "b", "c"]);
  });
});

/**
 * AND THE OTHER HALF: the chain COULD separate them, and nobody said so.
 *
 * `cutLineTies` above is the case where a countback runs out and a play-off is
 * owed. This is its complement — the totals are equal, the club's chain
 * settled it, and the result is perfectly proper. What was missing is that the
 * screen never mentioned it.
 *
 * The qualification panel prints "Cutoff pts" (the lowest total that got
 * through) and promises of the table beneath: "Every player is shown, so you
 * can see exactly who missed out and by how much."
 *
 * Read off Demo Cup on 2026-09-11: it printed 10.5, and FOUR players were on
 * exactly 10.5 — two advanced, two did not. So "by how much" was "by nothing",
 * and a member on 10.5 reading a cutoff of 10.5 concludes they qualified. The
 * organizer has to answer that from this screen.
 */
describe("whether the qualifying line was settled on countback", () => {
  const r = (points: number, advancing: boolean) => ({ points, advancing });

  it("says so when the last one through and the first one out are level", () => {
    // Demo Cup's shape: 15, 13.5, 10.5, 10.5 through; 10.5, 10.5 out.
    expect(
      cutSettledOnCountback([r(15, true), r(13.5, true), r(10.5, true), r(10.5, true), r(10.5, false), r(10.5, false)]),
    ).toBe(true);
  });

  it("stays quiet when the line falls between two different totals", () => {
    // Nothing to explain: 10.5 through, 9.5 out, and the gap is the reason.
    expect(cutSettledOnCountback([r(15, true), r(10.5, true), r(9.5, false), r(9, false)])).toBe(false);
  });

  it("is about the LINE, not about ties elsewhere in the field", () => {
    /**
     * Two players level at the top and two level at the bottom, with a clear
     * gap at the cut. Nobody is owed an explanation, and claiming a countback
     * decided the line would be inventing one.
     */
    expect(cutSettledOnCountback([r(15, true), r(15, true), r(8, false), r(8, false)])).toBe(false);
  });

  it("says nothing when everybody goes through, or nobody does", () => {
    // No line has formed, so there is nothing to describe on either side.
    expect(cutSettledOnCountback([r(15, true), r(10, true)])).toBe(false);
    expect(cutSettledOnCountback([r(15, false), r(10, false)])).toBe(false);
    expect(cutSettledOnCountback([])).toBe(false);
  });

  it("does not care how the list is ordered", () => {
    /**
     * It reads the EXTREMES, not the first and last row — the panel passes
     * flights concatenated, which is nothing like overall rank order.
     *
     * This fixture is built so the two readings disagree, because the obvious
     * one does not. Both sides ascending: the last row through is 15 and the
     * first row out is 9, which look nothing alike, while the lowest through
     * and the highest out are both 10.5. Reading rows instead of extremes says
     * "no countback"; reading extremes says "countback", which is the truth.
     *
     * Written the ordinary way first — through descending, out descending —
     * where min happens to BE the last row and max happens to BE the first,
     * so the mutation passed and the test proved nothing. Caught by mutating.
     */
    expect(
      cutSettledOnCountback([r(10.5, true), r(15, true), r(9, false), r(10.5, false)]),
    ).toBe(true);
  });
});

/** And the panel has to ask, and say it where the misleading number is. */
describe("where the countback note appears", () => {
  const src = () => readSource("src/components/QualificationPanel.tsx");

  it("asks over the whole field, both sides of the line", () => {
    // `qualifiers` alone cannot answer it — the question is about who missed.
    expect(src()).toMatch(/cutSettledOnCountback\(allRows\)/);
  });

  it("sits with the Cutoff pts figure, which is the one that misleads", () => {
    /**
     * Not in the prose at the top. The number is what a reader checks their
     * own score against, and an explanation two paragraphs away is not read
     * by the person who has already found their answer.
     */
    const s = src();
    const card = s.slice(s.indexOf("Cutoff pts"), s.indexOf("Cutoff pts") + 700);
    expect(card).toMatch(/\{countback && \(/);
    expect(card).toMatch(/settled on countback/);
  });
});
