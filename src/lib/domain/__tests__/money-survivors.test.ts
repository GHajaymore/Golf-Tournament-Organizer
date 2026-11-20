import { describe, it, expect } from "vitest";
import { splitExactly, potCents, settle } from "../money";

/**
 * J49: the mutants of `domain/money.ts` that no test noticed. Everything is whole cents and every
 * expectation is worked by hand in whole-number division (the largest remainder: each share's whole
 * cents first, then the odd cents to the biggest leftover fractions, a dead heat to the lower position),
 * not by running the function and copying what it says. TourneyHQ records these figures; it never moves
 * the money.
 */

describe("splitExactly: the largest remainder", () => {
  it("an even split leaves nothing to hand out", () => {
    expect(splitExactly(100, [1, 1])).toEqual([50, 50]);
    expect(splitExactly(100, [1, 1, 1, 1])).toEqual([25, 25, 25, 25]);
    expect(splitExactly(90, [1, 2])).toEqual([30, 60]);
  });

  it("equal leftovers: the odd cents go to the earliest positions", () => {
    // 100 / 3 = 33 r 1
    expect(splitExactly(100, [1, 1, 1])).toEqual([34, 33, 33]);
    // 10 / 3 = 3 r 1
    expect(splitExactly(10, [1, 1, 1])).toEqual([4, 3, 3]);
    // 7 / 4 = 1 r 3
    expect(splitExactly(7, [1, 1, 1, 1])).toEqual([2, 2, 2, 1]);
    // 11 / 3 = 3 r 2
    expect(splitExactly(11, [1, 1, 1])).toEqual([4, 4, 3]);
  });

  it("unequal leftovers: the biggest fraction takes the cent, not the first position", () => {
    // 100 across 1:2 is 33.33 and 66.67, so the second is rounded down hardest
    expect(splitExactly(100, [1, 2])).toEqual([33, 67]);
    expect(splitExactly(100, [2, 1])).toEqual([67, 33]);
    // 100 across 1,1,2,3 (sum 7): 14.29, 14.29, 28.57, 42.86; floors total 98; the .86 and .57 take the two
    expect(splitExactly(100, [1, 1, 2, 3])).toEqual([14, 14, 29, 43]);
    // weights 1,2,3 (sum 6): 10 -> 1.67, 3.33, 5.00; floors 1,3,5 = 9; the .67 is largest
    expect(splitExactly(10, [1, 2, 3])).toEqual([2, 3, 5]);
  });

  it("only as many cents are handed out as are left, no more", () => {
    // exactly 2 left over of 4 equal fractions: the other two must not get a cent
    expect(splitExactly(6, [1, 1, 1, 1])).toEqual([2, 2, 1, 1]);
    // nothing left over: nobody gets an extra
    expect(splitExactly(4, [1, 1, 1, 1])).toEqual([1, 1, 1, 1]);
    expect(splitExactly(12, [1, 1, 1])).toEqual([4, 4, 4]);
  });

  it("a zero weight takes nothing, even when cents are left to hand out", () => {
    expect(splitExactly(10, [0, 1, 1])).toEqual([0, 5, 5]);
    expect(splitExactly(7, [0, 1, 1])).toEqual([0, 4, 3]);
    expect(splitExactly(7, [1, 1, 0])).toEqual([4, 3, 0]);
    expect(splitExactly(7, [1, 0, 1])).toEqual([4, 0, 3]);
  });

  it("a negative weight counts as none: in the share and in the sum", () => {
    // sum of the usable weights is 1, not -2
    expect(splitExactly(5, [-3, 1])).toEqual([0, 5]);
    expect(splitExactly(5, [1, -3])).toEqual([5, 0]);
    expect(splitExactly(9, [-1, 1, 2])).toEqual([0, 3, 6]);
  });

  it("no usable weight, or nothing to split: every part is zero", () => {
    expect(splitExactly(100, [0, 0])).toEqual([0, 0]);
    expect(splitExactly(100, [-1, -2, 0])).toEqual([0, 0, 0]);
    expect(splitExactly(0, [1, 2, 3])).toEqual([0, 0, 0]);
    expect(splitExactly(100, [])).toEqual([]);
    expect(splitExactly(-50, [1, 1])).toEqual([0, 0]);
  });

  it("the total is read as whole cents: rounded to the nearest, a half up", () => {
    expect(splitExactly(2.4, [1])).toEqual([2]);
    expect(splitExactly(2.5, [1])).toEqual([3]);
    expect(splitExactly(10.6, [1, 1])).toEqual([6, 5]);
    expect(splitExactly(10.4, [1, 1])).toEqual([5, 5]);
    // a negative fraction that rounds to nought is nought
    expect(splitExactly(-0.4, [1, 1])).toEqual([0, 0]);
  });

  it("a single player takes the whole", () => {
    expect(splitExactly(1001, [1])).toEqual([1001]);
    expect(splitExactly(1001, [7])).toEqual([1001]);
  });

  it("a total smaller than the number of players gives one cent each to the first positions", () => {
    expect(splitExactly(2, [1, 1, 1, 1])).toEqual([1, 1, 0, 0]);
    expect(splitExactly(1, [1, 1, 1])).toEqual([1, 0, 0]);
  });

  it("a long dead heat still goes to the earliest positions, in order", () => {
    // 3 cents across 8 equal weights: every fraction is 0.375, so the first three positions take one each
    expect(splitExactly(3, Array(8).fill(1))).toEqual([1, 1, 1, 0, 0, 0, 0, 0]);
    // 5 cents across 40: the first five
    const forty = splitExactly(5, Array(40).fill(1));
    expect(forty.slice(0, 5)).toEqual([1, 1, 1, 1, 1]);
    expect(forty.slice(5).every((p) => p === 0)).toBe(true);
    // 25 across 30 (a fraction of 0.833 each): the first twenty-five
    const thirty = splitExactly(25, Array(30).fill(1));
    expect(thirty).toEqual([...Array(25).fill(1), ...Array(5).fill(0)]);
  });

  it("always sums to the whole", () => {
    for (const [cents, weights] of [
      [1001, [1, 1]],
      [999, [3, 3, 3]],
      [100, [1, 1, 2, 3]],
      [7, [1, 1, 1, 1]],
    ] as Array<[number, number[]]>) {
      expect(splitExactly(cents, weights).reduce((a, b) => a + b, 0)).toBe(cents);
    }
  });
});

describe("potCents: stake times entrants, in whole cents", () => {
  it("is the stake times the entrants", () => {
    expect(potCents(500, 3)).toBe(1500);
    expect(potCents(1, 1)).toBe(1);
    expect(potCents(1001, 2)).toBe(2002);
  });

  it("nobody in, or no stake, is an empty pot", () => {
    expect(potCents(500, 0)).toBe(0);
    expect(potCents(0, 5)).toBe(0);
    expect(potCents(0, 0)).toBe(0);
  });

  it("a negative stake or a negative field is an empty pot, not a debt", () => {
    expect(potCents(-500, 3)).toBe(0);
    expect(potCents(500, -3)).toBe(0);
    expect(potCents(-500, -3)).toBe(0);
  });

  it("the stake is rounded to the nearest cent (a half up), the entrants to the whole player below", () => {
    expect(potCents(10.4, 2)).toBe(20);
    expect(potCents(10.5, 2)).toBe(22);
    expect(potCents(10, 2.9)).toBe(20);
    expect(potCents(10, 2.1)).toBe(20);
    expect(potCents(10, 0.9)).toBe(0);
  });
});

describe("settle: who hands money to whom", () => {
  const nets = (...rows: Array<[string, number]>) => rows.map(([playerId, netCents]) => ({ playerId, netCents }));

  it("nobody, or everybody square, settles nothing", () => {
    expect(settle([])).toEqual([]);
    expect(settle(nets(["a", 0], ["b", 0]))).toEqual([]);
  });

  it("one owes one", () => {
    expect(settle(nets(["a", -500], ["b", 500]))).toEqual([{ fromPlayerId: "a", toPlayerId: "b", cents: 500 }]);
  });

  it("a player who is square is not in any handover", () => {
    expect(settle(nets(["a", -500], ["mid", 0], ["b", 500]))).toEqual([{ fromPlayerId: "a", toPlayerId: "b", cents: 500 }]);
  });

  it("the biggest debt is paid first", () => {
    expect(settle(nets(["d1", -300], ["d2", -500], ["c", 800]))).toEqual([
      { fromPlayerId: "d2", toPlayerId: "c", cents: 500 },
      { fromPlayerId: "d1", toPlayerId: "c", cents: 300 },
    ]);
  });

  it("the biggest creditor is paid first", () => {
    expect(settle(nets(["d", -800], ["c1", 300], ["c2", 500]))).toEqual([
      { fromPlayerId: "d", toPlayerId: "c2", cents: 500 },
      { fromPlayerId: "d", toPlayerId: "c1", cents: 300 },
    ]);
  });

  it("equal debts are taken in id order", () => {
    expect(settle(nets(["b", -100], ["a", -100], ["c", 200]))).toEqual([
      { fromPlayerId: "a", toPlayerId: "c", cents: 100 },
      { fromPlayerId: "b", toPlayerId: "c", cents: 100 },
    ]);
  });

  it("equal credits are paid in id order", () => {
    expect(settle(nets(["z", -200], ["y", 100], ["x", 100]))).toEqual([
      { fromPlayerId: "z", toPlayerId: "x", cents: 100 },
      { fromPlayerId: "z", toPlayerId: "y", cents: 100 },
    ]);
  });

  it("a debt larger than one credit is carried to the next creditor", () => {
    // A owes 700, B owes 300; C is owed 600, D is owed 400
    expect(settle(nets(["A", -700], ["B", -300], ["C", 600], ["D", 400]))).toEqual([
      { fromPlayerId: "A", toPlayerId: "C", cents: 600 },
      { fromPlayerId: "A", toPlayerId: "D", cents: 100 },
      { fromPlayerId: "B", toPlayerId: "D", cents: 300 },
    ]);
  });

  it("a debt and a credit that match to the cent both close at once", () => {
    expect(settle(nets(["A", -100], ["B", -200], ["C", 100], ["D", 200]))).toEqual([
      { fromPlayerId: "B", toPlayerId: "D", cents: 200 },
      { fromPlayerId: "A", toPlayerId: "C", cents: 100 },
    ]);
  });

  it("a ledger that does not sum to nought moves only what both sides can match", () => {
    expect(settle(nets(["a", -100], ["b", 300]))).toEqual([{ fromPlayerId: "a", toPlayerId: "b", cents: 100 }]);
    expect(settle(nets(["a", -300], ["b", 100]))).toEqual([{ fromPlayerId: "a", toPlayerId: "b", cents: 100 }]);
    // only debtors, or only creditors: nobody to hand to
    expect(settle(nets(["a", -300], ["b", -100]))).toEqual([]);
    expect(settle(nets(["a", 300], ["b", 100]))).toEqual([]);
  });

  it("does not change the list it was given", () => {
    const input = nets(["b", -100], ["a", 100]);
    const copy = JSON.parse(JSON.stringify(input));
    settle(input);
    expect(input).toEqual(copy);
  });
});
