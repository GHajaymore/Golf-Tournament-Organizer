import { describe, it, expect } from "vitest";
import {
  countbackBetween,
  countbackCardOn,
  countbackSegments,
  countbackStepWords,
  netCountbackMethodFor,
  NET_COUNTBACK_FRACTIONS_FROM,
} from "../domain/stroke-countback";
import { holeStrokesReceived, rankStrokeIndex } from "../domain/stroke";
import { cutLineOutcome, survivorCount, type CutLineRow, type CutRule } from "../domain/cut";
import { seedOrder } from "../domain/bracket";
import { computeStandings } from "../domain/standings";
import { DEFAULT_SCORING, type HoleResult, type Match, type Player } from "../domain/types";
import { playSkins } from "../domain/skins";
import { skinsPot } from "../domain/skins-pot";
import { potCents, settle, splitExactly } from "../domain/money";
import { tournamentTerms } from "../rules";

/**
 * THE ACCURACY SWEEP, PART 4: TIES, CUTS, DRAWS AND MONEY (2026-11-09).
 *
 * The countback ladder (R&A/USGA Committee Procedures 5A(7): last 9, 6, 3, 1),
 * a cut of "top N and ties", the knockout seeding, a round robin's points, and
 * the money a pot pays — each against figures worked by hand, with the working
 * beside them.
 */

const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 3, 5, 4, 4, 4, 3, 5, 4];
const card = (changes: Record<number, number>) => PARS.map((p, i) => p + (changes[i + 1] ?? 0));
const cb = (holes: number[]) => ({ playerId: "", total: 0, holes });

describe("Countback (Committee Procedures 5A(7)): last 9, then 6, then 3, then the last hole", () => {
  // Every card below is 72. Holes are numbered 1-18.
  const LEVEL = card({});

  it("the ladder is 9, 6, 3, 1 over eighteen and 6, 3, 1 over nine", () => {
    expect(countbackSegments(18)).toEqual([9, 6, 3, 1]);
    expect(countbackSegments(9)).toEqual([6, 3, 1]);
  });

  it("decided on the last nine: +1 on the 1st and -1 on the 18th is 35 against 36", () => {
    const r = countbackBetween(cb(LEVEL), cb(card({ 1: 1, 18: -1 })), 18);
    expect(r.decidedBy).toEqual({ holes: 9, a: 36, b: 35 });
    expect(r.order).toBeGreaterThan(0); // b ahead
  });

  it("decided on the last six when the last nine are level: +1 on the 10th, -1 on the 13th", () => {
    // Last six (13-18) par 24; this card 23.
    const r = countbackBetween(cb(card({ 10: 1, 13: -1 })), cb(LEVEL), 18);
    expect(r.decidedBy).toEqual({ holes: 6, a: 23, b: 24 });
    expect(r.order).toBeLessThan(0);
    expect(r.levelOn).toEqual([9]);
  });

  it("decided on the last three: +1 on the 13th, -1 on the 16th", () => {
    // Last three (16-18) par 12; this card 11.
    const r = countbackBetween(cb(card({ 13: 1, 16: -1 })), cb(LEVEL), 18);
    expect(r.decidedBy).toEqual({ holes: 3, a: 11, b: 12 });
    expect(r.levelOn).toEqual([9, 6]);
  });

  it("decided on the last hole: +1 on the 16th, -1 on the 18th", () => {
    const r = countbackBetween(cb(card({ 16: 1, 18: -1 })), cb(LEVEL), 18);
    expect(r.decidedBy).toEqual({ holes: 1, a: 3, b: 4 });
  });

  it("a tie that survives every step is still a tie", () => {
    const r = countbackBetween(cb(card({ 2: 1, 3: -1 })), cb(LEVEL), 18);
    expect(r.order).toBe(0);
    expect(r.levelOn).toEqual([9, 6, 3, 1]);
    expect(r.incomplete).toBe(false);
  });

  it("Stableford counts back on POINTS, most first (strokes taken as they were applied)", () => {
    // Back-nine points 18 against 19.
    const a = [...Array(9).fill(2), ...Array(9).fill(2)];
    const b = [...Array(8).fill(2), 1, 2, 2, 2, 2, 2, 2, 2, 2, 3];
    const r = countbackBetween(cb(a), cb(b), 18, true);
    expect(r.decidedBy).toEqual({ holes: 9, a: 18, b: 19 });
    expect(r.order).toBeGreaterThan(0); // b ahead on more points
  });

  it("a nine-hole round starts at the last six", () => {
    const nine = PARS.slice(0, 9);
    const other = nine.map((p, i) => p + (i === 0 ? 1 : i === 8 ? -1 : 0));
    const r = countbackBetween(cb(nine), cb(other), 9);
    expect(r.decidedBy?.holes).toBe(6);
  });
});

describe("A cut of the top N and ties", () => {
  // Seven players, cut to the top 4. 4th and 5th are level on 73.
  const rows: CutLineRow[] = [70, 71, 72, 73, 73, 74, 75].map((score, i) => ({
    id: `zz-${i + 1}`,
    groupId: null,
    rank: [1, 2, 3, 4, 4, 6, 7][i],
    score,
  }));
  const top4: CutRule = { scope: "overall", mode: "count", count: 4, percent: 0 };

  it("'and ties' takes FIVE: both players on 73", () => {
    const out = cutLineOutcome(rows, top4, "ties", []);
    expect([...out.through].sort()).toEqual(["zz-1", "zz-2", "zz-3", "zz-4", "zz-5"]);
  });

  it("a play-off rule sends three through and leaves a tie of two for the one place left", () => {
    const out = cutLineOutcome(rows, top4, "playoff", []);
    expect([...out.through].sort()).toEqual(["zz-1", "zz-2", "zz-3"]);
    expect(out.undecided).toEqual([{ groupId: null, playerIds: ["zz-4", "zz-5"], places: 1, by: "playoff" }]);
  });

  it("a percentage cut rounds UP: half of seven is four", () => {
    expect(survivorCount({ scope: "overall", mode: "percent", count: 0, percent: 50 }, 7)).toBe(4);
  });
});

describe("A knockout's seeding: 1 and 2 can meet only in the final", () => {
  it("sixteen: 1v16, 8v9, 4v13, 5v12, 2v15, 7v10, 3v14, 6v11", () => {
    const o = seedOrder(16);
    const pairs = Array.from({ length: 8 }, (_, i) => [o[2 * i], o[2 * i + 1]].sort((x, y) => x - y).join("v"));
    expect(new Set(pairs)).toEqual(new Set(["1v16", "8v9", "4v13", "5v12", "2v15", "7v10", "3v14", "6v11"]));
    // Every first-round tie adds to seventeen.
    for (let i = 0; i < 8; i += 1) expect(o[2 * i] + o[2 * i + 1]).toBe(17);
    // 1 and 2 are in opposite halves; 1 and 4 in the same half, opposite quarters.
    const half = (s: number) => (o.indexOf(s) < 8 ? "top" : "bottom");
    expect(half(1)).not.toBe(half(2));
    expect(half(1)).toBe(half(4));
    expect(Math.floor(o.indexOf(1) / 4)).not.toBe(Math.floor(o.indexOf(4) / 4));
  });
});

describe("A round robin's table: two for a win, one for a half (DEFAULT_SCORING)", () => {
  const players: Player[] = ["a", "b", "c"].map((id, i) => ({ id: `zz-${id}`, name: `Invented ${id.toUpperCase()}`, handicap: 0, seed: i + 1 }));
  const m = (id: string, a: string, b: string, holes: HoleResult[]): Match => ({
    id,
    stageId: "s1",
    groupId: "g1",
    round: 1,
    playerAId: `zz-${a}`,
    playerBId: `zz-${b}`,
    holes,
  });
  const oneUp: HoleResult[] = [...Array(17).fill("H"), "A"];
  const halved: HoleResult[] = Array(18).fill("H");

  it("A beats B and halves C, B beats C: A 3, B 2, C 1", () => {
    const table = computeStandings(
      players,
      [m("m1", "a", "b", oneUp), m("m2", "a", "c", halved), m("m3", "b", "c", oneUp)],
      DEFAULT_SCORING,
    );
    expect(table.map((r) => [r.player.id, r.stats.totalPoints, r.rank])).toEqual([
      ["zz-a", 3, 1],
      ["zz-b", 2, 2],
      ["zz-c", 1, 3],
    ]);
    // Two points are given out per match, whatever happened in it.
    expect(table.reduce((s, r) => s + r.stats.totalPoints, 0)).toBe(6);
  });
});

describe("Money: a pot is paid to the cent, and settles to nought", () => {
  it("a $5 skins game of three, gross, skins 2 / 3 / 0: $6.00, $9.00, nothing", () => {
    const outcome = playSkins(
      [
        { playerId: "zz-p1", strokes: [4, 3, 5, 4, 5, 4], courseHandicap: 0 },
        { playerId: "zz-p2", strokes: [4, 4, 5, 4, 4, 4], courseHandicap: 0 },
        { playerId: "zz-p3", strokes: [5, 4, 5, 5, 5, 4], courseHandicap: 0 },
      ],
      6,
      { net: false },
    );
    const pot = skinsPot(outcome, 500, ["zz-p1", "zz-p2", "zz-p3"]);
    // Pot 1500; the unclaimed skin on the 6th leaves five claimed: 1500 x 2/5 = 600, x 3/5 = 900.
    expect(pot.potCents).toBe(1500);
    expect(pot.shares.map((s) => [s.wonCents, s.netCents])).toEqual([
      [600, 100],
      [900, 400],
      [0, -500],
    ]);
    expect(pot.shares.reduce((a, s) => a + s.netCents, 0)).toBe(0);
    // P3 pays P2 $4 and P1 $1.
    expect(settle(pot.shares.map((s) => ({ playerId: s.playerId, netCents: s.netCents })))).toEqual([
      { fromPlayerId: "zz-p3", toPlayerId: "zz-p2", cents: 400 },
      { fromPlayerId: "zz-p3", toPlayerId: "zz-p1", cents: 100 },
    ]);
  });

  it("odd cents go to whoever was rounded down hardest (largest remainder)", () => {
    // $10.00 three ways: 333.33 each, one cent over -> the first.
    expect(splitExactly(1000, [1, 1, 1])).toEqual([334, 333, 333]);
    // $40.01 by 3:2:1: 2000.5, 1333.67, 666.83 -> floors 3999, two cents to the .83 and the .67.
    expect(splitExactly(4001, [3, 2, 1])).toEqual([2000, 1334, 667]);
    // 7 cents five ways: 1.4 each, two cents to the first two.
    expect(splitExactly(7, [1, 1, 1, 1, 1])).toEqual([2, 2, 1, 1, 1]);
  });

  it("every split of every pot from 1 cent to $20 sums to the pot", () => {
    for (let total = 1; total <= 2000; total += 7) {
      for (const w of [[1], [1, 1], [3, 2, 1], [5, 0, 2, 9], [1, 1, 7]]) {
        const parts = splitExactly(total, w);
        expect(parts.reduce((a, b) => a + b, 0), `${total} by ${w}`).toBe(total);
        // Nobody is paid more than a cent away from their exact share.
        const sum = w.reduce((a, b) => a + b, 0);
        parts.forEach((p, i) => expect(Math.abs(p - (total * w[i]) / sum)).toBeLessThan(1));
      }
    }
  });

  it("a pot is the stake times the field, and a settle-up moves exactly what is owed", () => {
    expect(potCents(500, 7)).toBe(3500);
    const nets = [
      { playerId: "zz-a", netCents: 1234 },
      { playerId: "zz-b", netCents: -1000 },
      { playerId: "zz-c", netCents: 266 },
      { playerId: "zz-d", netCents: -500 },
    ];
    const t = settle(nets);
    const paid = new Map<string, number>();
    for (const x of t) {
      paid.set(x.fromPlayerId, (paid.get(x.fromPlayerId) ?? 0) - x.cents);
      paid.set(x.toPlayerId, (paid.get(x.toPlayerId) ?? 0) + x.cents);
    }
    for (const n of nets) expect(paid.get(n.playerId), n.playerId).toBe(n.netCents);
  });

  it("equal remainders go to the earlier player, as the rule says: $5 skins of three, 1/1/7 is 167/167/1166", () => {
    // 1500 x 1/9 = 166 r 6, 1500 x 1/9 = 166 r 6, 1500 x 7/9 = 1166 r 6: all three remainders are 6/9.
    // Two odd cents, ties by order: the first and the second. (Floating point gave 167/166/1167.)
    expect(splitExactly(1500, [1, 1, 7])).toEqual([167, 167, 1166]);
    expect(splitExactly(1500, [4, 4, 1])).toEqual([667, 667, 166]);
    expect(splitExactly(2, [4, 1, 1])).toEqual([2, 0, 0]);
  });

  it("PROPERTY: every split matches largest-remainder worked in whole numbers, ties by order", () => {
    // A seeded generator, so a failure is the same failure on every run.
    let seed = 20261109;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    /** The rule, worked in BigInt: quotient and remainder of total x w by the sum of the weights. */
    const byHand = (total: number, w: number[]): number[] => {
      const T = BigInt(total);
      const S = w.reduce((a, b) => a + BigInt(b), 0n);
      if (S === 0n || T === 0n) return w.map(() => 0);
      const q = w.map((x) => (T * BigInt(x)) / S);
      const r = w.map((x) => (T * BigInt(x)) % S);
      let left = T - q.reduce((a, b) => a + b, 0n);
      const order = w.map((_, i) => i).sort((i, j) => (r[j] > r[i] ? 1 : r[j] < r[i] ? -1 : i - j));
      const out = [...q];
      for (const i of order) {
        if (left <= 0n) break;
        out[i] += 1n;
        left -= 1n;
      }
      return out.map(Number);
    };
    for (let k = 0; k < 3000; k += 1) {
      const total = 1 + rand(200000);
      const w = Array.from({ length: 1 + rand(6) }, () => rand(21));
      expect(splitExactly(total, w), `${total} by ${w}`).toEqual(byHand(total, w));
    }
  });
});

/**
 * NET COUNTBACK BY FRACTIONS OF THE HANDICAP (Committee Procedures 5A(7)),
 * from 2026-11-09. "One-half, one-third, one-sixth and one-eighteenth of the
 * handicaps should be deducted from the score for the last 9, 6, 3 and last
 * hole respectively"; over nine holes, the same proportion: two-thirds, a
 * third, a ninth.
 */
describe("Net countback takes fractions of the playing handicap off the last 9, 6, 3 and 1", () => {
  const SI = [7, 3, 15, 1, 11, 5, 17, 13, 9, 8, 16, 2, 12, 4, 10, 18, 6, 14];
  const netOf = (gross: number[], playing: number, si: number[], holes: number) =>
    gross.map((g, i) => g - holeStrokesReceived(playing, si[i], holes));
  /**
   * A plays off 9 and shoots 81: bogeys on 1-5 (41 out), and on 11, 13, 15 and 16 (40 home).
   * His nine strokes fall on SI 1-9, four of them on the back nine (holes 10, 12, 14, 17).
   * B plays off 0 and shoots level par, 36 / 36. Both are net 72.
   *
   *   by fractions   last nine: A 40 - 9/2 = 35.5, B 36  -> A wins on the last nine
   *   hole by hole   last nine: A 40 - 4 = 36, B 36, level; last six: A 27 - 2 = 25, B 24 -> B
   */
  const aGross = [5, 5, 4, 6, 5, 4, 3, 4, 5, 4, 4, 5, 5, 4, 5, 4, 5, 4];
  const bGross = [...PARS];
  const A = { gross: aGross, net: netOf(aGross, 9, SI, 18), points: [] };
  const B = { gross: bGross, net: netOf(bGross, 0, SI, 18), points: [] };

  it("CONTROL: both are net 72", () => {
    expect(A.net.reduce((a, b) => a + b, 0)).toBe(72);
    expect(B.net.reduce((a, b) => a + b, 0)).toBe(72);
  });

  it("by fractions, A wins on the last nine, 35.5 to 36", () => {
    const r = countbackBetween(countbackCardOn("a", A, "net", "fractions"), countbackCardOn("b", B, "net", "fractions"), 18);
    expect(r.decidedBy).toEqual({ holes: 9, a: 35.5, b: 36 });
    expect(r.order).toBeLessThan(0);
  });

  it("an event created before the change keeps hole by hole: level on nine, B on the last six", () => {
    const r = countbackBetween(countbackCardOn("a", A, "net", "hole-by-hole"), countbackCardOn("b", B, "net", "hole-by-hole"), 18);
    expect(r.decidedBy).toEqual({ holes: 6, a: 25, b: 24 });
    expect(r.order).toBeGreaterThan(0);
  });

  it("the handicap taken off is the round's own playing handicap, read off the card", () => {
    expect(countbackCardOn("a", A, "net", "fractions").fractionOf).toBe(9);
    expect(countbackCardOn("b", B, "net", "fractions").fractionOf).toBe(0);
    // A plus 2 gives two strokes back: gross less net is -2.
    const plus = { gross: [...PARS], net: netOf([...PARS], -2, SI, 18), points: [] };
    expect(countbackCardOn("p", plus, "net", "fractions").fractionOf).toBe(-2);
  });

  it("a third off the last six, a sixth off the last three, an eighteenth off the last hole", () => {
    // Pairs off 18 (a stroke a hole), bogeys all the way out (45), level on the last nine, and
    // swapping a birdie and a bogey between two holes so a later step decides. Hole numbers 1-18.
    const off18 = (changes: Record<number, number>) => {
      const g = PARS.map((p, i) => p + (i < 9 ? 1 : 0) + (changes[i + 1] ?? 0));
      return countbackCardOn("x", { gross: g, net: netOf(g, 18, SI, 18), points: [] }, "net", "fractions");
    };
    // Last six (13-18): 24 - 1 = 23 less 18/3 = 17, against 25 - 6 = 19.
    expect(countbackBetween(off18({ 10: 1, 13: -1 }), off18({ 10: -1, 13: 1 }), 18).decidedBy).toEqual({ holes: 6, a: 17, b: 19 });
    // Last three (16-18): 11 less 18/6 = 8, against 13 - 3 = 10.
    expect(countbackBetween(off18({ 13: 1, 16: -1 }), off18({ 13: -1, 16: 1 }), 18).decidedBy).toEqual({ holes: 3, a: 8, b: 10 });
    // Last hole: 3 less 18/18 = 2, against 5 - 1 = 4.
    expect(countbackBetween(off18({ 16: 1, 18: -1 }), off18({ 16: -1, 18: 1 }), 18).decidedBy).toEqual({ holes: 1, a: 2, b: 4 });
  });

  it("over nine holes, two-thirds off the last six", () => {
    // A nine-hole round off the front nine, ranked 1-9. F plays off 4 and shoots 40 (bogeys on 1-4);
    // G is scratch, 36. Last six (holes 4-9): F 26 - 4 x 2/3 = 23.33, G 25 -> F.
    const nine = PARS.slice(0, 9);
    const ranked = rankStrokeIndex(SI.slice(0, 9));
    const f = nine.map((p, i) => p + (i < 4 ? 1 : 0));
    const F = { gross: f, net: netOf(f, 4, ranked, 9), points: [] };
    const G = { gross: [...nine], net: [...nine], points: [] };
    expect(F.net.reduce((a, b) => a + b, 0)).toBe(36);
    const r = countbackBetween(countbackCardOn("f", F, "net", "fractions"), countbackCardOn("g", G, "net", "fractions"), 9);
    expect(r.decidedBy?.holes).toBe(6);
    expect(r.decidedBy?.a).toBeCloseTo(26 - 8 / 3, 9);
    expect(r.decidedBy?.b).toBe(25);
  });

  it("Stableford and gross count back as before: points and gross, nothing taken off", () => {
    const pts = { gross: [...PARS], net: [...PARS], points: PARS.map(() => 2) };
    expect(countbackCardOn("s", pts, "stableford", "fractions")).toEqual({ playerId: "s", total: 0, holes: pts.points });
    expect(countbackCardOn("s", pts, "gross", "fractions")).toEqual({ playerId: "s", total: 0, holes: pts.gross });
  });

  it("the order is the step's difference in strokes, and a decided countback is not incomplete", () => {
    // A v B above: 35.5 against 36 on the last nine is half a stroke.
    const r = countbackBetween(countbackCardOn("a", A, "net", "fractions"), countbackCardOn("b", B, "net", "fractions"), 18);
    expect(r.order).toBe(-0.5);
    expect(r.incomplete).toBe(false);
    expect(r.levelOn).toEqual([]);
  });

  it("a card with a hole missing, or a short card, cannot be counted back (it is incomplete, not behind)", () => {
    const gap = { gross: [...aGross.slice(0, 17), null], net: [...A.net.slice(0, 17), null], points: [] };
    const r = countbackBetween(countbackCardOn("a", gap, "net", "fractions"), countbackCardOn("b", B, "net", "fractions"), 18);
    expect(r).toEqual({ order: 0, decidedBy: null, levelOn: [], incomplete: true });
    const short = { gross: aGross.slice(0, 5), net: A.net.slice(0, 5), points: [] };
    expect(countbackBetween(countbackCardOn("a", short, "net", "fractions"), countbackCardOn("b", B, "net", "fractions"), 18).incomplete).toBe(true);
    // A blank in a NET card is a hole without its strokes: those are not counted as given.
    expect(countbackCardOn("x", { gross: [5, 5, 4], net: [4, null, 4], points: [] }, "net", "fractions").fractionOf).toBe(1);
    expect(countbackCardOn("x", { gross: [5, Number.NaN, 4], net: [4, 4, 4], points: [] }, "net", "fractions").fractionOf).toBe(1);
    // No card at all is an empty one.
    expect(countbackCardOn("x", undefined, "net", "fractions")).toEqual({ playerId: "x", total: 0, holes: [] });
  });

  it("the ladder's words, and a round too short for any of it", () => {
    expect(countbackStepWords(9, 18)).toBe("back 9");
    expect(countbackStepWords(6, 18)).toBe("last 6");
    expect(countbackStepWords(1, 9)).toBe("last hole");
    expect(countbackSegments(5)).toEqual([1]);
    expect(countbackSegments(1)).toEqual([]);
  });

  it("which events: created from 2026-11-09 00:00 UTC by fractions, before it hole by hole", () => {
    expect(netCountbackMethodFor(null)).toBe("fractions");
    expect(NET_COUNTBACK_FRACTIONS_FROM.toISOString()).toBe("2026-11-09T00:00:00.000Z");
    expect(netCountbackMethodFor(new Date("2026-11-08T23:59:59Z"))).toBe("hole-by-hole");
    expect(netCountbackMethodFor(new Date("2026-11-09T00:00:00Z"))).toBe("fractions");
    expect(netCountbackMethodFor(new Date("2027-01-01T00:00:00Z"))).toBe("fractions");
  });
});

describe("The rules sheet says how a net tie is counted back", () => {
  const ties = (over: Partial<Parameters<typeof tournamentTerms>[0]>) =>
    tournamentTerms({
      format: "Stroke Play",
      type: "Stroke Play Round",
      holes: 18,
      scoringBasis: "net",
      handicapAllowance: 0,
      countBest: 0,
      tiebreakers: [],
      cutAfter: null,
      carryForwardEnabled: false,
      carryForwardPct: 0,
      netCountback: "fractions",
      ...over,
    })
      .filter((t) => t.label === "Ties" || t.label === "Net countback")
      .map((t) => `${t.label}: ${t.value}`)
      .join(" | ");
  const PLAIN = "Ties: Countback: last 9, 6 and 3 holes, then the final hole. A tie after that is shared.";

  it("an individual net medal names the fractions, on their own short line, over eighteen holes and nine", () => {
    expect(ties({})).toBe(
      `${PLAIN} | Net countback: With ½, ⅓, ⅙ and 1/18 of the playing handicap off.`,
    );
    expect(ties({ holes: 9 })).toBe(
      "Ties: Countback: last 6 and 3 holes, then the final hole. A tie after that is shared. | Net countback: With ⅔, ⅓ and 1/9 of the playing handicap off.",
    );
  });

  it("not for gross, Stableford, a team round, or an event that keeps hole by hole", () => {
    expect(ties({ scoringBasis: "gross" })).toBe(PLAIN);
    expect(ties({ format: "Stableford" })).toBe(PLAIN);
    expect(ties({ format: "Four-Ball" })).toBe(PLAIN);
    expect(ties({ netCountback: "hole-by-hole" })).toBe(PLAIN);
  });
});
