import { describe, it, expect } from "vitest";
import {
  countbackSegments,
  countbackCompare,
  countbackStep,
  countbackStepWords,
  type CountbackCard,
} from "@/lib/domain/stroke-countback";

/** A card of 18 fours (72), with the named holes changed. */
const card = (playerId: string, over: Record<number, number> = {}): CountbackCard => {
  const holes = Array.from({ length: 18 }, () => 4) as (number | null)[];
  for (const [h, v] of Object.entries(over)) holes[Number(h)] = v;
  const total = holes.reduce((a: number, b) => a + (b ?? 0), 0);
  return { playerId, total, holes };
};

describe("the ladder", () => {
  it("is last 9, 6, 3 then the last hole over eighteen", () => {
    expect(countbackSegments(18)).toEqual([9, 6, 3, 1]);
  });

  it("starts at the last six over nine", () => {
    // A "last nine" of a nine-hole round is the whole round — the number that
    // was already equal, so it separates nobody.
    expect(countbackSegments(9)).toEqual([6, 3, 1]);
  });
});

describe("separating two cards on the same score", () => {
  it("gives it to the better back nine", () => {
    // Both 72. A is one worse on the front, one better on the back.
    const a = card("a", { 0: 5, 17: 3 });
    const b = card("b");
    expect(countbackCompare(a, b, 18)).toBeLessThan(0);
  });

  it("falls to the last six when the nines match", () => {
    // Level over the last nine; A is better over the last six.
    const a = card("a", { 9: 5, 17: 3 });
    const b = card("b");
    expect(countbackCompare(a, b, 18)).toBeLessThan(0);
  });

  it("falls all the way to the last hole", () => {
    const a = card("a", { 8: 5, 17: 3 });
    const b = card("b");
    expect(countbackCompare(a, b, 18)).toBeLessThan(0);
  });

  it("runs the other way for points", () => {
    /**
     * A Stableford countback compares POINTS, and more is better.
     *
     * The same numbers read as strokes give the opposite answer, which is the
     * whole reason the direction is a parameter rather than assumed: a points
     * competition separated the strokes way hands the tie to whoever scored
     * fewest.
     */
    // Level on 72 "points"; A scores one more on the last hole, one fewer on
    // the first — so A is ahead over the last nine, six, three and one.
    const a = card("a", { 0: 3, 17: 5 });
    const b = card("b");
    expect(countbackCompare(a, b, 18, true), "more points over the last nine wins").toBeLessThan(0);
    // And the default is unchanged for every existing caller.
    expect(countbackCompare(a, b, 18)).toBeGreaterThan(0);
  });

  it("says nothing when two cards match at every step", () => {
    expect(countbackCompare(card("a"), card("b"), 18)).toBe(0);
  });

  it("refuses to decide on an incomplete card", () => {
    // A countback is a tiebreak between two FINISHED rounds. Deciding a
    // competition on a data-entry gap is worse than leaving it tied.
    const a = card("a");
    const short: CountbackCard = { playerId: "b", total: 72, holes: [...a.holes.slice(0, 17), null] };
    expect(countbackCompare(a, short, 18)).toBe(0);
    expect(countbackCompare(short, a, 18)).toBe(0);
  });
});

describe("which step of the countback decided it (the report's 'won on countback, back 9')", () => {
  it("names the first step that separates them, and the comparison agrees with countbackCompare", () => {
    // Level on the back nine (one worse on the 10th, one better on the 13th), apart on the last six.
    const a = card("a", { 9: 5, 12: 3 });
    const b = card("b");
    expect(countbackStep(a, b, 18)?.holes).toBe(6);
    expect(Math.sign(countbackStep(a, b, 18)!.compare)).toBe(Math.sign(countbackCompare(a, b, 18)));
    expect(countbackStep(card("a", { 1: 5, 10: 3 }), b, 18)?.holes).toBe(9);
    expect(countbackStep(card("a", { 0: 5, 17: 3 }), b, 18)?.holes).toBe(9);
    expect(countbackStep(card("a", { 8: 5, 17: 3 }), b, 18)?.holes).toBe(1);
  });

  it("is null where the countback cannot part them", () => {
    expect(countbackStep(card("a"), card("b"), 18)).toBeNull();
  });

  it("words a step the way a results sheet does: the back nine of eighteen is the back 9", () => {
    expect(countbackStepWords(9, 18)).toBe("back 9");
    expect(countbackStepWords(6, 18)).toBe("last 6");
    expect(countbackStepWords(6, 9)).toBe("last 6");
    expect(countbackStepWords(3, 18)).toBe("last 3");
    expect(countbackStepWords(1, 18)).toBe("last hole");
  });
});
