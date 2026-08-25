import { describe, it, expect } from "vitest";
import { balances, shareOf, paymentsOf, type Expense } from "../expenses";

/**
 * Every way a group can split a bill, swept for the one invariant that cannot
 * bend: THE LEDGER SUMS TO ZERO.
 *
 * The old model had one payer and one weight per person, which quietly forced
 * every real trip into a shape it is not. A weekend generates: a room somebody
 * only slept in for one night, a bar two of the four went to, a dinner two
 * people put on two different cards, a green fee a guest owes but did not pay
 * for, and a refund. Each of those is a different combination of WHO PAID and
 * WHO SHARES, and the combinations are where the money bugs live — every part
 * behaves correctly on its own.
 *
 * Asserted against the arithmetic, not against current behaviour: money in
 * equals money out, and nobody is charged for something they were not on.
 */

const ex = (e: Partial<Expense> & { amountCents: number }): Expense => ({
  id: e.id ?? "x",
  description: e.description ?? "line",
  paidBy: e.paidBy ?? "a",
  amountCents: e.amountCents,
  payments: e.payments,
  shares: e.shares ?? [
    { playerId: "a", weight: 1 },
    { playerId: "b", weight: 1 },
  ],
});

const sum = (m: Map<string, number>) => [...m.values()].reduce((x, y) => x + y, 0);
const netSum = (n: Array<{ netCents: number }>) => n.reduce((s, r) => s + r.netCents, 0);
const netFor = (n: Array<{ playerId: string; netCents: number }>, id: string) =>
  n.find((r) => r.playerId === id)?.netCents ?? 0;

describe("who pays", () => {
  it("credits a single payer the whole bill, as it always did", () => {
    const e = ex({ amountCents: 10_000, paidBy: "a" });
    expect(paymentsOf(e).get("a")).toBe(10_000);
    expect(sum(paymentsOf(e))).toBe(10_000);
  });

  it("credits two payers what each of them actually put down", () => {
    // The dinner on two cards. Recorded as one bill, because it was one
    // dinner — splitting it into two rows would say the group ate twice.
    const e = ex({
      amountCents: 20_000,
      paidBy: "a",
      payments: [
        { playerId: "a", amountCents: 12_000 },
        { playerId: "b", amountCents: 8_000 },
      ],
    });
    const paid = paymentsOf(e);
    expect(paid.get("a")).toBe(12_000);
    expect(paid.get("b")).toBe(8_000);
    expect(sum(paid)).toBe(20_000);
  });

  it("still totals the bill when the payments do not", () => {
    // Data that predates the boundary check, or a hand-written row. The
    // shortfall lands on the named payer rather than vanishing, because a
    // credit that does not total the bill unbalances every other number.
    const e = ex({
      amountCents: 20_000,
      paidBy: "a",
      payments: [{ playerId: "b", amountCents: 8_000 }],
    });
    const paid = paymentsOf(e);
    expect(sum(paid), "credits must always total the bill").toBe(20_000);
    expect(paid.get("b")).toBe(8_000);
    expect(paid.get("a")).toBe(12_000);
  });

  it("lets somebody pay for a bill they are not on", () => {
    // One player fronts the guest's green fee. He is owed all of it and
    // shares none of it.
    const e = ex({
      amountCents: 9_000,
      paidBy: "a",
      shares: [{ playerId: "guest", weight: 1 }],
    });
    const net = balances([e], ["a", "guest"]);
    expect(netFor(net, "a")).toBe(9_000);
    expect(netFor(net, "guest")).toBe(-9_000);
    expect(netSum(net)).toBe(0);
  });
});

describe("who shares", () => {
  it("charges only the people on the line", () => {
    // The bar. Two of the four went.
    const e = ex({
      amountCents: 5_000,
      paidBy: "a",
      shares: [
        { playerId: "a", weight: 1 },
        { playerId: "b", weight: 1 },
        { playerId: "c", weight: 0 },
        { playerId: "d", weight: 0 },
      ],
    });
    const s = shareOf(e);
    expect(s.get("a")).toBe(2_500);
    expect(s.get("b")).toBe(2_500);
    expect(s.get("c"), "c did not go to the bar").toBe(0);
    expect(s.get("d"), "d did not go to the bar").toBe(0);
    expect(sum(s)).toBe(5_000);
  });

  it("splits by weight for a room somebody had for one night", () => {
    // 2:2:2:1 of $640 — the case that does not divide into anything a person
    // would type by hand.
    const e = ex({
      amountCents: 64_000,
      shares: [
        { playerId: "a", weight: 1 },
        { playerId: "b", weight: 2 },
        { playerId: "c", weight: 2 },
        { playerId: "d", weight: 2 },
      ],
    });
    const s = shareOf(e);
    expect(s.get("a")).toBe(9_143);
    expect(sum(s), "the odd cents must still land somewhere").toBe(64_000);
    // One night is half of two nights, to the cent the rounding allows.
    expect(Math.abs((s.get("b") ?? 0) - 2 * (s.get("a") ?? 0))).toBeLessThanOrEqual(2);
  });

  it("splits by exact amounts when the ratio will not reduce", () => {
    // Two rooms at genuinely different rates. No weight expresses this.
    const e = ex({
      amountCents: 40_000,
      shares: [
        { playerId: "a", weight: 1, amountCents: 18_137 },
        { playerId: "b", weight: 1, amountCents: 21_863 },
      ],
    });
    const s = shareOf(e);
    expect(s.get("a")).toBe(18_137);
    expect(s.get("b")).toBe(21_863);
    expect(sum(s)).toBe(40_000);
  });

  it("absorbs a typed amount that misses the total, rather than losing it", () => {
    const e = ex({
      amountCents: 10_000,
      shares: [
        { playerId: "a", weight: 1, amountCents: 3_000 },
        { playerId: "b", weight: 1, amountCents: 6_999 },
      ],
    });
    expect(sum(shareOf(e)), "shares must total the bill or the ledger breaks").toBe(10_000);
  });

  it("ignores weights once any share names an amount", () => {
    // Half weights and half amounts has no answer a person could predict, so
    // the amounts win outright.
    const e = ex({
      amountCents: 10_000,
      shares: [
        { playerId: "a", weight: 99, amountCents: 4_000 },
        { playerId: "b", weight: 1, amountCents: 6_000 },
      ],
    });
    const s = shareOf(e);
    expect(s.get("a")).toBe(4_000);
    expect(s.get("b")).toBe(6_000);
  });
});

describe("a whole weekend, every combination at once", () => {
  const trip: Expense[] = [
    // Equal split, one payer.
    ex({ id: "fuel", amountCents: 18_000, paidBy: "a", shares: "abcd".split("").map((p) => ({ playerId: p, weight: 1 })) }),
    // Weighted split — one of them stayed a single night.
    ex({
      id: "rooms",
      amountCents: 64_000,
      paidBy: "b",
      shares: [
        { playerId: "a", weight: 1 },
        { playerId: "b", weight: 2 },
        { playerId: "c", weight: 2 },
        { playerId: "d", weight: 2 },
      ],
    }),
    // Two payers, exact amounts, split across everyone.
    ex({
      id: "dinner",
      amountCents: 20_000,
      paidBy: "c",
      payments: [
        { playerId: "c", amountCents: 12_000 },
        { playerId: "d", amountCents: 8_000 },
      ],
      shares: "abcd".split("").map((p) => ({ playerId: p, weight: 1 })),
    }),
    // Subset only.
    ex({
      id: "bar",
      amountCents: 5_000,
      paidBy: "a",
      shares: [
        { playerId: "a", weight: 1 },
        { playerId: "b", weight: 1 },
        { playerId: "c", weight: 0 },
        { playerId: "d", weight: 0 },
      ],
    }),
    // Exact amounts, because they ordered differently.
    ex({
      id: "pro shop",
      amountCents: 13_337,
      paidBy: "d",
      shares: [
        { playerId: "a", weight: 1, amountCents: 4_000 },
        { playerId: "d", weight: 1, amountCents: 9_337 },
      ],
    }),
    // A refund, shared by everyone.
    ex({ id: "refund", amountCents: -6_000, paidBy: "b", shares: "abcd".split("").map((p) => ({ playerId: p, weight: 1 })) }),
  ];

  it("sums to zero across every combination", () => {
    const net = balances(trip, ["a", "b", "c", "d"]);
    expect(netSum(net), "money was created or destroyed").toBe(0);
  });

  it("charges nobody for a line they were not on", () => {
    // c and d skipped the bar; b was not in the pro shop.
    const barOnly = balances([trip[3]], ["a", "b", "c", "d"]);
    expect(netFor(barOnly, "c")).toBe(0);
    expect(netFor(barOnly, "d")).toBe(0);

    const shopOnly = balances([trip[4]], ["a", "b", "c", "d"]);
    expect(netFor(shopOnly, "b")).toBe(0);
    expect(netFor(shopOnly, "c")).toBe(0);
  });

  it("credits a second payer, who would otherwise be out of pocket for nothing", () => {
    // d put $80 into the dinner and shares a quarter of it. Before payments
    // existed this was unrecordable: d looked like he owed his quarter and
    // had paid nothing.
    const dinnerOnly = balances([trip[2]], ["a", "b", "c", "d"]);
    expect(netFor(dinnerOnly, "d")).toBe(8_000 - 5_000);
    expect(netFor(dinnerOnly, "c")).toBe(12_000 - 5_000);
    expect(netSum(dinnerOnly)).toBe(0);
  });

  it("gives the same answer however the lines are ordered", () => {
    const forwards = balances(trip, ["a", "b", "c", "d"]);
    const backwards = balances([...trip].reverse(), ["a", "b", "c", "d"]);
    for (const row of forwards) {
      expect(netFor(backwards, row.playerId), `${row.playerId} moved when the list was reordered`).toBe(row.netCents);
    }
  });
});
