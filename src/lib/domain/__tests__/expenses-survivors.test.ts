import { describe, it, expect } from "vitest";
import {
  shareOf,
  paymentsOf,
  balances,
  combinedBalances,
  positionFor,
  canChangeExpense,
  canUndoSettlement,
  evenShares,
  type Expense,
} from "../expenses";

/**
 * J49: the mutants of `domain/expenses.ts` that no test noticed. Whole cents throughout; every
 * expectation is worked by hand (adding and subtracting cents on paper), not by running the function
 * and copying what it says. TourneyHQ records these figures; it never moves the money.
 */

const obj = (m: Map<string, number>) => Object.fromEntries(m);
const MARK = "Stryker was here!"; // the string a literal-swapping mutant puts in place of ""

const exp = (over: Partial<Expense>): Expense => ({
  id: "e",
  description: "x",
  amountCents: 0,
  paidBy: "a",
  shares: [],
  ...over,
});

describe("shareOf: exact amounts", () => {
  it("one share with an amount switches the whole line to amounts (a share without one owes 0)", () => {
    // Weights alone would be 300/300. Exact mode: a owes 600, b owes nothing.
    const m = shareOf(
      exp({
        amountCents: 600,
        shares: [
          { playerId: "a", weight: 1, amountCents: 600 },
          { playerId: "b", weight: 1 },
        ],
      }),
    );
    expect(obj(m)).toEqual({ a: 600, b: 0 });
  });

  it("a share with no player id is dropped, and its cents fall to the largest share", () => {
    // 500 (nobody) is ignored; a's 300 is 500 short of the 800 bill, so a owes the 800.
    const m = shareOf(
      exp({
        amountCents: 800,
        shares: [
          { playerId: "", weight: 1, amountCents: 500 },
          { playerId: "a", weight: 1, amountCents: 300 },
        ],
      }),
    );
    expect(obj(m)).toEqual({ a: 800 });
  });

  it("a gap with nobody to take it leaves the map empty", () => {
    const m = shareOf(exp({ amountCents: 500, shares: [{ playerId: "", weight: 1, amountCents: 500 }] }));
    expect(m.size).toBe(0);
  });

  it("no gap and nobody to take it leaves the map empty", () => {
    const m = shareOf(exp({ amountCents: 0, shares: [{ playerId: "", weight: 1, amountCents: 0 }] }));
    expect(m.size).toBe(0);
  });

  it("the gap goes to the largest share, not the first or the last", () => {
    // 700 + 300 = 1000, bill 1100: the 100 goes to a (700).
    expect(
      obj(
        shareOf(
          exp({
            amountCents: 1100,
            shares: [
              { playerId: "a", weight: 1, amountCents: 700 },
              { playerId: "b", weight: 1, amountCents: 300 },
            ],
          }),
        ),
      ),
    ).toEqual({ a: 800, b: 300 });
    // The largest is in the middle: 200 + 900 + 400 = 1500, bill 1600: b takes the 100.
    expect(
      obj(
        shareOf(
          exp({
            amountCents: 1600,
            shares: [
              { playerId: "a", weight: 1, amountCents: 200 },
              { playerId: "b", weight: 1, amountCents: 900 },
              { playerId: "c", weight: 1, amountCents: 400 },
            ],
          }),
        ),
      ),
    ).toEqual({ a: 200, b: 1000, c: 400 });
  });

  it("an exact tie for largest: the first named takes the gap", () => {
    // 500 + 500 = 1000, bill 1100: a (first) takes it, so a 600, b 500.
    expect(
      obj(
        shareOf(
          exp({
            amountCents: 1100,
            shares: [
              { playerId: "a", weight: 1, amountCents: 500 },
              { playerId: "b", weight: 1, amountCents: 500 },
            ],
          }),
        ),
      ),
    ).toEqual({ a: 600, b: 500 });
  });

  it("when every amount is 0 the first share takes the whole bill", () => {
    expect(
      obj(
        shareOf(
          exp({
            amountCents: 100,
            shares: [
              { playerId: "a", weight: 1, amountCents: 0 },
              { playerId: "b", weight: 1, amountCents: 0 },
            ],
          }),
        ),
      ),
    ).toEqual({ a: 100, b: 0 });
  });

  it("size is judged by magnitude: a big refund share beats a small charge", () => {
    // -700 + 300 = -400, bill -300, gap +100. The largest by size is a (-700): a owes -600.
    expect(
      obj(
        shareOf(
          exp({
            amountCents: -300,
            shares: [
              { playerId: "a", weight: 1, amountCents: -700 },
              { playerId: "b", weight: 1, amountCents: 300 },
            ],
          }),
        ),
      ),
    ).toEqual({ a: -600, b: 300 });
  });
});

describe("shareOf: weights", () => {
  it("a zero bill gives everyone a plain 0, not minus zero", () => {
    const m = shareOf(exp({ amountCents: 0, shares: [{ playerId: "a", weight: 1 }, { playerId: "b", weight: 1 }] }));
    expect(Object.is(m.get("a"), 0)).toBe(true);
    expect(Object.is(m.get("b"), 0)).toBe(true);
  });

  it("a refund is split like a charge and lands the other way: -1001 across three", () => {
    // 1001 / 3 = 333 r 2: 334, 334, 333, each negated.
    const m = shareOf(
      exp({ amountCents: -1001, shares: [{ playerId: "a", weight: 1 }, { playerId: "b", weight: 1 }, { playerId: "c", weight: 1 }] }),
    );
    expect(obj(m)).toEqual({ a: -334, b: -334, c: -333 });
  });
});

describe("paymentsOf", () => {
  it("a payment with no player id is dropped and its cents settle on paidBy", () => {
    // 300 from nobody is ignored; p1 laid out 700 of the 1000, the other 300 is settled on p1.
    const m = paymentsOf(
      exp({ amountCents: 1000, paidBy: "p1", payments: [{ playerId: "", amountCents: 300 }, { playerId: "p1", amountCents: 700 }] }),
    );
    expect(obj(m)).toEqual({ p1: 1000 });
  });

  it("with no payer named at all, the shortfall goes to the first person listed", () => {
    // a 700 of 1000, paidBy empty: a takes the missing 300.
    const m = paymentsOf(exp({ amountCents: 1000, paidBy: "", payments: [{ playerId: "a", amountCents: 700 }] }));
    expect(obj(m)).toEqual({ a: 1000 });
  });

  it("nobody itemised and nobody named: nobody paid", () => {
    expect(paymentsOf(exp({ amountCents: 500, paidBy: "" })).size).toBe(0);
    expect(paymentsOf(exp({ amountCents: 500, paidBy: "", payments: [] })).size).toBe(0);
  });

  it("nobody itemised: the named payer paid the lot", () => {
    expect(obj(paymentsOf(exp({ amountCents: 500, paidBy: "a" })))).toEqual({ a: 500 });
  });

  it("an overpayment is taken back off paidBy", () => {
    // 600 + 500 = 1100 against a 1000 bill: paidBy b is 100 less, so b 400.
    const m = paymentsOf(
      exp({ amountCents: 1000, paidBy: "b", payments: [{ playerId: "a", amountCents: 600 }, { playerId: "b", amountCents: 500 }] }),
    );
    expect(obj(m)).toEqual({ a: 600, b: 400 });
  });
});

describe("balances", () => {
  it("leaves out a blank player id from the field, and from the shares", () => {
    // 300 paid by a, shared a blank id and b: 150 each. The blank share has no one to carry it.
    const r = balances(
      [exp({ amountCents: 300, paidBy: "a", shares: [{ playerId: "", weight: 1 }, { playerId: "b", weight: 1 }] })],
      ["", "a"],
    );
    expect(r).toEqual([
      { playerId: "a", netCents: 300 },
      { playerId: "b", netCents: -150 },
    ]);
  });

  it("a zero-amount line changes nothing, even when its exact amounts cancel", () => {
    // +500 and -500 on a 0 bill: not a debt in either direction.
    const r = balances([
      exp({
        amountCents: 0,
        paidBy: "a",
        shares: [
          { playerId: "x", weight: 1, amountCents: 500 },
          { playerId: "y", weight: 1, amountCents: -500 },
        ],
      }),
    ]);
    expect(r).toEqual([]);
  });

  it("a personal line (all weights zero) is nobody's debt", () => {
    const r = balances([exp({ amountCents: 400, paidBy: "a", shares: [{ playerId: "a", weight: 0 }] })], ["a"]);
    expect(r).toEqual([{ playerId: "a", netCents: 0 }]);
  });

  it("a line with real shares is counted: 900 paid by p, three ways, 300 each", () => {
    const r = balances(
      [exp({ amountCents: 900, paidBy: "p", shares: [{ playerId: "a", weight: 1 }, { playerId: "b", weight: 1 }, { playerId: "p", weight: 1 }] })],
      ["b", "a"],
    );
    // p: +900 -300 = +600. a, b: -300 each, the tie in id order.
    expect(r).toEqual([
      { playerId: "p", netCents: 600 },
      { playerId: "a", netCents: -300 },
      { playerId: "b", netCents: -300 },
    ]);
  });

  it("the whole field at 0 comes back in id order, whatever order it was named", () => {
    expect(balances([], ["d", "b", "a", "c"])).toEqual([
      { playerId: "a", netCents: 0 },
      { playerId: "b", netCents: 0 },
      { playerId: "c", netCents: 0 },
      { playerId: "d", netCents: 0 },
    ]);
  });

  it("the biggest credit first, the biggest debt last, with a mixed field", () => {
    // 1000 paid by c, split c:1 a:2 (333/667 by largest remainder is not needed: use 3 and 2 weights).
    // weights c 2, a 3, b 0 on 1000: c 400, a 600. c: +1000 -400 = +600. a: -600. b: 0.
    const r = balances(
      [exp({ amountCents: 1000, paidBy: "c", shares: [{ playerId: "c", weight: 2 }, { playerId: "a", weight: 3 }, { playerId: "b", weight: 0 }] })],
      ["a", "b", "c"],
    );
    expect(r).toEqual([
      { playerId: "c", netCents: 600 },
      { playerId: "b", netCents: 0 },
      { playerId: "a", netCents: -600 },
    ]);
  });
});

describe("combinedBalances", () => {
  it("adds the two ledgers, biggest credit first, ties in id order", () => {
    const expenseNets = [
      { playerId: "y", netCents: -300 },
      { playerId: "x", netCents: 100 },
      { playerId: "w", netCents: 200 },
    ];
    const gameNets = [
      { playerId: "z", netCents: 50 },
      { playerId: "u", netCents: 50 },
      { playerId: "v", netCents: -50 },
      { playerId: "t", netCents: -50 },
      { playerId: "y", netCents: 0 },
    ];
    // w 200, x 100, then u and z at 50 (id order), then t and v at -50 (id order), y -300.
    expect(combinedBalances(expenseNets, gameNets)).toEqual([
      { playerId: "w", netCents: 200 },
      { playerId: "x", netCents: 100 },
      { playerId: "u", netCents: 50 },
      { playerId: "z", netCents: 50 },
      { playerId: "t", netCents: -50 },
      { playerId: "v", netCents: -50 },
      { playerId: "y", netCents: -300 },
    ]);
  });

  it("a net with no player id has nobody to belong to", () => {
    expect(
      combinedBalances([{ playerId: "", netCents: 500 }, { playerId: "a", netCents: -500 }], [{ playerId: "", netCents: 70 }]),
    ).toEqual([{ playerId: "a", netCents: -500 }]);
  });

  it("the same player in both ledgers is summed: owed 6000 for dinner, lost 4500 in skins", () => {
    expect(
      combinedBalances([{ playerId: "a", netCents: 6000 }], [{ playerId: "a", netCents: -4500 }]),
    ).toEqual([{ playerId: "a", netCents: 1500 }]);
  });
});

describe("positionFor", () => {
  it("finds the named player, not merely the first", () => {
    const p = positionFor(
      "b",
      [{ playerId: "a", netCents: 100 }, { playerId: "b", netCents: -100 }],
      [{ playerId: "a", netCents: 40 }, { playerId: "b", netCents: 30 }],
    );
    expect(p).toEqual({ playerId: "b", expensesCents: -100, gamesCents: 30, netCents: -70 });
  });

  it("a player in neither ledger is 0 across the board", () => {
    expect(positionFor("q", [{ playerId: "a", netCents: 100 }], [])).toEqual({
      playerId: "q",
      expensesCents: 0,
      gamesCents: 0,
      netCents: 0,
    });
  });
});

describe("canChangeExpense", () => {
  it("staff always may", () => {
    expect(canChangeExpense("anyone", { isStaff: true })).toBe(true);
  });

  it("matches the name exactly after trimming both, case-sensitively", () => {
    expect(canChangeExpense("  Ann Example  ", { name: "Ann Example" })).toBe(true);
    expect(canChangeExpense("Ann Example", { name: "  Ann Example  " })).toBe(true);
    expect(canChangeExpense("ann example", { name: "Ann Example" })).toBe(false);
  });

  it("matches the email ignoring case and padding", () => {
    expect(canChangeExpense(" Ann@Example.invalid ", { email: " ann@example.INVALID " })).toBe(true);
  });

  it("a different email, or a viewer with only an email that does not match, may not", () => {
    expect(canChangeExpense("Zed", { name: "Bea", email: "bea@example.invalid" })).toBe(false);
    expect(canChangeExpense("Zed", { email: "bea@example.invalid" })).toBe(false);
  });

  it("a viewer with no name and no email matches nothing, not even a made-up string", () => {
    expect(canChangeExpense(MARK, {})).toBe(false);
    expect(canChangeExpense("", {})).toBe(false);
    expect(canChangeExpense(undefined as unknown as string, { name: MARK })).toBe(false);
  });
});

describe("canUndoSettlement", () => {
  const s = { recordedBy: "Zed", fromPlayerId: "p1", toPlayerId: "p2" };

  it("staff always may", () => {
    expect(canUndoSettlement(s, { isStaff: true })).toBe(true);
  });

  it("whoever recorded it may, by name (exact, trimmed) or by email (any case, trimmed)", () => {
    expect(canUndoSettlement({ ...s, recordedBy: "  Zed  " }, { name: "Zed" })).toBe(true);
    expect(canUndoSettlement({ ...s, recordedBy: "Zed" }, { name: " Zed " })).toBe(true);
    expect(canUndoSettlement({ ...s, recordedBy: "zed" }, { name: "Zed" })).toBe(false);
    expect(canUndoSettlement({ ...s, recordedBy: " Zed@Example.invalid " }, { email: " zed@example.INVALID " })).toBe(true);
  });

  it("either party to it may, by player id (trimmed)", () => {
    expect(canUndoSettlement(s, { playerId: "p1" })).toBe(true);
    expect(canUndoSettlement(s, { playerId: " p2 " })).toBe(true);
    expect(canUndoSettlement(s, { playerId: "p3" })).toBe(false);
  });

  it("a stranger with a different email may not", () => {
    expect(canUndoSettlement(s, { name: "Bea", email: "bea@example.invalid", playerId: "p9" })).toBe(false);
    expect(canUndoSettlement(s, { email: "bea@example.invalid", playerId: "p9" })).toBe(false);
  });

  it("a viewer with nothing set matches nothing, not even a made-up string", () => {
    expect(canUndoSettlement({ ...s, recordedBy: MARK }, {})).toBe(false);
    expect(canUndoSettlement({ ...s, recordedBy: "" }, { name: "" })).toBe(false);
    expect(canUndoSettlement({ ...s, recordedBy: undefined as unknown as string }, { name: MARK })).toBe(false);
    expect(canUndoSettlement({ ...s, fromPlayerId: MARK }, {})).toBe(false);
  });
});

describe("evenShares", () => {
  it("drops blanks and repeats, keeps the order, weight 1 each", () => {
    expect(evenShares(["a", "", "b", "a"])).toEqual([
      { playerId: "a", weight: 1 },
      { playerId: "b", weight: 1 },
    ]);
  });
});
