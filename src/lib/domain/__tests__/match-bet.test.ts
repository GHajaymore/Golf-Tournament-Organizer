import { describe, it, expect } from "vitest";
import { matchBetNets, matchBetLedger } from "../derived-games";
import type { HoleResult } from "../types";

/**
 * "We're playing for a tenner" — the commonest bet in golf, and the one the
 * app had nowhere to put.
 *
 * Everything else in derived-games is a POT: everybody pays in and the cards
 * decide who takes it out. This is not. It is one wager between two sides,
 * settled by the match result and nothing else.
 *
 * A Nassau is three of these on one card. Offering only the Nassau meant a
 * fourball playing for a single stake had to describe it as three bets and
 * divide by three.
 *
 * TourneyHQ works this out and writes it down. It never moves the money.
 */

/** A card from a string: A won, B won, H halved, . not played. */
const card = (s: string): HoleResult[] =>
  s.split("").map((c) => (c === "." ? null : (c as "A" | "B" | "H")));

const singles = (holes: string, stakeCents = 1000) =>
  matchBetNets({ matchId: "m1", sideA: ["a"], sideB: ["b"], holes: card(holes), stakeCents });

describe("a singles match played for a tenner", () => {
  it("pays the winner out of the loser", () => {
    // A wins 1, 2 and 3, halves the rest to the 16th: 3&2.
    const nets = singles("AAAHHHHHHHHHHHHH..");
    expect(nets).toEqual([
      { playerId: "a", netCents: 1000 },
      { playerId: "b", netCents: -1000 },
    ]);
    // A settle-up that does not sum to zero is money invented or lost.
    expect(nets.reduce((t, n) => t + n.netCents, 0)).toBe(0);
  });

  it("and the other way round, or it is not testing the winner at all", () => {
    const nets = singles("BBBHHHHHHHHHHHHH..");
    expect(nets.find((n) => n.playerId === "b")?.netCents).toBe(1000);
    expect(nets.find((n) => n.playerId === "a")?.netCents).toBe(-1000);
  });
});

describe("what does not pay", () => {
  it("a match still being played", () => {
    /**
     * Paying a lead is settling a bet that is still on. Two up with sixteen
     * to play is a match anybody can still win, and the app has no business
     * naming a winner of it.
     */
    expect(singles("AA..............")).toEqual([]);
  });

  it("a halved match", () => {
    // Everyone keeps their own stake, which is what halved means — so this
    // returns nothing rather than a pair of zeroes.
    expect(singles("HHHHHHHHHHHHHHHHHH")).toEqual([]);
  });

  it("a match nobody staked anything on", () => {
    expect(singles("AAAHHHHHHHHHHHHH..", 0)).toEqual([]);
  });

  it("and a fixture with a side missing", () => {
    // A match needs two sides. One side and a stake is not a bet, and paying
    // it would credit somebody out of nobody.
    expect(
      matchBetNets({ matchId: "m", sideA: ["a"], sideB: [], holes: card("AAAHHHHHHHHHHHHH.."), stakeCents: 1000 }),
    ).toEqual([]);
  });
});

describe("a four-ball played for a tenner each", () => {
  it("pays every winner a stake, out of every loser", () => {
    /**
     * PER PLAYER, NOT PER SIDE, and that is the whole of the arithmetic. Each
     * of the four has a tenner on it, so each winner takes one from their
     * opposite number — the side does not win one stake between two.
     *
     * It is also what the four of them would count out at the bar.
     */
    const nets = matchBetNets({
      matchId: "m1",
      sideA: ["a1", "a2"],
      sideB: ["b1", "b2"],
      holes: card("AAAHHHHHHHHHHHHH.."),
      stakeCents: 1000,
    });
    expect(nets).toHaveLength(4);
    expect(nets.filter((n) => n.netCents === 1000).map((n) => n.playerId).sort()).toEqual(["a1", "a2"]);
    expect(nets.filter((n) => n.netCents === -1000).map((n) => n.playerId).sort()).toEqual(["b1", "b2"]);
    expect(nets.reduce((t, n) => t + n.netCents, 0)).toBe(0);
  });

  it("and still sums to zero when a side is a player short", () => {
    /**
     * Two against one is not a thing a fourball agrees to, but a side can end
     * up short — somebody withdraws, a fourball goes out as a threesome — and
     * the bet still has to balance. Paying two full stakes out of one loser
     * would invent ten pounds.
     *
     * The single player is down a full stake; the two winners share it.
     */
    const nets = matchBetNets({
      matchId: "m1",
      sideA: ["a1", "a2"],
      sideB: ["b1"],
      holes: card("AAAHHHHHHHHHHHHH.."),
      stakeCents: 1000,
    });
    expect(nets.reduce((t, n) => t + n.netCents, 0)).toBe(0);
    expect(nets.find((n) => n.playerId === "b1")?.netCents).toBe(-1000);
    expect(nets.filter((n) => n.netCents === 500)).toHaveLength(2);
  });
});

describe("every match bet in a round", () => {
  it("adds up across matches, and drops anybody who came out level", () => {
    const bets = [
      { matchId: "m1", sideA: ["a"], sideB: ["b"], holes: card("AAAHHHHHHHHHHHHH.."), stakeCents: 1000 },
      // The same two again, the other way: they are square, and a settle-up
      // listing somebody at zero is a line nobody has to act on.
      { matchId: "m2", sideA: ["a"], sideB: ["b"], holes: card("BBBHHHHHHHHHHHHH.."), stakeCents: 1000 },
      { matchId: "m3", sideA: ["c"], sideB: ["d"], holes: card("AAAHHHHHHHHHHHHH.."), stakeCents: 500 },
    ];
    const ledger = matchBetLedger(bets);
    expect(ledger.map((n) => n.playerId)).toEqual(["c", "d"]);
    expect(ledger.find((n) => n.playerId === "c")?.netCents).toBe(500);
    expect(ledger.reduce((t, n) => t + n.netCents, 0)).toBe(0);
  });
});
