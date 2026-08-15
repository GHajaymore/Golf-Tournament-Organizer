import { describe, it, expect } from "vitest";
import {
  shareOf,
  balances,
  combinedBalances,
  positionFor,
  evenShares,
  isValidAmount,
  MAX_EXPENSE_CENTS,
  type Expense,
  type Net,
} from "../expenses";
import { settle } from "../money";

/**
 * The shared-expense ledger.
 *
 * Every test here is one of two questions: does the money add up, and does it
 * still add up in the case nobody thought about. The invariants come straight
 * from the design brief, and they are the whole point of the module:
 *
 *   1. every split sums EXACTLY to the expense total
 *   2. balances sum to zero across the field
 *   3. after settlement every player is exactly square
 *   4. no zero transfers and no self-transfers
 *   5. combining expenses with side games conserves both totals
 *   6. all of the above under randomised input
 *
 * This is money between friends. An off-by-one-cent here is not a rounding
 * error, it is somebody being told they owe the wrong amount.
 */

const expense = (over: Partial<Expense> = {}): Expense => ({
  id: "e1",
  description: "Dinner",
  amountCents: 26_000,
  paidBy: "dave",
  shares: evenShares(["dave", "ann", "rob", "sam"]),
  ...over,
});

const sum = (nets: Net[]) => nets.reduce((a, n) => a + n.netCents, 0);
const sumMap = (m: Map<string, number>) => [...m.values()].reduce((a, c) => a + c, 0);

describe("one expense, split", () => {
  it("splits evenly and sums to the total", () => {
    const shares = shareOf(expense());
    expect(sumMap(shares)).toBe(26_000);
    expect([...shares.values()]).toEqual([6500, 6500, 6500, 6500]);
  });

  it("never loses or invents a cent on an awkward total", () => {
    // £100.01 across three is 33.336667 each. Any method that rounds each
    // share on its own is a penny out, and a penny out is a wrong number on
    // somebody's phone.
    const shares = shareOf(expense({ amountCents: 10_001, shares: evenShares(["a", "b", "c"]) }));
    expect(sumMap(shares)).toBe(10_001);
    expect([...shares.values()].sort()).toEqual([3333, 3334, 3334]);
  });

  it("splits by weight when the split is not even", () => {
    // Two rooms, one of them shared: a natural 2:1:1.
    const shares = shareOf(
      expense({
        amountCents: 40_000,
        shares: [
          { playerId: "a", weight: 2 },
          { playerId: "b", weight: 1 },
          { playerId: "c", weight: 1 },
        ],
      }),
    );
    expect(shares.get("a")).toBe(20_000);
    expect(shares.get("b")).toBe(10_000);
    expect(sumMap(shares)).toBe(40_000);
  });

  it("keeps an excluded player on the bill at nothing", () => {
    // Weight 0 is "not on this bill", which is a different fact from "not on
    // the trip" — and deleting the row would lose the difference.
    const shares = shareOf(
      expense({
        amountCents: 9_000,
        shares: [
          { playerId: "a", weight: 1 },
          { playerId: "b", weight: 1 },
          { playerId: "teetotal", weight: 0 },
        ],
      }),
    );
    expect(shares.get("teetotal")).toBe(0);
    expect(sumMap(shares)).toBe(9_000);
  });

  it("charges a player once even if listed twice", () => {
    const shares = shareOf(
      expense({
        amountCents: 3_000,
        shares: [
          { playerId: "a", weight: 1 },
          { playerId: "a", weight: 1 },
          { playerId: "b", weight: 2 },
        ],
      }),
    );
    expect(shares.size).toBe(2);
    expect(sumMap(shares)).toBe(3_000);
    // Their two weights add up rather than one silently winning.
    expect(shares.get("a")).toBe(1_500);
  });
});

describe("a refund", () => {
  // The decision the brief left open, taken and stated: negatives are allowed,
  // because a returned deposit or a cancelled cart is a real line on a real
  // trip.
  it("splits a refund exactly, the other way round", () => {
    const shares = shareOf(expense({ amountCents: -10_001, shares: evenShares(["a", "b", "c"]) }));
    expect(sumMap(shares)).toBe(-10_001);
    // The odd penny is allocated on the magnitude and then negated, so the
    // parts are -3334/-3334/-3333 rather than three equal -3334s.
    // Sorted numerically: a bare .sort() compares these as strings.
    expect([...shares.values()].sort((a, b) => a - b)).toEqual([-3334, -3334, -3333]);
  });

  it("leaves the field square after a refund", () => {
    // Dave paid dinner, then the club refunded a cart fee to Ann.
    const nets = balances(
      [
        expense({ id: "e1", amountCents: 12_000, paidBy: "dave", shares: evenShares(["dave", "ann"]) }),
        expense({ id: "e2", description: "Cart refund", amountCents: -3_000, paidBy: "ann", shares: evenShares(["dave", "ann"]) }),
      ],
      ["dave", "ann"],
    );
    expect(sum(nets)).toBe(0);
    // Dave laid out 120 and owes 60 of it, so he is up 60. Ann then RECEIVED
    // the 30 refund, half of which is Dave's — so she owes him 15 more, not
    // less. He is owed 75; the intuition that a refund shrinks his credit is
    // exactly backwards when it lands in somebody else's pocket.
    expect(nets.find((n) => n.playerId === "dave")!.netCents).toBe(7_500);
    expect(nets.find((n) => n.playerId === "ann")!.netCents).toBe(-7_500);
  });
});

describe("the ledger balances", () => {
  it("sums to zero", () => {
    expect(sum(balances([expense()], ["dave", "ann", "rob", "sam"]))).toBe(0);
  });

  it("credits the payer and debits the sharers", () => {
    const nets = balances([expense()], ["dave", "ann", "rob", "sam"]);
    // Dave laid out 260 and owes 65 of it.
    expect(nets.find((n) => n.playerId === "dave")!.netCents).toBe(19_500);
    expect(nets.find((n) => n.playerId === "ann")!.netCents).toBe(-6_500);
  });

  it("handles an expense paid by somebody not in its own split", () => {
    // The organizer puts the green fees on their card and does not play.
    const nets = balances(
      [expense({ amountCents: 20_000, paidBy: "organizer", shares: evenShares(["a", "b"]) })],
      ["organizer", "a", "b"],
    );
    expect(sum(nets)).toBe(0);
    expect(nets.find((n) => n.playerId === "organizer")!.netCents).toBe(20_000);
  });

  it("nets a single-player split to nothing", () => {
    // Paid for yourself: real, and not a debt in either direction.
    const nets = balances([expense({ amountCents: 5_000, paidBy: "a", shares: evenShares(["a"]) })], ["a"]);
    expect(nets.find((n) => n.playerId === "a")!.netCents).toBe(0);
  });

  it("ignores an expense nobody shares", () => {
    // Every weight zero is "I paid for this myself", so it must not land on
    // the payer as a credit the others then owe.
    const nets = balances(
      [
        expense({
          amountCents: 5_000,
          paidBy: "a",
          shares: [
            { playerId: "a", weight: 0 },
            { playerId: "b", weight: 0 },
          ],
        }),
      ],
      ["a", "b"],
    );
    expect(sum(nets)).toBe(0);
    expect(nets.every((n) => n.netCents === 0)).toBe(true);
  });

  it("ignores a zero-amount line", () => {
    const nets = balances([expense({ amountCents: 0 })], ["dave", "ann"]);
    expect(nets.every((n) => n.netCents === 0)).toBe(true);
  });

  it("keeps a player who has left the field in the ledger", () => {
    // A Player row can still be hard-deleted when it has no scores, and an
    // expense may name them. Dropping their side would leave the ledger short
    // — the screen can say "unknown", but the money must add up.
    const nets = balances([expense({ paidBy: "ghost" })], ["ann", "rob", "sam"]);
    expect(sum(nets)).toBe(0);
    expect(nets.some((n) => n.playerId === "ghost")).toBe(true);
  });

  it("lists everyone asked for, even with nothing on them", () => {
    const nets = balances([], ["a", "b"]);
    expect(nets.map((n) => n.playerId).sort()).toEqual(["a", "b"]);
    expect(sum(nets)).toBe(0);
  });
});

describe("the one number — expenses and side games together", () => {
  it("adds the two ledgers", () => {
    // The example from the brief: owed $260 for dinner, down $40 in skins and
    // $20 on the Nassau.
    const expenses: Net[] = [
      { playerId: "dave", netCents: 19_500 },
      { playerId: "ann", netCents: -6_500 },
      { playerId: "rob", netCents: -6_500 },
      { playerId: "sam", netCents: -6_500 },
    ];
    const games: Net[] = [
      { playerId: "dave", netCents: -6_000 },
      { playerId: "ann", netCents: 6_000 },
    ];
    const both = combinedBalances(expenses, games);
    expect(sum(both)).toBe(0);
    expect(both.find((n) => n.playerId === "dave")!.netCents).toBe(13_500);
    expect(both.find((n) => n.playerId === "ann")!.netCents).toBe(-500);
  });

  it("conserves both totals", () => {
    const expenses: Net[] = [
      { playerId: "a", netCents: 5_000 },
      { playerId: "b", netCents: -5_000 },
    ];
    const games: Net[] = [
      { playerId: "b", netCents: 2_500 },
      { playerId: "c", netCents: -2_500 },
    ];
    const both = combinedBalances(expenses, games);
    expect(sum(both)).toBe(sum(expenses) + sum(games));
    expect(sum(both)).toBe(0);
  });

  it("keeps a player who is in only one of the two ledgers", () => {
    // The guest who ate but did not bet.
    const both = combinedBalances(
      [{ playerId: "guest", netCents: -4_000 }, { playerId: "host", netCents: 4_000 }],
      [{ playerId: "host", netCents: -1_000 }, { playerId: "rob", netCents: 1_000 }],
    );
    expect(both.find((n) => n.playerId === "guest")!.netCents).toBe(-4_000);
    expect(both.find((n) => n.playerId === "host")!.netCents).toBe(3_000);
  });

  it("shows the parts alongside the total, so the number never looks wrong", () => {
    // Hiding the side games makes the total look wrong to whoever remembers
    // the bet, and a player who cannot see why will not trust the figure.
    const p = positionFor(
      "dave",
      [{ playerId: "dave", netCents: 19_500 }],
      [{ playerId: "dave", netCents: -6_000 }],
    );
    expect(p).toEqual({ playerId: "dave", expensesCents: 19_500, gamesCents: -6_000, netCents: 13_500 });
    expect(p.expensesCents + p.gamesCents).toBe(p.netCents);
  });
});

describe("settling up", () => {
  it("leaves every player exactly square", () => {
    const nets = balances(
      [
        expense({ id: "e1", amountCents: 26_000, paidBy: "dave" }),
        expense({ id: "e2", amountCents: 9_600, paidBy: "ann", description: "Carts" }),
        expense({ id: "e3", amountCents: 4_444, paidBy: "rob", description: "Range balls" }),
      ],
      ["dave", "ann", "rob", "sam"],
    );
    const transfers = settle(nets);
    const after = new Map(nets.map((n) => [n.playerId, n.netCents]));
    for (const t of transfers) {
      after.set(t.fromPlayerId, (after.get(t.fromPlayerId) ?? 0) + t.cents);
      after.set(t.toPlayerId, (after.get(t.toPlayerId) ?? 0) - t.cents);
    }
    for (const [id, cents] of after) expect(cents, `${id} should be square`).toBe(0);
  });

  it("never writes a zero or a self-transfer", () => {
    const nets = balances([expense()], ["dave", "ann", "rob", "sam"]);
    for (const t of settle(nets)) {
      expect(t.cents).toBeGreaterThan(0);
      expect(t.fromPlayerId).not.toBe(t.toPlayerId);
    }
  });
});

describe("under randomised input", () => {
  /**
   * The property sweep, mirroring the skins-pot one that found real bugs.
   *
   * Deterministic pseudo-random, so a failure is reproducible rather than a
   * story about a build that went red once.
   */
  const rng = (seed: number) => () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed / 2_147_483_648;
  };

  it("holds every invariant over 2,000 random outings", () => {
    const random = rng(20260814);
    for (let run = 0; run < 2_000; run += 1) {
      const playerCount = 1 + Math.floor(random() * 8);
      const players = Array.from({ length: playerCount }, (_, i) => `p${i}`);
      const expenses: Expense[] = [];

      const lines = 1 + Math.floor(random() * 6);
      for (let e = 0; e < lines; e += 1) {
        // Refunds about one line in six, and the odd zero.
        const magnitude = Math.floor(random() * 50_000);
        const amountCents = random() < 0.16 ? -magnitude : magnitude;
        const shares = players
          .map((playerId) => ({
            playerId,
            // Some excluded (weight 0), the rest weighted 1..3.
            weight: random() < 0.25 ? 0 : 1 + Math.floor(random() * 3),
          }))
          // Occasionally somebody is off the bill entirely.
          .filter(() => random() > 0.1);

        expenses.push({
          id: `e${e}`,
          description: `line ${e}`,
          amountCents,
          paidBy: players[Math.floor(random() * players.length)],
          shares,
        });
      }

      // 1. Every split sums exactly to its own total.
      for (const ex of expenses) {
        const shares = shareOf(ex);
        const shared = sumMap(shares);
        const anyWeight = ex.shares.some((s) => s.weight > 0);
        expect(shared, `run ${run}: split of ${ex.amountCents}`).toBe(anyWeight ? ex.amountCents : 0);
      }

      // 2. The ledger sums to zero.
      const nets = balances(expenses, players);
      expect(sum(nets), `run ${run}: ledger must balance`).toBe(0);

      // 5. Adding a side-game ledger conserves both. A real one: random
      // winners and losers that sum to zero, the shape skins and Nassau
      // produce, with the last player absorbing the remainder.
      const games: Net[] = players.map((playerId) => ({
        playerId,
        netCents: Math.floor(random() * 8_000) - 4_000,
      }));
      games[games.length - 1].netCents -= games.reduce((a, g) => a + g.netCents, 0);
      expect(sum(games), `run ${run}: the game ledger itself must balance`).toBe(0);

      const both = combinedBalances(nets, games);
      expect(sum(both), `run ${run}: combined must balance`).toBe(0);
      // Neither ledger may quietly lose a player when merged.
      for (const p of players) {
        const expected =
          (nets.find((n) => n.playerId === p)?.netCents ?? 0) +
          (games.find((g) => g.playerId === p)?.netCents ?? 0);
        expect(both.find((b) => b.playerId === p)?.netCents ?? 0, `run ${run}: ${p}`).toBe(expected);
      }

      // And the combined ledger settles square too — the number players
      // actually hand over is this one, not either half.
      const bothAfter = new Map(both.map((n) => [n.playerId, n.netCents]));
      for (const t of settle(both)) {
        bothAfter.set(t.fromPlayerId, (bothAfter.get(t.fromPlayerId) ?? 0) + t.cents);
        bothAfter.set(t.toPlayerId, (bothAfter.get(t.toPlayerId) ?? 0) - t.cents);
      }
      for (const [id, cents] of bothAfter) {
        expect(cents, `run ${run}: ${id} must end square on the combined ledger`).toBe(0);
      }

      // 3 and 4. Settlement squares everyone, with no junk transfers.
      const after = new Map(nets.map((n) => [n.playerId, n.netCents]));
      for (const t of settle(nets)) {
        expect(t.cents, `run ${run}: no zero transfer`).toBeGreaterThan(0);
        expect(t.fromPlayerId, `run ${run}: no self transfer`).not.toBe(t.toPlayerId);
        after.set(t.fromPlayerId, (after.get(t.fromPlayerId) ?? 0) + t.cents);
        after.set(t.toPlayerId, (after.get(t.toPlayerId) ?? 0) - t.cents);
      }
      for (const [id, cents] of after) {
        expect(cents, `run ${run}: ${id} must end square`).toBe(0);
      }
    }
  });
});

describe("what reaches the maths", () => {
  it("takes a whole number of cents inside sane bounds", () => {
    expect(isValidAmount(26_000)).toBe(true);
    expect(isValidAmount(-26_000)).toBe(true);
    expect(isValidAmount(0)).toBe(true);
    expect(isValidAmount(MAX_EXPENSE_CENTS)).toBe(true);
  });

  it("refuses what would poison a settlement", () => {
    // A "use server" export is a public endpoint and will be called with
    // whatever the caller likes. NaN in a ledger is every number gone.
    for (const bad of [NaN, Infinity, -Infinity, 12.5, MAX_EXPENSE_CENTS + 1]) {
      expect(isValidAmount(bad), String(bad)).toBe(false);
    }
  });

  it("survives junk amounts without corrupting the ledger", () => {
    // Defence in depth: validation refuses these at the boundary, and the
    // maths still balances if one ever gets past.
    const nets = balances(
      [expense({ amountCents: NaN }), expense({ id: "e2", amountCents: 1_000 })],
      ["dave", "ann", "rob", "sam"],
    );
    expect(sum(nets)).toBe(0);
    expect(nets.every((n) => Number.isFinite(n.netCents))).toBe(true);
  });
});
