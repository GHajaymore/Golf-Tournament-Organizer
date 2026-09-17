import { describe, it, expect } from "vitest";
import { nightPurse, skinsPot, stakesGoBack } from "../skins-pot";
import type { SkinsOutcome } from "../skins";

/**
 * A NIGHT'S PURSE across several skins games.
 *
 * Built from `skinsPot` itself rather than hand-written shares, so the rows
 * are what the money screen really receives. The amounts are chosen so a
 * wrong sum cannot land on the right number by accident.
 */

const won = (skins: Record<string, number>): SkinsOutcome => ({
  holes: [],
  standings: Object.entries(skins).map(([playerId, n]) => ({
    playerId,
    skins: n,
    holesWon: [],
  })),
  unclaimed: 0,
});

describe("nightPurse", () => {
  // Front net: $5 each, a wins 2 skins, b wins 1. Pot 1500 split 2:1.
  const front = skinsPot(won({ a: 2, b: 1 }), 500, ["a", "b", "c"]);
  // Back gross: $10 each, only a and c in; c wins the only skin.
  const back = skinsPot(won({ c: 1 }), 1000, ["a", "c"]);

  it("adds each player up across the games they were in", () => {
    const p = nightPurse([front, back]);
    // Most up first: c is up $5, b level, a down $5.
    expect(p.rows).toEqual([
      { playerId: "c", games: 2, stakeCents: 1500, wonCents: 2000, netCents: 500 },
      { playerId: "b", games: 1, stakeCents: 500, wonCents: 500, netCents: 0 },
      { playerId: "a", games: 2, stakeCents: 1500, wonCents: 1000, netCents: -500 },
    ]);
  });

  it("pays out exactly what went in — the total line reconciles", () => {
    const p = nightPurse([front, back]);
    expect(p.stakeCents).toBe(3500);
    expect(p.wonCents).toBe(3500);
    expect(p.rows.reduce((n, r) => n + r.netCents, 0)).toBe(0);
  });

  it("adds up what was actually paid, so a sheet that does not balance shows it", () => {
    // A result that pays a cent short — the thing the total line is there to
    // catch. Summing anything but the winnings would hide it.
    const short = {
      ...front,
      shares: front.shares.map((s, i) => (i === 0 ? { ...s, wonCents: s.wonCents - 1 } : s)),
    };
    const p = nightPurse([short]);
    expect(p.stakeCents).toBe(1500);
    expect(p.wonCents).toBe(1499);
  });

  it("reconciles when nobody wins a hole and everybody takes their stake back", () => {
    const flat = skinsPot(won({}), 700, ["a", "b", "c"]);
    const p = nightPurse([flat]);
    expect(p.rows.every((r) => r.wonCents === 700 && r.netCents === 0)).toBe(true);
    expect([p.stakeCents, p.wonCents]).toEqual([2100, 2100]);
  });

  it("reconciles on a pot that does not divide evenly", () => {
    // 3 x 333 = 999 split 1:1:1 — splitExactly places the odd cents.
    const odd = skinsPot(won({ a: 1, b: 1, c: 1 }), 333, ["a", "b", "c"]);
    const p = nightPurse([odd, front]);
    expect(p.wonCents).toBe(p.stakeCents);
  });

  it("is provisional while any game has a hole to play, and skips games not entered", () => {
    const live = skinsPot(won({ a: 1 }), 500, ["a", "b"], 3);
    expect(nightPurse([front, live]).final).toBe(false);
    expect(nightPurse([front, null]).final).toBe(true);
    expect(nightPurse([null]).rows).toEqual([]);
  });
});

describe("stakesGoBack", () => {
  it("is true when no hole was won, even though every share has a payout", () => {
    const flat = skinsPot(won({}), 700, ["a", "b"]);
    // The trap: every share is paid its stake back.
    expect(flat.shares.every((s) => s.wonCents > 0)).toBe(true);
    expect(stakesGoBack(flat)).toBe(true);
  });

  it("is false once somebody wins a skin", () => {
    expect(stakesGoBack(skinsPot(won({ a: 1 }), 700, ["a", "b"]))).toBe(false);
  });
});
