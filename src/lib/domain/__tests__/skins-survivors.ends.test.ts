import { describe, it, expect } from "vitest";
import { playSkins, type SkinsPlayer } from "../skins";
import { endsWithin } from "../../__tests__/ends-within";

/**
 * The survivors of `skins.ts` under Stryker (J49, 2026-11-12), each worked by hand from the skins
 * rule: a hole is won only OUTRIGHT, a tie carries its value on, a hole nobody has finished is not a
 * tie, and a gross game gives nobody strokes however the card is marked.
 *
 * Every call goes through `endsWithin`: a broken loop step in `playSkins` (`h -= 1`) never ends, and
 * an assertion cannot fail a loop that does not end (`ends-within.ts`).
 */
const p = (playerId: string, strokes: (number | null)[], courseHandicap = 0): SkinsPlayer => ({ playerId, strokes, courseHandicap });
const EIGHTEEN = Array.from({ length: 18 }, (_, i) => i + 1);

describe("playSkins, worked by hand", () => {
  it("each hole goes to the lone low score, and equal skins list in player order", () => {
    // Hole 1: A 3 beats B 4 and C 5. Hole 2: B 3 beats A 4 and C 5. One skin each; C has none.
    const out = endsWithin(() => playSkins([p("C", [5, 5]), p("B", [4, 3]), p("A", [3, 4])], 2));
    expect(out.holes).toEqual([
      { hole: 1, playerId: "A", value: 1, score: 3, carried: false },
      { hole: 2, playerId: "B", value: 1, score: 3, carried: false },
    ]);
    expect(out.standings.map((s) => [s.playerId, s.skins, s.holesWon])).toEqual([
      ["A", 1, [1]],
      ["B", 1, [2]],
      ["C", 0, []],
    ]);
    expect(out.unclaimed).toBe(0);
  });

  it("a hole one player has finished and the other has not is not scored, and does not carry", () => {
    // B has no score on hole 1: one score is not a contest. Hole 2 is then worth ONE skin, not two.
    const out = endsWithin(() => playSkins([p("A", [4, 4]), p("B", [null, 5])], 2));
    expect(out.holes).toEqual([{ hole: 2, playerId: "A", value: 1, score: 4, carried: false }]);
    expect(out.unclaimed).toBe(0);
  });

  it("a hole with a score missing off the end of a card is not scored either", () => {
    const out = endsWithin(() => playSkins([p("A", [4, 4]), p("B", [5])], 2));
    expect(out.holes.map((h) => h.hole)).toEqual([1]);
  });

  it("a score that is not a number is not a score: no hole, no carry", () => {
    // NaN and Infinity are not strokes. Hole 1 and hole 2 each have one real score, so neither is played.
    const out = endsWithin(() => playSkins([p("A", [4, 4]), p("B", [Number.NaN, Number.POSITIVE_INFINITY])], 2));
    expect(out.holes).toEqual([]);
    expect(out.unclaimed).toBe(0);
    expect(out.standings.every((s) => s.skins === 0)).toBe(true);
  });

  it("a tie carries: the next outright winner takes both skins and the tie is shown as carried", () => {
    const out = endsWithin(() => playSkins([p("A", [4, 3]), p("B", [4, 5])], 2));
    expect(out.holes).toEqual([
      { hole: 1, playerId: null, value: 1, score: 4, carried: true },
      { hole: 2, playerId: "A", value: 2, score: 3, carried: false },
    ]);
    expect(out.standings[0]).toEqual({ playerId: "A", skins: 2, holesWon: [2] });
    expect(out.unclaimed).toBe(0);
  });

  it("a tie on the last hole leaves its value unclaimed", () => {
    const out = endsWithin(() => playSkins([p("A", [3, 4, 4]), p("B", [4, 4, 4])], 3));
    // A takes hole 1. Holes 2 and 3 tie: two skins left on the table.
    expect(out.standings[0].skins).toBe(1);
    expect(out.unclaimed).toBe(2);
  });
});

describe("gross and net", () => {
  // A has course handicap 18 (one stroke on every hole); B is scratch. Hole 1 is stroke index 1.
  const field = () => [p("A", [5], 18), p("B", [4], 0)];

  it("a GROSS game gives nobody strokes, even with a stroke index on the card", () => {
    // 5 against 4 on the card: B wins outright. If strokes were applied A's net 4 would tie it.
    const out = endsWithin(() => playSkins(field(), 1, { net: false, strokeIndex: EIGHTEEN }));
    expect(out.holes).toEqual([{ hole: 1, playerId: "B", value: 1, score: 4, carried: false }]);
  });

  it("a NET game takes the stroke off: A's 5 less one is 4, level with B, so the hole carries", () => {
    const out = endsWithin(() => playSkins(field(), 1, { net: true, strokeIndex: EIGHTEEN }));
    expect(out.holes).toEqual([{ hole: 1, playerId: null, value: 1, score: 4, carried: true }]);
    expect(out.unclaimed).toBe(1);
  });

  it("with no options at all the game is gross", () => {
    const out = endsWithin(() => playSkins(field(), 1));
    expect(out.holes[0]).toMatchObject({ playerId: "B", carried: false });
  });
});
