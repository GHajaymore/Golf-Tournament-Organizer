import { describe, it, expect } from "vitest";
import { rankStrokeIndex, holeStrokesReceived, allocationHoles } from "@/lib/domain/stroke";
import { playSkins } from "@/lib/domain/skins";

/**
 * The nine-hole skins pot, and why it never paid out.
 *
 * A stroke index ranks eighteen holes against each other. Slice nine of them
 * for a front- or back-nine game and the values are still 1..18 — a normal
 * card's front nine is 1,3,5,…,17 — while the allocation compares them against
 * `handicap % 9`, which is 0..8. Almost nothing matched, so every player got
 * exactly `floor(handicap / 9)` strokes: one a hole for anyone from 9 to 17,
 * none at all below 9.
 *
 * In a Thursday-night nine with a bunched field that is the same stroke to
 * everybody on every hole. Every hole halves, no skin is won outright, and the
 * whole pot carries to the end and refunds. Reported as "the pot never pays".
 */

/** A real card's front nine: the odd stroke indexes. */
const FRONT_NINE_SI = [1, 3, 5, 7, 9, 11, 13, 15, 17];
/** And its back nine: the even ones. */
const BACK_NINE_SI = [2, 4, 6, 8, 10, 12, 14, 16, 18];

describe("ranking a sliced stroke index", () => {
  it("turns a real front nine into 1..9", () => {
    expect(rankStrokeIndex(FRONT_NINE_SI)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("turns a real back nine into 1..9 as well", () => {
    // The point: both nines are ranked against themselves, so the hardest hole
    // of the back nine gets a stroke before the easiest of the front does.
    expect(rankStrokeIndex(BACK_NINE_SI)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("keeps the club's relative difficulty rather than the hole order", () => {
    // A shuffled nine — rank follows the index, not the position on the card.
    expect(rankStrokeIndex([7, 13, 1, 15, 3, 11, 5, 17, 9])).toEqual([4, 7, 1, 8, 2, 6, 3, 9, 5]);
  });

  it("leaves a full eighteen alone", () => {
    const si = Array.from({ length: 18 }, (_, i) => i + 1);
    expect(rankStrokeIndex(si)).toEqual(si);
  });

  it("gives duplicated indexes distinct ranks rather than sharing one", () => {
    // A card somebody typed twice. Two holes on one rank would hand out the
    // same stroke twice and drop another hole entirely.
    expect(rankStrokeIndex([4, 4, 1])).toEqual([2, 3, 1]);
  });
});

describe("strokes over a nine, once the index is ranked", () => {
  const ranked = rankStrokeIndex(FRONT_NINE_SI);
  const strokesFor = (courseHandicap: number) =>
    ranked.map((si) => holeStrokesReceived(courseHandicap, si, allocationHoles(ranked.length)));

  it("gives a five-handicap five strokes, on the five hardest", () => {
    // A nine-hole Course Handicap of 5 means five strokes, and they go on the
    // five hardest holes of the nine being played.
    const shots = strokesFor(5);
    expect(shots.reduce((a, b) => a + b, 0)).toBe(5);
    expect(shots).toEqual([1, 1, 1, 1, 1, 0, 0, 0, 0]);
  });

  it("gives a nine-handicap one a hole, and no more", () => {
    // The old code's answer for everyone from 9 to 17. Correct only AT nine.
    const shots = strokesFor(9);
    expect(shots.reduce((a, b) => a + b, 0)).toBe(9);
    expect(new Set(shots)).toEqual(new Set([1]));
  });

  it("gives a twelve-handicap a second stroke on the three hardest", () => {
    const shots = strokesFor(12);
    expect(shots.reduce((a, b) => a + b, 0)).toBe(12);
    expect(shots).toEqual([2, 2, 2, 1, 1, 1, 1, 1, 1]);
  });

  it("gives a scratch player nothing", () => {
    expect(strokesFor(0).reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe("the pot that never paid", () => {
  /** Nine holes, everyone gross-level — only the strokes can separate them. */
  const level = (n: number) => Array.from({ length: 9 }, () => n);

  it("pays out when the field is separated by their strokes", () => {
    // Three players, all gross 5s, on Course Handicaps 2/5/8. Ranked properly
    // they get different strokes on different holes, so holes are won
    // outright and the pot is claimed.
    const outcome = playSkins(
      [
        { playerId: "low", strokes: level(5), courseHandicap: 2 },
        { playerId: "mid", strokes: level(5), courseHandicap: 5 },
        { playerId: "high", strokes: level(5), courseHandicap: 8 },
      ],
      9,
      { net: true, strokeIndex: rankStrokeIndex(FRONT_NINE_SI) },
    );
    const claimed = outcome.standings.reduce((a, s) => a + s.skins, 0);
    expect(claimed).toBeGreaterThan(0);
    // And the whole pot is accounted for: claimed plus what is left on the
    // table is exactly one skin per hole played.
    expect(claimed + outcome.unclaimed).toBe(9);
  });

  it("refunds the whole pot when everybody gets the same stroke — the old behaviour", () => {
    // Kept as the counter-example. Three players who genuinely are level after
    // strokes tie every hole, and the money goes back. That is correct when it
    // is true; the defect was that the un-ranked index made it true for almost
    // every nine-hole field.
    const outcome = playSkins(
      [
        { playerId: "a", strokes: level(5), courseHandicap: 9 },
        { playerId: "b", strokes: level(5), courseHandicap: 9 },
        { playerId: "c", strokes: level(5), courseHandicap: 9 },
      ],
      9,
      { net: true, strokeIndex: rankStrokeIndex(FRONT_NINE_SI) },
    );
    expect(outcome.standings.reduce((a, s) => a + s.skins, 0)).toBe(0);
    expect(outcome.unclaimed).toBe(9);
  });

  it("stops short-changing the players below nine", () => {
    /**
     * The precise defect, which is worth stating exactly rather than roughly.
     *
     * With the raw 1..17 slice, `strokeIndex <= handicap % 9` only ever
     * matched the odd values that happened to survive the slice — so a player
     * owed five strokes got three, and the three were on the wrong holes. It
     * is not a blanket stroke for everybody (that only happens at exactly 9
     * and 18); it is a systematic under-allocation for everyone below nine,
     * which is most of a club.
     */
    const ranked = rankStrokeIndex(FRONT_NINE_SI);
    const total = (si: number[], h: number) =>
      si.map((x) => holeStrokesReceived(h, x, 9)).reduce((a, b) => a + b, 0);

    // A nine-hole Course Handicap of 5 is five strokes. Full stop.
    expect(total(ranked, 5)).toBe(5);
    expect(total(FRONT_NINE_SI, 5)).toBe(3); // what it used to give

    expect(total(ranked, 7)).toBe(7);
    expect(total(FRONT_NINE_SI, 7)).toBe(4);

    // At exactly nine the two agree — which is why this survived a spot-check.
    expect(total(ranked, 9)).toBe(total(FRONT_NINE_SI, 9));
  });

  it("halves an eighteen-hole handicap for a nine — the other half of the bug", () => {
    /**
     * `Player.handicap` is an eighteen-hole Handicap Index. Passing it in as
     * the Course Handicap for a nine gave a player roughly twice the strokes
     * a nine-hole competition allows: an Index of 9 became nine strokes over
     * nine holes rather than the five it should be. That is the audit's
     * "a 9-handicapper gets a stroke on all nine holes instead of five".
     *
     * `courseHandicapMap(..., 9)` is what now does the conversion, in the
     * service. This pins the arithmetic it has to produce.
     */
    const ranked = rankStrokeIndex(FRONT_NINE_SI);
    const total = (h: number) =>
      ranked.map((si) => holeStrokesReceived(h, si, 9)).reduce((a, b) => a + b, 0);

    expect(total(9)).toBe(9); // an Index of 9 passed straight through: wrong
    expect(total(Math.round(9 / 2))).toBe(5); // halved for the nine: right
  });
});
