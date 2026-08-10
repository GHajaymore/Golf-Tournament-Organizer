import { describe, it, expect } from "vitest";
import {
  splitExactly,
  skinsPot,
  settle,
  seasonPosition,
  scopeRange,
  isSkinsScope,
} from "../skins-pot";
import { playSkins } from "../skins";

/**
 * The money side of a skins game.
 *
 * These tests care about arithmetic rather than golf. A settlement sheet that
 * does not add up is worse than none at all: it is the one output a club will
 * check against cash in a hand, and being a penny out destroys trust in every
 * other number the app produces.
 */

describe("splitting a pot exactly", () => {
  it("always hands out the whole pot, never a penny more or less", () => {
    // The guarantee the rest of this file rests on. £60 across 7 skins is
    // 857.142857... pence a skin — every independent-rounding method loses or
    // invents pence here.
    for (const total of [6000, 5999, 1, 0, 12345]) {
      for (const weights of [[1, 1, 1], [7], [3, 2, 2], [1, 1, 1, 1, 1, 1, 1], [5, 0, 0]]) {
        const parts = splitExactly(total, weights);
        expect(parts.reduce((a, b) => a + b, 0), `${total} across ${weights}`).toBe(total);
      }
    }
  });

  it("splits evenly when weights are equal", () => {
    expect(splitExactly(900, [1, 1, 1])).toEqual([300, 300, 300]);
  });

  it("gives the odd pennies to whoever was rounded down hardest", () => {
    // 100 across three is 33.33 each with a penny spare; it goes to the first
    // by index once the fractions tie, so the result is deterministic.
    const parts = splitExactly(100, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100);
    expect(parts.filter((p) => p === 34)).toHaveLength(1);
  });

  it("pays nothing to a zero weight", () => {
    expect(splitExactly(1000, [1, 0])).toEqual([1000, 0]);
  });

  it("returns zeroes rather than dividing by nothing", () => {
    expect(splitExactly(1000, [0, 0])).toEqual([0, 0]);
    expect(splitExactly(0, [1, 1])).toEqual([0, 0]);
  });

  it("is deterministic — the same input always settles the same way", () => {
    const a = splitExactly(1000, [3, 3, 3]);
    const b = splitExactly(1000, [3, 3, 3]);
    expect(a).toEqual(b);
  });
});

describe("a week's skins pot", () => {
  /** Three players over three holes; p1 wins hole 1 outright, 2 and 3 tie. */
  const card = () =>
    playSkins(
      [
        { playerId: "p1", strokes: [3, 4, 4], courseHandicap: 0 },
        { playerId: "p2", strokes: [4, 4, 4], courseHandicap: 0 },
        { playerId: "p3", strokes: [5, 4, 4], courseHandicap: 0 },
      ],
      3,
      { net: false, strokeIndex: [1, 2, 3] },
    );

  it("builds the pot from the buy-in and who is in it", () => {
    const pot = skinsPot(card(), 500, ["p1", "p2", "p3"]);
    expect(pot.potCents).toBe(1500);
    expect(pot.playerCount).toBe(3);
    expect(pot.stakeCents).toBe(500);
  });

  it("pays out the whole pot, to the penny", () => {
    // The invariant that matters: a week goes out in full. Nothing is held
    // back and nothing rolls into next week.
    const pot = skinsPot(card(), 500, ["p1", "p2", "p3"]);
    const paid = pot.shares.reduce((a, s) => a + s.wonCents, 0);
    expect(paid).toBe(pot.potCents);
    expect(pot.carryCents).toBe(0);
  });

  it("shares the whole week among whoever won a hole", () => {
    // Two of three holes tied. Their value is not held back — it widens the
    // slice of the player who did win one, and the week settles in full.
    const pot = skinsPot(card(), 500, ["p1", "p2", "p3"]);
    expect(pot.unclaimedSkins).toBeGreaterThan(0);
    expect(pot.carryCents).toBe(0);
    expect(pot.shares.find((s) => s.playerId === "p1")!.wonCents).toBe(pot.potCents);
  });

  it("nets a player's stake off what they won", () => {
    const pot = skinsPot(card(), 500, ["p1", "p2", "p3"]);
    const p2 = pot.shares.find((s) => s.playerId === "p2")!;
    // p2 won nothing, so they are down exactly their stake.
    expect(p2.skins).toBe(0);
    expect(p2.netCents).toBe(-500);
  });

  it("gives everyone their stake back when nobody wins a hole at all", () => {
    // Every hole tied. There is nothing to divide by, and a week settles on
    // its own — so the money goes back to the people who put it in rather
    // than being held over or handed to somebody who won nothing.
    const allTied = playSkins(
      [
        { playerId: "p1", strokes: [4, 4], courseHandicap: 0 },
        { playerId: "p2", strokes: [4, 4], courseHandicap: 0 },
      ],
      2,
      { net: false, strokeIndex: [1, 2] },
    );
    const pot = skinsPot(allTied, 500, ["p1", "p2"]);
    expect(pot.claimedSkins).toBe(0);
    expect(pot.carryCents).toBe(0);
    // Everyone square: what they took out is what they put in.
    expect(pot.shares.every((s) => s.wonCents === s.stakeCents)).toBe(true);
    expect(pot.shares.every((s) => s.netCents === 0)).toBe(true);
  });

  it("says so when holes are still unplayed", () => {
    // A confident number on an unfinished week is the dishonest option.
    expect(skinsPot(card(), 500, ["p1"], 4).provisional).toBe(true);
    expect(skinsPot(card(), 500, ["p1"], 0).provisional).toBe(false);
  });

  it("charges a player once even if listed twice", () => {
    expect(skinsPot(card(), 500, ["p1", "p1", "p2"]).playerCount).toBe(2);
  });

  it("copes with a free game", () => {
    const pot = skinsPot(card(), 0, ["p1", "p2"]);
    expect(pot.potCents).toBe(0);
    expect(pot.shares.every((s) => s.netCents === 0)).toBe(true);
  });
});

describe("settling up", () => {
  it("moves money from the down to the up, and balances", () => {
    const nets = [
      { playerId: "a", netCents: -1000 },
      { playerId: "b", netCents: 600 },
      { playerId: "c", netCents: 400 },
    ];
    const transfers = settle(nets);
    expect(transfers.reduce((s, t) => s + t.cents, 0)).toBe(1000);
    for (const t of transfers) expect(t.cents).toBeGreaterThan(0);
  });

  it("leaves each player exactly square afterwards", () => {
    const nets = [
      { playerId: "a", netCents: -750 },
      { playerId: "b", netCents: -250 },
      { playerId: "c", netCents: 1000 },
    ];
    const after = new Map(nets.map((n) => [n.playerId, n.netCents]));
    for (const t of settle(nets)) {
      after.set(t.fromPlayerId, (after.get(t.fromPlayerId) ?? 0) + t.cents);
      after.set(t.toPlayerId, (after.get(t.toPlayerId) ?? 0) - t.cents);
    }
    for (const v of after.values()) expect(v).toBe(0);
  });

  it("nets rather than printing every pairwise debt", () => {
    // Four players, two down and two up: everybody-pays-everybody would be
    // four handshakes at best and six at worst. This should be near-minimal.
    const transfers = settle([
      { playerId: "a", netCents: -500 },
      { playerId: "b", netCents: -500 },
      { playerId: "c", netCents: 500 },
      { playerId: "d", netCents: 500 },
    ]);
    expect(transfers.length).toBeLessThanOrEqual(3);
  });

  it("asks nothing of anyone when everybody is square", () => {
    expect(settle([{ playerId: "a", netCents: 0 }, { playerId: "b", netCents: 0 }])).toEqual([]);
  });

  it("is deterministic", () => {
    const nets = [
      { playerId: "a", netCents: -300 },
      { playerId: "b", netCents: -300 },
      { playerId: "c", netCents: 600 },
    ];
    expect(settle(nets)).toEqual(settle(nets));
  });
});

describe("a season's running position", () => {
  const week = (netByPlayer: Record<string, number>) => ({
    potCents: 0, stakeCents: 0, playerCount: 0, claimedSkins: 0, unclaimedSkins: 0,
    carryCents: 0, provisional: false,
    shares: Object.entries(netByPlayer).map(([playerId, netCents]) => ({
      playerId, skins: 0, wonCents: 0, stakeCents: 0, netCents,
    })),
  });

  it("adds each week up, best off first", () => {
    const table = seasonPosition([
      week({ a: -500, b: 500 }),
      week({ a: 1500, b: -1500 }),
    ]);
    expect(table[0]).toEqual({ playerId: "a", netCents: 1000 });
    expect(table[1]).toEqual({ playerId: "b", netCents: -1000 });
  });

  it("includes a player who missed a week without inventing a stake for them", () => {
    const table = seasonPosition([week({ a: -500, b: 500 }), week({ a: 500 })]);
    expect(table.find((r) => r.playerId === "b")!.netCents).toBe(500);
    expect(table.find((r) => r.playerId === "a")!.netCents).toBe(0);
  });
});


describe("which holes a pot is played over", () => {
  it("slices the front and back of an eighteen-hole round", () => {
    expect(scopeRange("front", 18)).toEqual({ from: 0, to: 9 });
    expect(scopeRange("back", 18)).toEqual({ from: 9, to: 18 });
    expect(scopeRange("full", 18)).toEqual({ from: 0, to: 18 });
  });

  it("plays the whole card on a nine-hole round, whatever the scope says", () => {
    // A nine-hole card has no back nine to slice. Reading "back" as holes
    // 10-18 there would select nothing and score no skins at all — the pot
    // would silently pay nobody.
    for (const scope of ["full", "front", "back"] as const) {
      expect(scopeRange(scope, 9), scope).toEqual({ from: 0, to: 9 });
    }
  });

  it("recognises the three scopes and nothing else", () => {
    expect(isSkinsScope("full")).toBe(true);
    expect(isSkinsScope("front")).toBe(true);
    expect(isSkinsScope("back")).toBe(true);
    expect(isSkinsScope("middle")).toBe(false);
    expect(isSkinsScope("")).toBe(false);
  });

  it("covers every hole exactly once across front and back", () => {
    // Nine plus nine is eighteen, with nothing counted twice and nothing
    // missed — the property that makes two half-pots equal one whole one.
    const f = scopeRange("front", 18);
    const b = scopeRange("back", 18);
    expect(f.to - f.from).toBe(9);
    expect(b.to - b.from).toBe(9);
    expect(f.to).toBe(b.from);
    expect(b.to).toBe(scopeRange("full", 18).to);
  });
});
