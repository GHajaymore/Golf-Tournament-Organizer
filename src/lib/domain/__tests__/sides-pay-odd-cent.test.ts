import { describe, it, expect } from "vitest";
import { matchBetNets, nassauNets, type Net } from "../derived-games";
import type { HoleResult } from "../types";

/**
 * A SIDE GAME BETWEEN TWO SIDES SUMS TO ZERO, ON EVERY SIDE SIZE AND EVERY
 * STAKE (2026-11-07).
 *
 * The rule, as `sidesPay` states it: each player on the SMALLER side plays a
 * full stake, and the larger side shares that same total. Until today the
 * larger side's share was rounded down on its own, so two against one at
 * $10.01 with the pair winning paid +500, +500, -1001 — a cent short — and one
 * against two at one cent paid the pair nothing and took a cent off the one.
 * The share is now split by the app's one cent rule (`splitExactly`, largest
 * remainder), the odd cents to the lowest player ids.
 *
 * The match side game and the Nassau both go through it, so both are swept.
 * Ids are invented. TourneyHQ works the money out and writes it down; it never
 * moves it.
 */

const SIZES = [1, 2, 3, 4];
const STAKES = [0, 1, 3, 7, 1001];
const WINNERS = ["A", "B"] as const;

const side = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
const won = (w: "A" | "B"): HoleResult[] => Array(18).fill(w) as HoleResult[];
const total = (nets: Net[]) => nets.reduce((t, n) => t + n.netCents, 0);
const netOf = (nets: Net[], id: string) => nets.find((n) => n.playerId === id)?.netCents ?? 0;

/**
 * The invariants every cell must keep, per decided side game (`times` is 1 for
 * the match, 3 for a Nassau won front, back and overall by the same side):
 * the nets sum to zero; each player on the smaller side moves exactly a stake;
 * nobody on the larger side moves more than a stake, and its players are
 * within a cent of each other.
 */
function expectCell(nets: Net[], a: string[], b: string[], winner: "A" | "B", stake: number, times: number) {
  expect(total(nets)).toBe(0);
  for (const n of nets) expect(Number.isInteger(n.netCents)).toBe(true);
  if (stake === 0) {
    expect(nets).toEqual([]);
    return;
  }
  const winners = winner === "A" ? a : b;
  const losers = winner === "A" ? b : a;
  const smaller = Math.min(a.length, b.length);
  // What changed hands: a stake for each player on the smaller side, per side game.
  const moved = stake * smaller * times;
  expect(winners.reduce((t, id) => t + netOf(nets, id), 0)).toBe(moved);
  expect(losers.reduce((t, id) => t + netOf(nets, id), 0)).toBe(-moved);
  for (const group of [winners, losers]) {
    const sign = group === winners ? 1 : -1;
    const each = group.map((id) => sign * netOf(nets, id));
    if (group.length === smaller) for (const e of each) expect(e).toBe(stake * times);
    for (const e of each) expect(e).toBeLessThanOrEqual(stake * times);
    expect(Math.max(...each) - Math.min(...each)).toBeLessThanOrEqual(times);
  }
}

describe("the match side game sums to zero on every side size, winner and stake", () => {
  for (const na of SIZES) {
    for (const nb of SIZES) {
      it(`${na} v ${nb}`, () => {
        const a = side("a", na);
        const b = side("b", nb);
        for (const winner of WINNERS) {
          for (const stake of STAKES) {
            const nets = matchBetNets({ matchId: "zz-m", sideA: a, sideB: b, holes: won(winner), stakeCents: stake });
            expectCell(nets, a, b, winner, stake, 1);
          }
        }
      });
    }
  }
});

describe("the Nassau sums to zero on every side size, winner and stake", () => {
  for (const na of SIZES) {
    for (const nb of SIZES) {
      it(`${na} v ${nb}`, () => {
        const a = side("a", na);
        const b = side("b", nb);
        for (const winner of WINNERS) {
          for (const stake of STAKES) {
            // One side wins every hole: front, back and overall, three side games.
            const nets = nassauNets({ matchId: "zz-n", sideA: a, sideB: b, holes: won(winner), stakeCents: stake });
            expectCell(nets, a, b, winner, stake, 3);
          }
        }
        // And a split card: one side takes the front, the other the back, the
        // eighteen is halved. Each player's two segments must still sum to zero.
        for (const stake of STAKES) {
          const split = [...Array(9).fill("A"), ...Array(9).fill("B")] as HoleResult[];
          expect(total(nassauNets({ matchId: "zz-n", sideA: a, sideB: b, holes: split, stakeCents: stake }))).toBe(0);
        }
      });
    }
  }
});

describe("worked by hand from the rule, not read off the code", () => {
  it("three against two at 7 cents: the pair each pay 7, the three share 14 as 5, 5, 4", () => {
    /**
     * The smaller side is the pair, so each of them plays the full stake:
     * 2 x 7 = 14 cents change hands. The three share 14 cents: 14 / 3 is 4
     * each with 2 cents over, and the 2 odd cents go to the two lowest ids,
     * w1 and w2. 5 + 5 + 4 = 14 = 7 + 7.
     */
    const nets = matchBetNets({ matchId: "zz-m", sideA: ["w3", "w1", "w2"], sideB: ["l1", "l2"], holes: won("A"), stakeCents: 7 });
    expect(nets).toEqual([
      { playerId: "w1", netCents: 5 },
      { playerId: "w2", netCents: 5 },
      { playerId: "w3", netCents: 4 },
      { playerId: "l1", netCents: -7 },
      { playerId: "l2", netCents: -7 },
    ]);
  });

  it("and the other way: the pair each take 7, the three pay 14 as 5, 5, 4, the lowest ids paying the odd cents", () => {
    const nets = matchBetNets({ matchId: "zz-m", sideA: ["w3", "w1", "w2"], sideB: ["l1", "l2"], holes: won("B"), stakeCents: 7 });
    expect(nets).toEqual([
      { playerId: "l1", netCents: 7 },
      { playerId: "l2", netCents: 7 },
      { playerId: "w3", netCents: -4 },
      { playerId: "w1", netCents: -5 },
      { playerId: "w2", netCents: -5 },
    ]);
  });

  it("two against one at $10.01, the pair winning: +501, +500, -1001 — the cent the old rounding lost", () => {
    const nets = matchBetNets({ matchId: "zz-m", sideA: ["p2", "p1"], sideB: ["q1"], holes: won("A"), stakeCents: 1001 });
    expect(nets).toEqual([
      { playerId: "p1", netCents: 501 },
      { playerId: "p2", netCents: 500 },
      { playerId: "q1", netCents: -1001 },
    ]);
  });

  it("one against two at one cent, the pair winning: one cent from the one, to the lower id of the pair", () => {
    // The other player of the pair is level, so is not listed.
    const nets = matchBetNets({ matchId: "zz-m", sideA: ["q1"], sideB: ["p2", "p1"], holes: won("B"), stakeCents: 1 });
    expect(nets).toEqual([
      { playerId: "p1", netCents: 1 },
      { playerId: "q1", netCents: -1 },
    ]);
  });

  it("a Nassau two against one at 1 cent, the pair winning all three: the lower id takes the odd cent each time", () => {
    // Each segment: the one pays 1 cent, which goes to p1. Three segments: p1 +3, q1 -3, p2 level.
    const nets = nassauNets({ matchId: "zz-n", sideA: ["p1", "p2"], sideB: ["q1"], holes: won("A"), stakeCents: 1 });
    expect(nets).toEqual([
      { playerId: "p1", netCents: 3 },
      { playerId: "q1", netCents: -3 },
    ]);
  });
});
