import { describe, it, expect } from "vitest";
import { countbackBetween, countbackSegments } from "../domain/stroke-countback";
import { cutLineOutcome, survivorCount, type CutLineRow, type CutRule } from "../domain/cut";
import { seedOrder } from "../domain/bracket";
import { computeStandings } from "../domain/standings";
import { DEFAULT_SCORING, type HoleResult, type Match, type Player } from "../domain/types";
import { playSkins } from "../domain/skins";
import { skinsPot } from "../domain/skins-pot";
import { potCents, settle, splitExactly } from "../domain/money";

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
});
