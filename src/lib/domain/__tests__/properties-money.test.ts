import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { splitExactly, settle, potCents } from "../money";
import { playSkins } from "../skins";
import { skinsPot } from "../skins-pot";
import { derivedNets, nassauNets, DERIVED_KINDS, type PotCard } from "../derived-games";
import { shareOf, balances } from "../expenses";
import { floorDiv, playMatch, strokesByHandingOut, type Hole } from "./properties-reference";

/**
 * PROPERTIES OF MONEY (foundation pass, layer 8, 2026-10-23, at the testing
 * panel's request). A game is not a house: every pot pays out exactly what went
 * in, never a negative share, never NaN; a split is exact to the cent and within
 * a cent of its proportional share; the settle-up leaves everybody square. Each
 * amount is also worked a second way — skins played hole by hole, a Nassau's
 * segments by a referee's walk of the card, a split's bounds in whole-number
 * arithmetic — and the two must agree. Fixed seeds.
 */
const RUNS = { seed: 20261023, numRuns: 1500 } as const;
const total = (xs: Array<{ netCents: number }>) => xs.reduce((a, n) => a + n.netCents, 0);
const integerAndFinite = (x: number) => Number.isFinite(x) && Number.isInteger(x);

describe("a split is exact (largest remainder)", () => {
  it("parts sum to the whole, none negative, each within a cent of its share", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000 }), fc.array(fc.integer({ min: 0, max: 50 }), { minLength: 1, maxLength: 40 }), (cents, weights) => {
        const parts = splitExactly(cents, weights);
        const sum = weights.reduce((a, b) => a + b, 0);
        expect(parts).toHaveLength(weights.length);
        for (const p of parts) expect(integerAndFinite(p) && p >= 0).toBe(true);
        if (sum === 0) {
          expect(parts.every((p) => p === 0)).toBe(true);
          return;
        }
        expect(parts.reduce((a, b) => a + b, 0)).toBe(cents);
        parts.forEach((p, i) => {
          const floor = Number(floorDiv(BigInt(cents) * BigInt(weights[i]), BigInt(sum)));
          expect(p === floor || p === floor + 1).toBe(true);
          if (weights[i] === 0) expect(p).toBe(0);
        });
      }),
      RUNS,
    );
  });

  it("the settle-up leaves everybody square, in no more handovers than people owed or owing less one", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: -50_000, max: 50_000 }), { minLength: 1, maxLength: 20 }), (raw) => {
        // Any ledger that sums to nought: the last player takes up the difference.
        const nets = raw.map((c, i) => ({ playerId: `p${i}`, netCents: c }));
        nets.push({ playerId: "last", netCents: -total(nets) });
        const transfers = settle(nets);
        const after = new Map(nets.map((n) => [n.playerId, n.netCents]));
        for (const t of transfers) {
          expect(t.cents > 0 && integerAndFinite(t.cents)).toBe(true);
          after.set(t.fromPlayerId, after.get(t.fromPlayerId)! + t.cents);
          after.set(t.toPlayerId, after.get(t.toPlayerId)! - t.cents);
        }
        for (const v of after.values()) expect(v).toBe(0);
        const live = nets.filter((n) => n.netCents !== 0).length;
        expect(transfers.length).toBeLessThanOrEqual(Math.max(0, live - 1));
      }),
      RUNS,
    );
  });
});

describe("skins: carries and ties", () => {
  const field = fc.integer({ min: 2, max: 6 }).chain((p) =>
    fc.tuple(
      fc.constantFrom(9, 18),
      fc.array(fc.array(fc.integer({ min: 2, max: 8 }), { minLength: 18, maxLength: 18 }), { minLength: p, maxLength: p }),
      fc.integer({ min: 0, max: 5000 }),
    ),
  );

  it("each hole is won only outright, its value is one plus everything carried, and the pot pays out to the cent", () => {
    fc.assert(
      fc.property(field, ([holes, cards, stake]) => {
        const players = cards.map((strokes, i) => ({ playerId: `p${i}`, strokes, courseHandicap: 0 }));
        const outcome = playSkins(players, holes, { net: false });
        // Hole by hole, by hand.
        const won = new Map(players.map((p) => [p.playerId, 0]));
        let carry = 0;
        for (let h = 0; h < holes; h += 1) {
          const low = Math.min(...cards.map((c) => c[h]));
          const at = cards.map((c, i) => (c[h] === low ? i : -1)).filter((i) => i >= 0);
          if (at.length === 1) {
            won.set(`p${at[0]}`, won.get(`p${at[0]}`)! + carry + 1);
            carry = 0;
          } else carry += 1;
        }
        for (const s of outcome.standings) expect(s.skins).toBe(won.get(s.playerId));
        expect(outcome.unclaimed).toBe(carry);

        const pot = skinsPot(outcome, stake, players.map((p) => p.playerId), 0);
        expect(pot.potCents).toBe(potCents(stake, players.length));
        expect(pot.shares.reduce((a, s) => a + s.wonCents, 0)).toBe(pot.potCents);
        expect(total(pot.shares)).toBe(0);
        for (const s of pot.shares) {
          expect(integerAndFinite(s.wonCents) && s.wonCents >= 0).toBe(true);
          expect(s.netCents).toBeGreaterThanOrEqual(-stake);
        }
        // Nobody won a hole: every stake back; otherwise a skin is worth the same to everybody, to a cent.
        const claimed = [...won.values()].reduce((a, b) => a + b, 0);
        if (claimed === 0) expect(pot.shares.every((s) => s.netCents === 0)).toBe(true);
        else
          for (const s of pot.shares) {
            const floor = Number(floorDiv(BigInt(pot.potCents) * BigInt(won.get(s.playerId)!), BigInt(claimed)));
            expect(s.wonCents === floor || s.wonCents === floor + 1).toBe(true);
          }
      }),
      RUNS,
    );
  });

  it("net skins: the same game on the cards less the strokes handed out by stroke index", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.array(fc.integer({ min: 2, max: 9 }), { minLength: 18, maxLength: 18 }), fc.integer({ min: -3, max: 30 })), { minLength: 2, maxLength: 5 }),
        (rows) => {
          const si = Array.from({ length: 18 }, (_, i) => ((i * 7) % 18) + 1);
          const net = playSkins(rows.map(([strokes, h], i) => ({ playerId: `p${i}`, strokes, courseHandicap: h })), 18, { net: true, strokeIndex: si });
          const gross = playSkins(
            rows.map(([strokes, h], i) => {
              const shots = strokesByHandingOut(h, si);
              return { playerId: `p${i}`, strokes: strokes.map((s, k) => s - shots[k]), courseHandicap: 0 };
            }),
            18,
            { net: false },
          );
          expect(net.standings).toEqual(gross.standings);
          expect(net.unclaimed).toBe(gross.unclaimed);
        },
      ),
      RUNS,
    );
  });
});

describe("a Nassau: three bets, each paid when it is decided", () => {
  const hole = fc.constantFrom<Hole>("A", "B", "H");
  const card = fc.tuple(fc.array(hole, { minLength: 18, maxLength: 18 }), fc.integer({ min: 0, max: 18 })).map(([r, k]) => r.map((h, i) => (i < k ? h : null)));

  it("sums to nought; pays exactly the decided segments, a stake each, to each player on the winning side", () => {
    fc.assert(
      fc.property(card, fc.integer({ min: 1, max: 5000 }), fc.integer({ min: 1, max: 2 }), (holes, stake, size) => {
        const sideA = Array.from({ length: size }, (_, i) => `a${i}`);
        const sideB = Array.from({ length: size }, (_, i) => `b${i}`);
        const nets = nassauNets({ matchId: "m", sideA, sideB, holes, stakeCents: stake });
        expect(total(nets)).toBe(0);
        // A referee's walk of each segment.
        let aUp = 0;
        for (const seg of [holes.slice(0, 9), holes.slice(9, 18), holes]) {
          const r = playMatch(seg);
          if (r.over && r.winner === "A") aUp += 1;
          if (r.over && r.winner === "B") aUp -= 1;
        }
        for (const id of sideA) expect(nets.find((n) => n.playerId === id)?.netCents ?? 0).toBe(aUp * stake);
        for (const id of sideB) expect(nets.find((n) => n.playerId === id)?.netCents ?? 0).toBe(-aUp * stake || 0);
      }),
      RUNS,
    );
  });
});

describe("the pots the cards settle", () => {
  const pars = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];
  const potCard = (id: string) =>
    fc.tuple(fc.array(fc.option(fc.integer({ min: 1, max: 9 }), { nil: null, freq: 8 }), { minLength: 18, maxLength: 18 }), fc.integer({ min: 0, max: 30 })).map(
      ([strokes, received]): PotCard => ({ playerId: id, strokes, strokesReceived: received }),
    );

  it("every kind pays out exactly the stakes, nobody loses more than their stake, and nothing is NaN", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...DERIVED_KINDS),
        fc.integer({ min: 1, max: 8 }).chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => potCard(`p${i}`)))),
        fc.integer({ min: 0, max: 5000 }),
        (kind, cards, stake) => {
          const ids = cards.map((c) => c.playerId);
          const nets = derivedNets({ kind, buyInCents: stake, entrantIds: ids, cards, pars });
          expect(total(nets)).toBe(0);
          for (const n of nets) {
            expect(integerAndFinite(n.netCents)).toBe(true);
            expect(n.netCents).toBeGreaterThanOrEqual(-stake);
            expect(ids).toContain(n.playerId);
          }
          // Birdies, eagles, twos: a share per one made, worked by hand.
          if (stake > 0 && (kind === "birdies" || kind === "eagles" || kind === "twos")) {
            const made = cards.map((c) =>
              c.strokes.filter((s, h) => s != null && s > 0 && (kind === "twos" ? s === 2 : pars[h] - s >= (kind === "eagles" ? 2 : 1))).length,
            );
            const all = made.reduce((a, b) => a + b, 0);
            const pot = potCents(stake, ids.length);
            cards.forEach((c, i) => {
              const net = nets.find((n) => n.playerId === c.playerId)?.netCents ?? 0;
              if (all === 0) expect(net).toBe(0);
              else {
                const floor = Number(floorDiv(BigInt(pot) * BigInt(made[i]), BigInt(all)));
                expect(net + stake === floor || net + stake === floor + 1).toBe(true);
              }
            });
          }
        },
      ),
      RUNS,
    );
  });
});

describe("shared costs", () => {
  it("a cost split by weights adds up to the bill to the cent, refund or charge, and the ledger sums to nought", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            amountCents: fc.integer({ min: -100_000, max: 1_000_000 }),
            paidBy: fc.integer({ min: 0, max: 5 }),
            weights: fc.array(fc.integer({ min: 0, max: 4 }), { minLength: 1, maxLength: 6 }),
          }),
          { minLength: 1, maxLength: 8 },
        ),
        (rows) => {
          const expenses = rows.map((r, k) => ({
            id: `x${k}`,
            description: "",
            amountCents: r.amountCents,
            paidBy: `p${r.paidBy}`,
            shares: r.weights.map((weight, i) => ({ playerId: `p${i}`, weight })),
          }));
          for (const e of expenses) {
            const parts = [...shareOf(e).values()];
            const anyWeight = e.shares.some((s) => s.weight > 0);
            if (anyWeight) expect(parts.reduce((a, b) => a + b, 0)).toBe(e.amountCents);
            for (const p of parts) expect(integerAndFinite(p) && (e.amountCents >= 0 ? p >= 0 : p <= 0)).toBe(true);
          }
          const nets = balances(expenses);
          expect(total(nets)).toBe(0);
          for (const n of nets) expect(integerAndFinite(n.netCents)).toBe(true);
        },
      ),
      RUNS,
    );
  });
});
