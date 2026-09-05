import { describe, it, expect } from "vitest";
import {
  countbackSegments,
  countbackCompare,
  rankByCountback,
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

describe("ranking a field", () => {
  it("does not reorder players who are not level", () => {
    const rows = rankByCountback([card("a", { 0: 5 }), card("b")], 18);
    expect(rows.map((r) => r.card.playerId)).toEqual(["b", "a"]);
    expect(rows.map((r) => r.rank)).toEqual([1, 2]);
  });

  it("leaves a tie the countback cannot break as a shared position", () => {
    /**
     * The heart of it. Two identical cards used to finish 1st and 2nd by seed
     * order, silently — no shared position anywhere, and nothing telling the
     * committee it had a play-off to run.
     */
    const rows = rankByCountback([card("a"), card("b"), card("c", { 0: 5 })], 18);
    expect(rows.map((r) => r.rank)).toEqual([1, 1, 3]);
    expect(rows[0].tied).toBe(true);
    expect(rows[1].tied).toBe(true);
    expect(rows[2].tied).toBe(false);
  });

  it("numbers the player below a tie by how many are above them", () => {
    // Two share 1st, so the next player is 3rd — not 2nd.
    const rows = rankByCountback([card("a"), card("b"), card("c", { 0: 5 })], 18);
    expect(rows[2].rank).toBe(3);
  });

  it("says how each player was separated, for the sheet", () => {
    const rows = rankByCountback([card("a", { 9: 5, 17: 3 }), card("b")], 18);
    expect(rows[0].separatedBy).toBe("");
    expect(rows[1].separatedBy).toBe("last 6");
  });

  it("is stable, so two runs produce the same sheet", () => {
    const field = [card("a"), card("b"), card("c")];
    const once = rankByCountback(field, 18).map((r) => r.card.playerId);
    const twice = rankByCountback(field, 18).map((r) => r.card.playerId);
    expect(once).toEqual(twice);
  });

  it("ranks on the basis it was given, not on gross", () => {
    // `total` is whatever the competition is played on. A net comp separated
    // on gross would hand the prize to the low handicapper the countback
    // exists to stop, so this function never sees a second number.
    const netA: CountbackCard = { playerId: "a", total: 68, holes: Array(18).fill(4) };
    const netB: CountbackCard = { playerId: "b", total: 70, holes: Array(18).fill(3) };
    expect(rankByCountback([netB, netA], 18).map((r) => r.card.playerId)).toEqual(["a", "b"]);
  });
});
