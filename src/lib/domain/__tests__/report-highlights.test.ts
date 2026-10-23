import { describe, it, expect } from "vitest";
import { reportHighlights, toParWords, averageWords, type HighlightRound } from "../report-highlights";

/**
 * THE HIGHLIGHTS, WORKED OUT BY HAND FIRST.
 *
 * Every expected value below was counted off the cards on paper before the
 * code ran, from the plain definitions golf uses — a birdie is one under the
 * hole's par, an eagle two, a hole-in-one is a 1 — and not by calling anything
 * the module calls. The cards are built so a wrong answer looks different from
 * the right one:
 *
 *   - Cat's first card stops on the 17th. Added up anyway it is a 67, which
 *     would be the lowest gross: only the "complete card" rule keeps Bob's 69.
 *   - Dan's card is a four-ball's (`strokePlay: false`): its 68 would also be
 *     the lowest gross, and its albatross and birdie still count, because they
 *     are facts about his ball whatever the format.
 *   - The longest run is on the SECOND round (Cat, 17 holes), so a run read
 *     off the first round only, or a "first run found", names somebody else.
 *   - The easiest hole is a three-way tie, so a tie broken by order fails.
 */

// Par 72: 36 out, 36 in.
const PARS = [4, 5, 3, 4, 4, 4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 3, 4, 5];
/** A par card with some holes changed: `{ 3: 1 }` puts a 1 on the 3rd. */
const card = (changes: Record<number, number | null>) => PARS.map((p, i) => (i + 1 in changes ? changes[i + 1] : p));

const round = (over: Partial<HighlightRound> & Pick<HighlightRound, "label" | "cards">): HighlightRound => ({
  stageId: over.label,
  holes: 18,
  firstHole: 1,
  pars: PARS,
  strokePlay: true,
  venue: "home",
  ...over,
});

const R1 = round({
  label: "Round 1",
  cards: [
    // 70: an ace on the 3rd (par 3), a birdie on the 2nd, a bogey on the 10th.
    { playerId: "ann", name: "Ann", strokes: card({ 2: 4, 3: 1, 10: 5 }) },
    // 69: an eagle on the 9th, a bogey on the 12th, birdies on the 13th and 14th.
    { playerId: "bob", name: "Bob", strokes: card({ 9: 3, 12: 4, 13: 3, 14: 4 }) },
    // Stops on the 17th, with a birdie on the 1st and a bogey on the 5th: 67 if
    // anybody adds it up, which would beat Bob's 69.
    { playerId: "cat", name: "Cat", strokes: card({ 1: 3, 5: 5, 18: null }) },
  ],
});
const R2 = round({
  label: "Round 2",
  cards: [
    // 71: birdies on the 1st and 4th, a bogey on the 6th.
    { playerId: "ann", name: "Ann", strokes: card({ 1: 3, 4: 3, 6: 5 }) },
    // 74: a double on the 7th.
    { playerId: "bob", name: "Bob", strokes: card({ 7: 5 }) },
    // 73: par to the 17th, a bogey on the 18th.
    { playerId: "cat", name: "Cat", strokes: card({ 18: 6 }) },
  ],
});
// A four-ball: Dan's own ball, 68, with an albatross (2 on the par-5 9th) and a birdie.
const R3 = round({
  label: "Round 3",
  strokePlay: false,
  cards: [{ playerId: "dan", name: "Dan", strokes: card({ 1: 3, 9: 2 }) }],
});

describe("the highlights of a tournament, off its cards", () => {
  const h = reportHighlights([R1, R2, R3]);

  it("a hole-in-one is a 1, and is listed with its hole, its par and its round", () => {
    expect(h.aces).toEqual([{ name: "Ann", round: "Round 1", hole: 3, par: 3, strokes: 1, what: "hole-in-one" }]);
  });

  it("an eagle is two under par and an albatross three — on any card that is a player's own ball", () => {
    expect(h.eagles).toEqual([
      { name: "Bob", round: "Round 1", hole: 9, par: 5, strokes: 3, what: "eagle" },
      { name: "Dan", round: "Round 3", hole: 9, par: 5, strokes: 2, what: "albatross" },
    ]);
  });

  it("the lowest gross is a complete card on a stroke round — not a card that stopped, not a four-ball", () => {
    expect(h.lowestGross).toEqual({ score: 69, holders: [{ name: "Bob", round: "Round 1" }] });
  });

  it("the best nine is Ann's front nine in round 1, three under", () => {
    expect(h.bestNine).toEqual({ score: 33, toPar: -3, holders: [{ name: "Ann", round: "Round 1", nine: "front" }] });
  });

  it("the longest run at par or better is Cat's 17 holes in round 2", () => {
    expect(h.longestRun).toEqual({ length: 17, holders: [{ name: "Cat", round: "Round 2", from: 1, to: 17 }] });
  });

  it("birdies: seven made, two the most on one card (shared), Ann the most across the tournament", () => {
    // Round 1: Ann 1, Bob 2, Cat 1. Round 2: Ann 2. Round 3: Dan 1.
    expect(h.numbers.birdies).toBe(7);
    expect(h.mostBirdiesInARound).toEqual({
      count: 2,
      holders: [
        { name: "Bob", round: "Round 1" },
        { name: "Ann", round: "Round 2" },
      ],
    });
    expect(h.mostBirdies).toEqual({ count: 3, names: ["Ann"] });
  });

  it("the numbers: complete cards and every-round players are counted on the stroke rounds only", () => {
    // Round 1: Ann and Bob complete (Cat stopped). Round 2: all three.
    expect(h.numbers.cards).toBe(5);
    expect(h.numbers.everyRound).toBe(2);
    // The ace, Bob's eagle and Dan's albatross.
    expect(h.numbers.eagles).toBe(3);
  });

  it("the hardest hole is the 7th (two over par across six scores); the easiest is a three-way tie", () => {
    // The 7th: Bob's 5 in round 2 is the only score off par — +2 over six scores.
    // The 18th is +1 over FIVE scores (Cat's first card has none there): less.
    expect(h.numbers.hardest.map((x) => ({ hole: x.hole, par: x.par, scores: x.scores }))).toEqual([{ hole: 7, par: 3, scores: 6 }]);
    expect(averageWords(h.numbers.hardest[0].average)).toBe("3.3");
    // The 1st (Cat and Ann's birdies), the 3rd (the ace, two under) and the 9th
    // (the eagle) are each two under across six scores.
    expect(h.numbers.easiest.map((x) => x.hole)).toEqual([1, 3, 9]);
    expect(h.numbers.easiest.every((x) => Math.abs(x.overPar - -2 / 6) < 1e-9)).toBe(true);
  });
});

describe("the best nine is measured against its OWN par, not in strokes", () => {
  it("a 35 on a par-36 nine beats a 28 on a par-27 nine", () => {
    const h = reportHighlights([
      round({ label: "Round 1", holes: 9, pars: PARS.slice(0, 9), cards: [{ playerId: "eve", name: "Eve", strokes: card({ 2: 4 }).slice(0, 9) }] }),
      round({
        label: "Round 2",
        holes: 9,
        firstHole: 10,
        venue: "par-three",
        pars: [3, 3, 3, 3, 3, 3, 3, 3, 3],
        cards: [{ playerId: "fay", name: "Fay", strokes: [3, 3, 3, 3, 3, 3, 3, 3, 4] }],
      }),
    ]);
    expect(h.bestNine).toEqual({ score: 35, toPar: -1, holders: [{ name: "Eve", round: "Round 1", nine: "front" }] });
  });

  it("a nine-hole round played on the back nine numbers its holes from the 10th", () => {
    const h = reportHighlights([
      round({
        label: "Round 1",
        holes: 9,
        firstHole: 10,
        pars: PARS.slice(9),
        // Par for six, then a bogey on the 16th, then par: the run is the 10th to the 15th.
        cards: [{ playerId: "gus", name: "Gus", strokes: [4, 4, 3, 4, 5, 4, 4, 4, 5] }],
      }),
    ]);
    expect(h.longestRun).toEqual({ length: 6, holders: [{ name: "Gus", round: "Round 1", from: 10, to: 15 }] });
    expect(h.bestNine?.holders[0].nine).toBe("back");
  });
});

describe("what the cards cannot say is not said", () => {
  it("with no par, a 3 is not an eagle and nothing is a birdie — but a 1 is still a hole-in-one", () => {
    const h = reportHighlights([
      round({ label: "Round 1", pars: new Array(18).fill(0), cards: [{ playerId: "hal", name: "Hal", strokes: [1, 3, ...new Array(16).fill(4)] }] }),
    ]);
    expect(h.aces).toHaveLength(1);
    expect(h.eagles).toEqual([]);
    expect(h.numbers.birdies).toBe(0);
    expect(h.bestNine).toBeNull();
    expect(h.longestRun).toBeNull();
    expect(h.numbers.hardest).toEqual([]);
  });

  it("a run of two is not a highlight, and one round has no 'every round' or tournament-wide birdie count", () => {
    const h = reportHighlights([
      round({ label: "Round 1", cards: [{ playerId: "ida", name: "Ida", strokes: PARS.map((p, i) => (i % 3 === 2 ? p + 1 : p - 1)) }] }),
    ]);
    expect(h.longestRun).toBeNull();
    expect(h.numbers.everyRound).toBeNull();
    expect(h.mostBirdies).toBeNull();
    // Twelve birdies on one card is the most in a round.
    expect(h.mostBirdiesInARound).toEqual({ count: 12, holders: [{ name: "Ida", round: "Round 1" }] });
  });
});

describe("the words", () => {
  it("says a score against par as golf does", () => {
    expect(toParWords(-3)).toBe("three under par");
    expect(toParWords(0)).toBe("level par");
    expect(toParWords(1)).toBe("one over par");
    expect(toParWords(-14)).toBe("14 under par");
  });
});
