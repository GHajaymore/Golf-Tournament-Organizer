import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  boardNetWorking,
  cardFigures,
  netWorking,
  playingHandicapWorking,
  pointsOnHole,
  strokesOnHole,
  tieWorking,
  twoPlaces,
  unplacedWorking,
  CITE,
  type HandicapParts,
} from "../figure-working";
import { courseHandicapExact, roundPlayingHandicap, wholeStrokes } from "../handicap";
import { countbackBetween, countbackCompare, fromTheOtherSide } from "../stroke-countback";
import { toParText } from "../stroke";
import { playingHandicapRef, strokesByHandingOut, stablefordByName, courseHandicapOver1130 } from "./properties-reference";
import {
  decimalOf,
  readBoardNet,
  readHandicapSentence,
  readNetSentence,
  readPointsSentence,
  readStrokeSentence,
  readTieSentences,
  toParOf,
} from "./figure-reading";

/**
 * EVERY FIGURE EXPLAINS ITSELF — the sentences, read back as a golfer reads
 * them (2026-10-24).
 *
 * Each property takes the numbers OUT OF THE WORDS (`figure-reading.ts`) and
 * does the arithmetic the sentence claims, then holds the result to two things:
 * the figure the screen prints (the function's own answer), and the Rule worked
 * a second way in whole numbers (`properties-reference.ts`), which shares
 * neither the app's formula nor its floating point. A sentence that agreed with
 * the code and not the Rule fails the second; a sentence whose words drifted
 * from the figure fails the first.
 *
 * Across the axes the panel named: formats (strokes, Stableford, Modified),
 * allowances, plus handicaps, nine holes, and tees of a different par.
 */
const RUNS = { seed: 20261024, numRuns: 1500 } as const;
const strokeIndexOf = (n: number) =>
  fc.shuffledSubarray(Array.from({ length: n }, (_, i) => i + 1), { minLength: n, maxLength: n });

describe("a stroke dot (Rules of Handicapping, Appendix E)", () => {
  it("the sentence's own numbers give the dots in the box, and the Rule gives the same", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(9, 18),
        fc.integer({ min: -10, max: 54 }),
        fc.nat(17),
        (holes, playing, at) =>
          fc.assert(
            fc.property(strokeIndexOf(holes), (si) => {
              const hole = at % holes;
              const w = strokesOnHole(playing, si[hole], holes);
              const r = readStrokeSentence(w.says);
              // The words: the handicap and the stroke index are the ones used.
              expect(r.playing).toBe(playing);
              expect(r.strokeIndex).toBe(si[hole]);
              expect(r.nine).toBe(holes === 9);
              // The lead agrees with the dots, and the spread clause, applied to
              // this stroke index by the reader, agrees with the lead.
              expect(r.lead).toBe(w.shots);
              expect(r.fromSpread).toBe(w.shots);
              // And the Rule, handing the strokes out one at a time.
              expect(w.shots).toBe(strokesByHandingOut(playing, si)[hole]);
              expect(w.cite).toBe(CITE.allocation);
            }),
            { seed: RUNS.seed + playing + holes, numRuns: 3 },
          ),
      ),
      { seed: RUNS.seed, numRuns: 400 },
    );
  });

  it("says the cases the panel named, in plain words", () => {
    // Hole 7, stroke index 7, playing 14: the panel's own example.
    expect(strokesOnHole(14, 7, 18).says).toMatch(/^You get a stroke here: your playing handicap is 14 and this hole is stroke index 7/);
    // Two strokes: 22 is one everywhere and a second on stroke index 1 to 4.
    const two = strokesOnHole(22, 3, 18);
    expect(two.shots).toBe(2);
    expect(two.says).toMatch(/You get 2 strokes here.*one on every hole and one more on stroke index 1 to 4/);
    // A plus handicap gives a stroke back on the easiest hole.
    const plus = strokesOnHole(-2, 18, 18);
    expect(plus.shots).toBe(-1);
    expect(plus.says).toMatch(/^You give a stroke back here: your playing handicap is \+2.*stroke index 17 to 18/);
    expect(strokesOnHole(-2, 16, 18).shots).toBe(0);
    // Nine holes: 5 strokes over the nine, stroke index 1 to 5 of these nine.
    const nine = strokesOnHole(5, 5, 9);
    expect(nine.says).toMatch(/stroke index 5 of nine, and its 5 strokes go one a hole on stroke index 1 to 5 of these nine holes/);
    // Ten over nine: one everywhere and a second on stroke index 1.
    expect(strokesOnHole(10, 1, 9).shots).toBe(2);
  });
});

/** A tee and an index, as the property tests generate them. */
const priced = fc.record({
  indexTenths: fc.integer({ min: -100, max: 540 }),
  slope: fc.integer({ min: 55, max: 155 }),
  par: fc.integer({ min: 66, max: 74 }),
  ratingOff: fc.integer({ min: -40, max: 40 }),
  pct: fc.constantFrom(100, 95, 90, 85, 80, 75, 50, 35, 25),
  parStrokes: fc.constantFrom(0, 0, 1, 2),
  source: fc.constantFrom("member" as const, "frozen" as const),
  locale: fc.constantFrom("en-GB", "de-DE", "fr-FR", "en-US"),
});

describe("a playing handicap (Rules 6.2a and 6.2b, Appendix C)", () => {
  it("the sentence's arithmetic gives the playing handicap, and the Rule in whole numbers gives the same", () => {
    fc.assert(
      fc.property(priced, (t) => {
        const rating = t.par * 10 + t.ratingOff;
        const exact = courseHandicapExact(t.indexTenths / 10, { courseRating: rating / 10, slopeRating: t.slope, par: t.par });
        const playing = roundPlayingHandicap(exact, t.pct, t.parStrokes);
        const parts: HandicapParts = { courseExact: exact, source: t.source, allowance: t.pct, parStrokes: t.parStrokes, playing };
        const w = playingHandicapWorking(parts, t.locale);
        const r = readHandicapSentence(w.says);
        // The figure on the card, and the Rule's own answer.
        expect(r.playing).toBe(playing);
        expect(playing).toBe(playingHandicapRef(t.indexTenths, t.slope, rating, t.par, t.pct) + t.parStrokes);
        // The reader's arithmetic: the share rounds to what the sentence says,
        // and the strokes for the pars are added after it, never inside it.
        expect(r.pct).toBe(t.pct);
        expect(r.rounded + r.parStrokes).toBe(r.playing);
        expect(r.parStrokes).toBe(t.parStrokes);
        // The course handicap printed is the exact one, cut to two places —
        // within a hundredth of the Rule's exact fraction.
        const exactRef = Number(courseHandicapOver1130(t.indexTenths, t.slope, rating, t.par)) / 1130;
        expect(Math.abs(r.base - exactRef)).toBeLessThan(0.0101);
        if (r.share !== null) {
          // The share written is the base's share, and rounds (a half up) to the figure.
          expect(Math.abs(r.share - (r.base * r.pct) / 100)).toBeLessThan(0.0201);
          expect(Math.floor(r.share + 0.5 + 1e-9)).toBe(r.rounded);
        }
        expect(w.cite).toBe(t.parStrokes ? CITE.playingWithPars : CITE.playing);
      }),
      RUNS,
    );
  });

  it("a committee's own figure is said as theirs, and the club's decimal mark is used", () => {
    const w = playingHandicapWorking({ courseExact: 13, source: "override", allowance: 95, parStrokes: 0, playing: 12 });
    expect(w.says).toBe("Your playing handicap of 12 is 95% of the committee's figure of 13 for this round: 12.35, rounded once to 12.");
    const de = playingHandicapWorking({ courseExact: 14.7345, source: "member", allowance: 95, parStrokes: 1, playing: 15 }, "de-DE");
    expect(de.says).toContain("course handicap of 14,73: 13,99, rounded once to 14, and 1 more for playing tees of a higher par");
  });

  it("a figure is CUT to two places, so a reader's rounding lands where the Rule's did", () => {
    // 12.4999… must not be printed 12.50: a reader would round it to 13.
    expect(twoPlaces(12.4999)).toBe("12.49");
    // A half that arrives a hair under is a half (`wholeStrokes`' sliver).
    expect(twoPlaces(12.499999999999998)).toBe("12.5");
    expect(twoPlaces(24.6)).toBe("24.6");
    expect(twoPlaces(-2.185)).toBe("+2.19");
    fc.assert(
      fc.property(fc.integer({ min: -2000000, max: 6000000 }), (n) => {
        const x = n / 100000;
        expect(Math.floor(decimalOf(twoPlaces(x)) + 0.5 + 1e-9)).toBe(wholeStrokes(x));
      }),
      RUNS,
    );
  });
});

const cardGen = (holes: number) =>
  fc.record({
    playing: fc.integer({ min: -6, max: 40 }),
    si: strokeIndexOf(holes),
    pars: fc.array(fc.constantFrom(3, 4, 5), { minLength: holes, maxLength: holes }),
    strokes: fc.array(fc.option(fc.integer({ min: 1, max: 10 }), { nil: null, freq: 4 }), { minLength: holes, maxLength: holes }),
  });

describe("a net score", () => {
  for (const holes of [9, 18]) {
    it(`over ${holes} holes: gross less the strokes received gives the net on the card, as the Rule hands them out`, () => {
      fc.assert(
        fc.property(cardGen(holes), (c) => {
          const shots = c.si.map((s) => strokesOnHole(c.playing, s, holes).shots);
          const fig = cardFigures(c.strokes, c.pars, shots, holes);
          const w = netWorking(fig, holes, c.playing, null);
          const played = c.strokes.filter((s) => s != null).length;
          if (played === 0) return void expect(w).toBeNull();
          const r = readNetSentence(w!.says);
          // The sentence's own arithmetic, and the figure on the card.
          expect(r.gross - r.taken).toBe(r.net);
          expect(r.net).toBe(fig.net);
          // The Rule: the gross, and the strokes handed out on the holes played.
          const ref = strokesByHandingOut(c.playing, c.si);
          const gross = c.strokes.reduce<number>((a, s) => a + (s ?? 0), 0);
          const received = c.strokes.reduce<number>((a, s, i) => a + (s != null ? ref[i] : 0), 0);
          expect(r.gross).toBe(gross);
          expect(r.taken).toBe(received);
          if (!r.whole) expect(r.holesPlayed).toBe(played);
          // "playing handicap N" only when the whole of it was received.
          if (r.whole) expect(r.taken).toBe(c.playing);
        }),
        RUNS,
      );
    });
  }

  it("names the playing handicap's working when the round's parts are known (the panel's example)", () => {
    const strokes = [5, 5, 4, 5, 4, 5, 6, 4, 5, 5, 4, 5, 5, 4, 6, 5, 4, 5];
    const shots = Array.from({ length: 18 }, (_, i) => strokesOnHole(14, i + 1, 18).shots);
    const fig = cardFigures(strokes, new Array(18).fill(4), shots, 18);
    const w = netWorking(fig, 18, 14, { courseExact: 14.7345, source: "member", allowance: 95, parStrokes: 0, playing: 14 })!;
    expect(w.says).toBe(
      `Gross ${fig.gross} − playing handicap 14 = net ${fig.gross - 14}. Your playing handicap of 14 is 95% of your course handicap of 14.73: 13.99, rounded once to 14.`,
    );
    expect(w.cite).toBe("Rules of Handicapping, Rule 6.2a and Appendix C");
  });
});

describe("Stableford points on a hole (Rules of Golf, Rule 21.1b)", () => {
  it("net and par in the sentence give its points, by the table a scorer learns", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 12 }), fc.constantFrom(3, 4, 5), fc.integer({ min: -2, max: 3 }), (g, par, shots) => {
        const w = pointsOnHole(g, par, shots, "standard");
        const r = readPointsSentence(w.says);
        expect(r.net).toBe(g - shots);
        expect(r.points).toBe(w.points);
        expect(r.points).toBe(stablefordByName(r.net, r.par));
        if (r.gross !== null) expect(r.gross - r.shots).toBe(r.net);
      }),
      RUNS,
    );
  });

  it("says the panel's example", () => {
    expect(pointsOnHole(4, 4, 0, "standard").says).toMatch(/^Net 4 on a par 4: 2 points/);
    expect(pointsOnHole(7, 4, 0, "standard").says).toContain("0 points — a net double bogey or worse scores nothing");
    expect(pointsOnHole(3, 4, 0, "modified").says).toMatch(/^Net 3 on a par 4: 2 points, on the scale/);
  });
});

describe("a countback (Committee Procedures, Section 5A)", () => {
  const card = (holes: number) => fc.array(fc.integer({ min: 2, max: 8 }), { minLength: holes, maxLength: holes });
  const tail = (h: number[], n: number) => h.slice(h.length - n).reduce((a, b) => a + b, 0);

  it("the sentence's totals are the cards' own last 9, 6, 3 and last hole, and they decide the place it says", () => {
    fc.assert(
      fc.property(fc.constantFrom(9, 18), fc.boolean(), (holes, points) =>
        fc.assert(
          fc.property(card(holes), card(holes), (a, b) => {
            const A = { playerId: "a", total: 0, holes: a };
            const B = { playerId: "b", total: 0, holes: b };
            const d = countbackBetween(A, B, holes, points);
            // The comparison the board ranks by is this decision.
            expect(countbackCompare(A, B, holes, points)).toBe(d.order);
            const w = tieWorking([{ name: "Bea Invented", decision: d }], "E", 3, { points })!;
            const [t] = readTieSentences(w.says);
            const ladder = holes >= 18 ? [9, 6, 3, 1] : [6, 3, 1];
            const first = ladder.find((n) => tail(a, n) !== tail(b, n));
            if (first === undefined) {
              expect(t.kind).toBe("shared");
              expect(t.place).toBe(3);
              return;
            }
            expect(t.holes).toBe(first);
            expect(t.mine).toBe(tail(a, first));
            expect(t.theirs).toBe(tail(b, first));
            // Fewer strokes, or more points, is ahead — as the sentence says.
            const aheadByRule = points ? t.mine! > t.theirs! : t.mine! < t.theirs!;
            expect(t.kind).toBe(aheadByRule ? "ahead" : "behind");
            expect(d.order < 0).toBe(aheadByRule);
            // And from the other card's side, the same decision reads the other way.
            const back = readTieSentences(tieWorking([{ name: "Al Invented", decision: fromTheOtherSide(d) }], "E", 3, { points })!.says)[0];
            expect(back.kind).toBe(aheadByRule ? "behind" : "ahead");
            expect([back.mine, back.theirs]).toEqual([t.theirs, t.mine]);
          }),
          { seed: RUNS.seed + holes + Number(points), numRuns: 200 },
        ),
      ),
      { seed: RUNS.seed, numRuns: 4 },
    );
  });

  it("a card not finished is said to be the reason, and the round the countback read is named", () => {
    const d = countbackBetween({ playerId: "a", total: 0, holes: [4, 4, null] }, { playerId: "b", total: 0, holes: [4, 4, 4] }, 18);
    expect(d.incomplete).toBe(true);
    expect(tieWorking([{ name: "Bea Invented", decision: d }], "-2", 2, { points: false })!.says).toBe(
      "Shares 2nd with Bea Invented for now: level on -2, and a countback is read off finished cards.",
    );
    const four = new Array(18).fill(4);
    const won = countbackBetween({ playerId: "a", total: 0, holes: [...four.slice(0, 17), 3] }, { playerId: "b", total: 0, holes: [...four.slice(0, 17), 4] }, 18);
    expect(tieWorking([{ name: "Bea Invented", decision: won, round: "Round 2" }], "+1", 4, { points: false })!.says).toBe(
      "Level with Bea Invented on +1; ahead on the countback over the last 9 holes of Round 2: 35 to 36.",
    );
  });
});

describe("a row with no place", () => {
  it("says why from what is stored, in the order the row's own word is chosen", () => {
    const base = { ranked: false, thru: 18 };
    expect(unplacedWorking({ ...base, ranked: true })).toBeNull();
    expect(unplacedWorking({ ...base, disqualified: true, withdrew: true })!.says).toMatch(/^Disqualified by the committee/);
    expect(unplacedWorking({ ...base, disqualified: true })!.cite).toBe(CITE.disqualified);
    expect(unplacedWorking({ ...base, withdrew: true })!.says).toMatch(/^Withdrew after starting/);
    expect(unplacedWorking({ ...base, missedCut: "Round 1" })!.says).toMatch(/cut made after Round 1/);
    expect(unplacedWorking({ ...base, missedRound: "Round 2" })!.says).toMatch(/No card was returned for Round 2.*\(no return\)/);
    expect(unplacedWorking({ ranked: false, thru: 0, missedRound: "Round 2" })!.cite).toBe(CITE.noReturn);
    expect(unplacedWorking({ ranked: false, thru: 0 })).toBeNull();
    expect(unplacedWorking({ ranked: false, thru: 14 })!.says).toMatch(/^This card stops after 14 holes because the match ended there/);
    expect(unplacedWorking({ ranked: false, thru: 14, absent: true })).toBeNull();
  });
});

describe("a net board's figure", () => {
  it("net less par in the sentence is the to-par the board prints", () => {
    fc.assert(
      fc.property(fc.integer({ min: 60, max: 120 }), fc.integer({ min: -6, max: 36 }), fc.integer({ min: 1, max: 18 }), (gross, received, thru) => {
        const parThru = thru * 4;
        const net = gross - received;
        const toPar = net - parThru;
        const w = boardNetWorking({ gross, net, parThru, thru, toPar })!;
        const r = readBoardNet(w.says);
        expect(r.shown).toBe(toParText(toPar));
        expect(r.gross - r.taken).toBe(r.net);
        expect(r.net - r.par).toBe(toParOf(r.shown));
        expect(r.holes).toBe(thru);
      }),
      RUNS,
    );
  });

  it("is silent without a par to measure against", () => {
    expect(boardNetWorking({ gross: 80, net: 70, parThru: 0, thru: 18, toPar: 80 })).toBeNull();
    expect(boardNetWorking({ gross: 0, net: 0, parThru: 0, thru: 0, toPar: 0 })).toBeNull();
  });
});
