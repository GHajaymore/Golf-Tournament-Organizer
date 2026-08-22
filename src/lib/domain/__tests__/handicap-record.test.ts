import { describe, it, expect } from "vitest";
import {
  netDoubleBogey,
  adjustedGrossScore,
  scoreDifferential,
  clubHandicapFrom,
  handicapRecordFrom,
  maySuggestFor,
  MAX_HANDICAP,
  type RoundForRecord,
} from "../handicap-record";

/**
 * A club handicap from returned cards.
 *
 * Asserted against the Rules of Handicapping — the published METHOD, which is
 * public — and never against what the code happens to do. The DATA a national
 * association holds is licensed and is a different thing; nothing here is a
 * WHS Handicap Index and nothing here may be presented as one.
 */

/** Pebble Beach, blue tees, as the public directory returns it. */
const PARS = [4, 5, 4, 4, 3, 5, 3, 4, 4, 4, 4, 3, 4, 5, 4, 4, 3, 5];
const SI = [6, 10, 12, 16, 14, 2, 18, 4, 8, 3, 9, 17, 7, 1, 13, 11, 15, 5];
const BLUE = { courseRating: 74.9, slopeRating: 144, par: 72 };

describe("net double bogey", () => {
  it("is par plus two plus the strokes that player receives", () => {
    // Rule 3.1. The cap is the reason one catastrophic hole does not wreck a
    // handicap, and without it every record here would be worse than the
    // player is.
    expect(netDoubleBogey(4, 0)).toBe(6);
    expect(netDoubleBogey(4, 1)).toBe(7);
    expect(netDoubleBogey(3, 2)).toBe(7);
    expect(netDoubleBogey(5, 0)).toBe(7);
  });

  it("never subtracts for a plus handicap's negative strokes", () => {
    // A plus player gives shots back on the course; they do not lower the cap
    // below double bogey, which would score their record as better than they
    // played.
    expect(netDoubleBogey(4, -1)).toBe(6);
  });
});

describe("the card as handicapping reads it", () => {
  const scratch = { pars: PARS, courseHandicap: 0, strokeIndex: SI, holes: 18 as const };

  it("leaves a clean card alone", () => {
    const strokes = PARS.map((p) => p + 1); // bogey golf, nothing near the cap
    const r = adjustedGrossScore({ ...scratch, strokes });
    expect(r.adjusted).toBe(strokes.reduce((a, b) => a + b, 0));
    expect(r.cappedHoles).toEqual([]);
    expect(r.usable).toBe(true);
  });

  it("caps the blow-up hole and says which one", () => {
    // A scratch player takes 10 on the first, a par 4. Net double bogey is 6.
    const strokes = [...PARS];
    strokes[0] = 10;
    const r = adjustedGrossScore({ ...scratch, strokes });
    expect(r.cappedHoles).toEqual([1]);
    expect(r.adjusted).toBe(PARS.reduce((a, b) => a + b, 0) - 4 + 6);
  });

  it("gives a higher handicap a higher cap on the holes they receive on", () => {
    // The cap moves with the strokes received, so an 18-handicapper is allowed
    // a 7 on a par 4 where a scratch player is allowed a 6.
    const strokes = [...PARS];
    strokes[0] = 10;
    const eighteen = adjustedGrossScore({ ...scratch, courseHandicap: 18, strokes });
    const zero = adjustedGrossScore({ ...scratch, strokes });
    // Only the blow-up hole is anywhere near its cap, so the whole difference
    // is that one hole: an 18-handicapper receives a stroke on SI 6, so their
    // cap there is 7 where a scratch player is held to 6.
    expect(eighteen.adjusted - zero.adjusted).toBe(1);
  });

  it("scores a hole not played as net par, never as zero", () => {
    // Rule 3.2. A zero would hand the player the best round of their life for
    // failing to finish.
    const strokes: (number | null)[] = [...PARS];
    strokes[5] = null;
    const r = adjustedGrossScore({ ...scratch, strokes });
    expect(r.adjusted).toBe(PARS.reduce((a, b) => a + b, 0));
    expect(r.usable).toBe(true);
  });

  it("refuses a card with a third of it missing", () => {
    // A hole or two is a card. Six blank holes is somebody who walked in, and
    // counting it would quietly lower their handicap.
    const strokes: (number | null)[] = [...PARS];
    for (let i = 0; i < 7; i += 1) strokes[i] = null;
    expect(adjustedGrossScore({ ...scratch, strokes }).usable).toBe(false);
  });
});

describe("score differential", () => {
  it("is (113 / slope) x (adjusted gross - course rating)", () => {
    // A scratch player rounds 76 off the blues: (113/144) x (76 - 74.9) = 0.86
    expect(scoreDifferential(76, BLUE)).toBe(0.9);
    // 90 off the same tee: (113/144) x 15.1 = 11.849, which states as 11.8.
    expect(scoreDifferential(90, BLUE)).toBe(11.8);
  });

  it("gives a harder course a lower differential for the same score", () => {
    // The whole point of slope. 85 off a 144-slope course is a better round
    // than 85 off a 113-slope one, and the number has to say so.
    const hard = scoreDifferential(85, BLUE)!;
    const easy = scoreDifferential(85, { courseRating: 74.9, slopeRating: 113, par: 72 })!;
    expect(hard).toBeLessThan(easy);
  });

  it("refuses an unrated tee rather than inventing a rating", () => {
    // Without a Course Rating and Slope there is no differential. Deriving one
    // from par would produce a handicap that looks authoritative and is not.
    expect(scoreDifferential(85, null)).toBeNull();
    expect(scoreDifferential(85, { courseRating: 0, slopeRating: 0, par: 72 })).toBeNull();
    expect(scoreDifferential(85, { courseRating: 71.5, slopeRating: 0, par: 72 })).toBeNull();
  });

  it("can go negative for a round better than the rating", () => {
    // A 70 off a 74.9 rating is a very good round and the differential is
    // negative. Clamping it at zero would stop plus handicaps existing.
    expect(scoreDifferential(70, BLUE)!).toBeLessThan(0);
  });
});

describe("the handicap itself", () => {
  const run = (n: number, value = 20) => new Array(n).fill(value);

  it("issues nothing below three scores", () => {
    // The Rules issue no handicap on fewer than three, and returning a number
    // anyway would assert something the method does not support.
    expect(clubHandicapFrom([])).toBeNull();
    expect(clubHandicapFrom([12.0])).toBeNull();
    expect(clubHandicapFrom([12.0, 14.0])).toBeNull();
    expect(clubHandicapFrom([12.0, 14.0, 16.0])).not.toBeNull();
  });

  it("takes the lowest 1 minus 2.0 at three scores", () => {
    // Appendix E. An average of one score is a poor estimate, so the Rules
    // push it down rather than let a single good round set a handicap.
    const r = clubHandicapFrom([12.0, 14.0, 16.0])!;
    expect(r.lowestCounted).toBe(1);
    expect(r.adjustment).toBe(-2.0);
    expect(r.handicap).toBe(10.0);
  });

  it("walks the table as the record fills", () => {
    // Appendix E, in full. Each row is a real step a member passes through in
    // their first season.
    const expected: Array<[number, number, number]> = [
      // [scores, lowest counted, adjustment]
      [3, 1, -2.0], [4, 1, -1.0], [5, 1, 0], [6, 2, -1.0],
      [7, 2, 0], [8, 2, 0], [9, 3, 0], [11, 3, 0],
      [12, 4, 0], [14, 4, 0], [15, 5, 0], [16, 5, 0],
      [17, 6, 0], [18, 6, 0], [19, 7, 0], [20, 8, 0],
    ];
    for (const [scores, lowest, adjustment] of expected) {
      const r = clubHandicapFrom(run(scores))!;
      expect(r.lowestCounted, `${scores} scores`).toBe(lowest);
      expect(r.adjustment, `${scores} scores`).toBe(adjustment);
    }
  });

  it("averages the lowest, not all of them", () => {
    // Eight scores: lowest 2, no adjustment. The two 10s count and the six
    // bad rounds do not — which is why a handicap measures potential rather
    // than the average round.
    const r = clubHandicapFrom([10.0, 10.0, 30, 30, 30, 30, 30, 30])!;
    expect(r.lowestCounted).toBe(2);
    expect(r.handicap).toBe(10.0);
  });

  it("keeps only the most recent twenty", () => {
    // A brilliant round three years ago must stop counting. Most recent LAST:
    // the 5.0s here are old and the 25.0s are current.
    const old = new Array(20).fill(5.0);
    const recent = new Array(20).fill(25.0);
    const r = clubHandicapFrom([...old, ...recent])!;
    expect(r.scoresUsed).toBe(20);
    expect(r.handicap).toBe(25.0);
  });

  it("reports one decimal, the way a handicap is written", () => {
    const r = clubHandicapFrom([12.3, 14.7, 16.1])!;
    expect(r.handicap).toBeCloseTo(10.3, 5);
    expect(Number.isInteger(r.handicap * 10)).toBe(true);
  });

  it("caps at 54 and leaves plus handicaps alone", () => {
    // 54.0 is the Rules' ceiling. There is no floor, because a plus handicap
    // is real and clamping it to scratch hands the best golfer in the club
    // strokes they are not entitled to.
    expect(clubHandicapFrom(run(20, 80))!.handicap).toBe(MAX_HANDICAP);
    expect(clubHandicapFrom(run(20, -3.2))!.handicap).toBe(-3.2);
  });
});

describe("end to end, one member's season", () => {
  it("turns real cards into a handicap", () => {
    // Three rounds off the blues at Pebble: 92, 88, 95 gross, played clean.
    const rounds = [92, 88, 95].map((gross) => {
      // Spread the gross over the card so the cap does not bite.
      const over = gross - PARS.reduce((a, b) => a + b, 0);
      const strokes = PARS.map((p, i) => p + (i < over ? 1 : 0));
      const adj = adjustedGrossScore({
        strokes,
        pars: PARS,
        courseHandicap: 20,
        strokeIndex: SI,
        holes: 18,
      });
      return scoreDifferential(adj.adjusted, BLUE)!;
    });

    const r = clubHandicapFrom(rounds)!;
    // Lowest of three, minus 2.0 — and a real number a club would recognise.
    expect(r.lowestCounted).toBe(1);
    expect(r.handicap).toBeGreaterThan(5);
    expect(r.handicap).toBeLessThan(20);
  });
});

describe("a member's whole record", () => {
  const PAR_TOTAL = PARS.reduce((a, b) => a + b, 0);
  const round = (over: number, extra: Partial<RoundForRecord> = {}): RoundForRecord => ({
    playedOn: "2026-05-01",
    strokes: PARS.map((p, i) => p + (i < over ? 1 : 0)),
    pars: PARS,
    strokeIndex: SI,
    holes: 18,
    courseHandicap: 12,
    tee: BLUE,
    ...extra,
  });

  it("counts the rounds it can and says what it left out", () => {
    // A member looking at "handicap from 3 rounds" when they played six will
    // assume the app lost three of them. Naming each exclusion is the whole
    // point of returning them.
    const r = handicapRecordFrom([
      round(10),
      round(12),
      round(14),
      round(8, { tee: null }),
      round(8, { holes: 9 }),
      round(8, { strokes: PARS.map((p, i) => (i < 7 ? null : p)) }),
    ]);
    expect(r.differentials).toHaveLength(3);
    expect(r.skipped["unrated-tee"]).toBe(1);
    expect(r.skipped["nine-hole"]).toBe(1);
    expect(r.skipped.incomplete).toBe(1);
    expect(r.suggestion).not.toBeNull();
  });

  it("skips a nine-hole round rather than halving its differential", () => {
    // The Rules pair two nine-hole differentials into one eighteen-hole score.
    // Treating nine holes as eighteen would compute a differential off half a
    // round against a full course rating — wrong, and wrong in the direction
    // that flatters the player.
    const r = handicapRecordFrom([round(10, { holes: 9 })]);
    expect(r.differentials).toEqual([]);
    expect(r.skipped["nine-hole"]).toBe(1);
  });

  it("orders by the day the round was PLAYED, not the day it was entered", () => {
    // A club catching up on last month's cards in one evening must not
    // reorder a member's record, because the twenty-score window is about
    // golf rather than data entry.
    const r = handicapRecordFrom([
      // Kept under 18, because the helper adds a shot to the first N holes —
      // beyond eighteen every card is "bogey everywhere" and they stop differing.
      round(18, { playedOn: "2026-06-01" }),
      round(2, { playedOn: "2026-01-01" }),
      round(10, { playedOn: "2026-03-01" }),
    ]);
    // Oldest first: the January round (2 over) is the lowest differential.
    expect(r.differentials[0]).toBeLessThan(r.differentials[1]);
    expect(r.differentials[1]).toBeLessThan(r.differentials[2]);
  });

  it("issues nothing from two usable rounds, however many were played", () => {
    const r = handicapRecordFrom([round(10), round(12), round(8, { tee: null })]);
    expect(r.suggestion).toBeNull();
    expect(r.skipped["unrated-tee"]).toBe(1);
  });

  it("returns an empty record rather than throwing on no rounds", () => {
    const r = handicapRecordFrom([]);
    expect(r.suggestion).toBeNull();
    expect(r.differentials).toEqual([]);
  });

  it("produces a sane handicap from a real-looking season", () => {
    const rounds = [14, 18, 12, 20, 16, 15, 11, 19].map((over, i) =>
      round(over, { playedOn: `2026-0${i + 1}-15` }),
    );
    const r = handicapRecordFrom(rounds);
    expect(r.differentials).toHaveLength(8);
    expect(r.suggestion!.lowestCounted).toBe(2);
    // Around 11 over the rating off a 144 slope: single figures, not 30.
    expect(r.suggestion!.handicap).toBeGreaterThan(0);
    expect(r.suggestion!.handicap).toBeLessThan(15);
    expect(PAR_TOTAL).toBe(72);
  });
});

describe("whose handicap this is", () => {
  it("never suggests over a GHIN figure", () => {
    // The association is the authority and this is the fallback. Suggesting a
    // replacement for a licensed figure is the one thing this must not do.
    expect(maySuggestFor("ghin")).toBe(false);
    expect(maySuggestFor("GHIN")).toBe(false);
    expect(maySuggestFor(" ghin ")).toBe(false);
  });

  it("suggests for a hand-entered or absent handicap", () => {
    expect(maySuggestFor("manual")).toBe(true);
    expect(maySuggestFor("none")).toBe(true);
    expect(maySuggestFor("")).toBe(true);
  });
});
