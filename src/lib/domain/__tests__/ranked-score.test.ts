import { describe, it, expect } from "vitest";
import { rankedScore, type RankedRow } from "../ranked-score";

/**
 * The branch that existed three times and disagreed with itself.
 *
 * Twice inside `PlayerLeaderboard` — where the two copies differed about when
 * a score exists at all, so a match-play board printed a dash for every
 * player's points except your own — and once on the player's Today card, where
 * it printed a to-par over a match-play round. One player's own two screens
 * read "4" and "+4" for the same tournament.
 */
const row = (over: Partial<RankedRow> = {}): RankedRow => ({
  pts: "10.5",
  points: 34,
  toPar: -3,
  thru: 18,
  holesOwed: 18,
  started: true,
  ...over,
});

describe("the number a player is ranked on", () => {
  it("is match points in a match round", () => {
    const r = rankedScore(row(), { isStroke: false });
    expect(r.text).toBe("10.5");
    expect(r.label).toBe("Match points");
  });

  it("is to par in a stroke round", () => {
    const r = rankedScore(row(), { isStroke: true });
    // A plain hyphen-minus, which is what `toParText` produces. Asserted as it
    // is rather than as a typographic minus — this test's job is to pin the
    // branch that chooses the number, not to invent a formatting rule the app
    // does not have.
    expect(r.text).toBe("-3");
    expect(rankedScore(row({ toPar: 0 }), { isStroke: true }).text).toBe("E");
    expect(rankedScore(row({ toPar: 2 }), { isStroke: true }).text).toBe("+2");
    // And the two rounds must not produce the same answer, or a reader that
    // ignores the format satisfies both assertions above.
    expect(r.text).not.toBe(rankedScore(row(), { isStroke: false }).text);
  });

  it("is Stableford points where the round is scored that way", () => {
    const r = rankedScore(row(), { isStroke: true, isStableford: true });
    expect(r.text).toBe("34");
    expect(r.text).not.toBe(rankedScore(row(), { isStroke: true }).text);
  });
});

describe("a row with no result yet", () => {
  it("says so rather than printing a nought", () => {
    // The case both `PlayerLeaderboard` copies were reaching for and one of
    // them got wrong.
    const r = rankedScore(row({ started: false, thru: 0 }), { isStroke: true });
    expect(r.text).toBe("–");
    expect(r.label).toBe("Not started");
  });

  it("uses `started`, not `thru`", () => {
    /**
     * THE BUG, in one assertion.
     *
     * A match-play round keeps its results on the matches, so `thru` is nought
     * for everybody in one however many matches they have won. Reading it as
     * "has this player started" printed a dash where their points belong.
     */
    const played = row({ started: true, thru: 0, pts: "10.5" });
    expect(rankedScore(played, { isStroke: false }).text).toBe("10.5");

    const notPlayed = row({ started: false, thru: 0 });
    expect(rankedScore(notPlayed, { isStroke: false }).text).toBe("–");
  });
});

describe("how far round they are", () => {
  it("counts against this player's own cards, not the round's holes", () => {
    /**
     * A round robin puts three matches inside one round, so eighteen holes
     * returned is a third of it — calling that "F" tells somebody still on the
     * course that they have finished.
     */
    const partial = row({ thru: 18, holesOwed: 54 });
    expect(rankedScore(partial, { isStroke: true }).label).toBe("Thru 18");

    const done = row({ thru: 54, holesOwed: 54 });
    expect(rankedScore(done, { isStroke: true }).label).toBe("Final");
  });

  it("falls back to the holes played when the row owes none", () => {
    const r = rankedScore(row({ thru: 9, holesOwed: 0 }), { isStroke: true });
    expect(r.label).toBe("Thru 9");
  });
});
