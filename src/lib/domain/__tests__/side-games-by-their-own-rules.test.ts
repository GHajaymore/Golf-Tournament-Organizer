import { describe, it, expect } from "vitest";
import { playSkins } from "../skins";
import { skinsPot } from "../skins-pot";
import { derivedNets, nassauNets, matchBetNets, DERIVED_KINDS, type PotCard } from "../derived-games";
import { nassauIsDecided } from "../nassau";
import { potCents, settle, splitExactly } from "../money";
import { shareOf, balances } from "../expenses";
import { contestNets } from "../contests";
import { roundMoneyIsFinal, paysWhen, SIDE_GAME_PAYS, CARD_SIDE_GAMES } from "../money-layout";
import type { HoleResult } from "../types";

/**
 * EVERY SIDE GAME, WORKED BY HAND FROM ITS OWN RULES (foundation pass, layer 8,
 * 2026-10-23).
 *
 * Each case below is worked out on paper first — the cards, who takes which
 * hole, the pot, the shares to the cent — and the figures are typed in. None
 * is derived by calling the app's own arithmetic, so a test cannot agree with
 * the code merely because it shares its method. Every pot is also checked to
 * pay out exactly what went in (a game is not a house).
 *
 * The rule each game is judged on is the one CLAUDE.md sets for money: report
 * an amount only when it CAN NO LONGER CHANGE. Skins, the birdie and eagle
 * pots, twos, low gross and low net change with any hole still to play; a
 * Nassau's segment, or a match, cannot be re-decided once it is over.
 */

const sum = (xs: Array<{ netCents: number }>) => xs.reduce((a, n) => a + n.netCents, 0);
const netOf = (xs: Array<{ playerId: string; netCents: number }>, id: string) => xs.find((n) => n.playerId === id)?.netCents ?? 0;

describe("skins: a tie carries, the pot divides by the skins won", () => {
  // Nine holes, gross, three players. Worked:
  //   1  A 4  B 5  C 5   A alone                  A takes 1
  //   2  A 4  B 4  C 5   A and B tie              carry 1
  //   3  3    3    3     all tie                  carry 2
  //   4  5    4    6     B alone, 1 + 2 carried   B takes 3
  //   5  4    4    3     C alone                  C takes 1
  //   6  4    4    4     tie                      carry 1
  //   7  4    4    4     tie                      carry 2
  //   8  5    5    4     C alone, 1 + 2 carried   C takes 3
  //   9  4    4    5     A and B tie              carry 1 — nobody can take it
  // A 1, B 3, C 4: eight skins won, one left on the 9th.
  const cards = {
    A: [4, 4, 3, 5, 4, 4, 4, 5, 4],
    B: [5, 4, 3, 4, 4, 4, 4, 5, 4],
    C: [5, 5, 3, 6, 3, 4, 4, 4, 5],
  };
  const players = Object.entries(cards).map(([playerId, strokes]) => ({ playerId, strokes, courseHandicap: 0 }));
  const outcome = playSkins(players, 9, { net: false });

  it("carries a tie of ANY two of the lowest into the next hole", () => {
    const won = Object.fromEntries(outcome.standings.map((s) => [s.playerId, s.skins]));
    expect(won).toEqual({ A: 1, B: 3, C: 4 });
    expect(outcome.standings.find((s) => s.playerId === "C")?.holesWon).toEqual([5, 8]);
    expect(outcome.holes.filter((h) => h.carried).map((h) => h.hole)).toEqual([2, 3, 6, 7, 9]);
    expect(outcome.unclaimed).toBe(1);
  });

  it("a $10 pot of three is $30, shared by the eight skins won: $3.75 a skin", () => {
    const pot = skinsPot(outcome, 1000, ["A", "B", "C"], 0);
    expect(pot.potCents).toBe(3000);
    const won = Object.fromEntries(pot.shares.map((s) => [s.playerId, s.wonCents]));
    expect(won).toEqual({ A: 375, B: 1125, C: 1500 });
    expect(Object.fromEntries(pot.shares.map((s) => [s.playerId, s.netCents]))).toEqual({ A: -625, B: 125, C: 500 });
    expect(sum(pot.shares)).toBe(0);
    expect(pot.provisional).toBe(false);
  });

  it("is provisional while any entrant has a hole to play, and nobody winning a hole gives every stake back", () => {
    expect(skinsPot(outcome, 1000, ["A", "B", "C"], 1).provisional).toBe(true);
    const allTied = playSkins(
      ["A", "B"].map((playerId) => ({ playerId, strokes: [4, 4, 4], courseHandicap: 0 })),
      3,
      { net: false },
    );
    const pot = skinsPot(allTied, 500, ["A", "B"], 0);
    expect(pot.shares.map((s) => s.netCents)).toEqual([0, 0]);
  });

  it("net skins take the handicap stroke on the hole of that stroke index", () => {
    // B receives one stroke (course handicap 1), on stroke index 1 — hole 2 here.
    // Hole 1: A 4, B 4 → tie. Hole 2: A 4, B 5 gross = 4 net → tie, so the two
    // carried skins and hole 3's go to A's 3 against B's 4: A takes 3.
    const net = playSkins(
      [
        { playerId: "A", strokes: [4, 4, 3], courseHandicap: 0 },
        { playerId: "B", strokes: [4, 5, 4], courseHandicap: 1 },
      ],
      3,
      { net: true, strokeIndex: [5, 1, 9, 2, 6, 3, 7, 4, 8] },
    );
    expect(net.holes.map((h) => [h.hole, h.playerId, h.value])).toEqual([
      [1, null, 1],
      [2, null, 2],
      [3, "A", 3],
    ]);
  });
});

describe("Nassau: front, back and the eighteen, each paid when it is decided", () => {
  const holes = (front: string, back: string): HoleResult[] =>
    Array.from({ length: 18 }, (_, i) => {
      const c = (i < 9 ? front[i] : back[i - 9]) ?? "";
      return c === "A" || c === "B" || c === "H" ? c : null;
    });
  const bet = (h: HoleResult[], sideA = ["a"], sideB = ["b"]) => ({ matchId: "m", sideA, sideB, holes: h, stakeCents: 500 });

  it("A takes the front 2 up, B the back 3 up and so the match 1 up: A is $5 down", () => {
    // Front: A wins 1 and 2, the rest halved — 2 up. Back: B wins 10, 11, 12 — 3 up.
    // Eighteen: A 2, B 3 — B 1 up. A: +5 −5 −5.
    const n = nassauNets(bet(holes("AAHHHHHHH", "BBBHHHHHH")));
    expect(netOf(n, "a")).toBe(-500);
    expect(netOf(n, "b")).toBe(500);
  });

  it("pays a finished front nine while the back is being played — and nothing for the back yet", () => {
    const h = holes("AAHHHHHHH", "BBB");
    const n = nassauNets(bet(h));
    expect(netOf(n, "a")).toBe(500);
    expect(nassauIsDecided(h)).toBe(false);
  });

  it("a match closed out 9&8 pays the front and the eighteen; the back is still live", () => {
    // A wins 1–8 and halves the 9th (the front closed out 5&4 on the 5th), then
    // wins the 10th: 9 up with 8 to play. The back nine is one hole old.
    const h = holes("AAAAAAAAH", "A");
    const n = nassauNets(bet(h));
    expect(netOf(n, "a")).toBe(1000);
    expect(nassauIsDecided(h)).toBe(false);
  });

  it("in a four-ball each player has the stake on it; uneven sides pay at the smaller side's rate", () => {
    const front = holes("AAHHHHHHH", "");
    const pairs = nassauNets(bet(front, ["a1", "a2"], ["b1", "b2"]));
    expect(pairs.map((n) => [n.playerId, n.netCents])).toEqual([
      ["a1", 500],
      ["a2", 500],
      ["b1", -500],
      ["b2", -500],
    ]);
    // Two against one: the one loser pays $5, so the two winners take $2.50 each.
    const short = nassauNets(bet(front, ["a1", "a2"], ["b1"]));
    expect(Object.fromEntries(short.map((n) => [n.playerId, n.netCents]))).toEqual({ a1: 250, a2: 250, b1: -500 });
    expect(sum(short)).toBe(0);
  });

  it("a halved segment pays nobody", () => {
    expect(nassauNets(bet(holes("HHHHHHHHH", "")))).toEqual([]);
  });
});

describe("the match itself: paid when it is over, never on a lead", () => {
  const card = (s: string): HoleResult[] => Array.from({ length: 18 }, (_, i) => (s[i] === "A" || s[i] === "B" || s[i] === "H" ? s[i] : null) as HoleResult);
  const bet = (holes: HoleResult[]) => ({ matchId: "m", sideA: ["a"], sideB: ["b"], holes, stakeCents: 1000 });

  it("3&2 is over with two holes unplayed, and pays the stake", () => {
    // A 3 up after the 16th: A wins 1, 2, 3, the next thirteen halved.
    const n = matchBetNets(bet(card("AAAHHHHHHHHHHHHH")));
    expect(n.map((x) => [x.playerId, x.netCents])).toEqual([
      ["a", 1000],
      ["b", -1000],
    ]);
  });

  it("a lead, a halved match and an untouched card pay nothing", () => {
    expect(matchBetNets(bet(card("AAAHHHHHH")))).toEqual([]);
    expect(matchBetNets(bet(card("HHHHHHHHHHHHHHHHHH")))).toEqual([]);
    expect(matchBetNets(bet(card("")))).toEqual([]);
    expect(matchBetNets(bet([]))).toEqual([]);
  });
});

describe("pots the cards settle: birdies, eagles, twos, low gross, low net", () => {
  const pars = [4, 4, 3, 5, 4, 4, 3, 4, 5];
  const card = (playerId: string, strokes: (number | null)[], strokesReceived = 0): PotCard => ({ playerId, strokes, strokesReceived });
  // P1: birdie on 1 (3 on a par 4), eagle on 4 (3 on a par 5). P2: birdie on 3 (2 on a par 3).
  // P3 and P4: pars all round.
  const cards = [
    card("p1", [3, 4, 3, 3, 4, 4, 3, 4, 5]),
    card("p2", [4, 4, 2, 5, 4, 4, 3, 4, 5]),
    card("p3", [...pars]),
    card("p4", [...pars]),
  ];
  const pot = (kind: (typeof DERIVED_KINDS)[number], c: PotCard[] = cards) =>
    derivedNets({ kind, buyInCents: 500, entrantIds: ["p1", "p2", "p3", "p4"], cards: c, pars });

  it("a birdie pot divides by every birdie or better: three shares of $20", () => {
    // p1 two (the eagle is one under or better), p2 one. $20 / 3 = $6.666…:
    // p1 $13.33, p2 $6.67 — the odd cent to the larger remainder.
    const n = pot("birdies");
    expect(Object.fromEntries(n.map((x) => [x.playerId, x.netCents]))).toEqual({ p1: 833, p2: 167, p3: -500, p4: -500 });
    expect(sum(n)).toBe(0);
  });

  it("an eagle pot counts two under or better: p1 alone takes it", () => {
    expect(Object.fromEntries(pot("eagles").map((x) => [x.playerId, x.netCents]))).toEqual({ p1: 1500, p2: -500, p3: -500, p4: -500 });
  });

  it("a twos pot counts a 2 on any hole: p2's on the 3rd", () => {
    expect(Object.fromEntries(pot("twos").map((x) => [x.playerId, x.netCents]))).toEqual({ p2: 1500, p1: -500, p3: -500, p4: -500 });
  });

  it("nobody made one: every stake goes back", () => {
    expect(pot("eagles", [card("p1", [...pars]), card("p2", [...pars])])).toEqual([]);
  });

  it("low gross: a tie splits it, and a card that is not finished cannot win", () => {
    const c = [
      card("p1", [4, 4, 3, 5, 4, 4, 3, 4, 5]), // 36
      card("p2", [4, 4, 3, 5, 4, 4, 3, 4, 5]), // 36
      card("p3", [5, 5, 4, 6, 5, 5, 4, 5, 6]), // 45
      card("p4", [3, 3, 2, null, null, null, null, null, null]), // 8, three holes
    ];
    const n = pot("low-gross", c);
    expect(Object.fromEntries(n.map((x) => [x.playerId, x.netCents]))).toEqual({ p1: 500, p2: 500, p3: -500, p4: -500 });
  });

  it("low net is the gross less the strokes received, rounded once", () => {
    // p3 45 − 10 = 35 beats p1 and p2 on 36 − 0.
    const c = [card("p1", [4, 4, 3, 5, 4, 4, 3, 4, 5]), card("p2", [4, 4, 3, 5, 4, 4, 3, 4, 5]), card("p3", [5, 5, 4, 6, 5, 5, 4, 5, 6], 10)];
    const n = derivedNets({ kind: "low-net", buyInCents: 500, entrantIds: ["p1", "p2", "p3"], cards: c, pars });
    expect(Object.fromEntries(n.map((x) => [x.playerId, x.netCents]))).toEqual({ p3: 1000, p1: -500, p2: -500 });
  });
});

describe("a contest, shared costs and the settle-up", () => {
  it("a closest-to-the-pin of five at $2 is $10 to the one named", () => {
    const n = contestNets({ id: "c", kind: "closest-pin", name: "", buyInCents: 200, entrantIds: ["a", "b", "c", "d", "e"], winnerIds: ["c"] });
    expect(netOf(n, "c")).toBe(800);
    expect(sum(n)).toBe(0);
  });

  it("$100.00 between three is 33.34, 33.33, 33.33 — and a refund of $10.01 is −3.34, −3.34, −3.33", () => {
    const three = [{ playerId: "a", weight: 1 }, { playerId: "b", weight: 1 }, { playerId: "c", weight: 1 }];
    expect([...shareOf({ id: "x", description: "", amountCents: 10000, paidBy: "a", shares: three }).values()]).toEqual([3334, 3333, 3333]);
    expect([...shareOf({ id: "y", description: "", amountCents: -1001, paidBy: "a", shares: three }).values()]).toEqual([-334, -334, -333]);
  });

  it("a double share is a weight of two: $90 between a double and two singles is $45, $22.50, $22.50", () => {
    const s = shareOf({ id: "x", description: "", amountCents: 9000, paidBy: "a", shares: [{ playerId: "a", weight: 2 }, { playerId: "b", weight: 1 }, { playerId: "c", weight: 1 }] });
    expect(Object.fromEntries(s)).toEqual({ a: 4500, b: 2250, c: 2250 });
  });

  it("whoever paid is owed by the rest, and the standing sums to nought", () => {
    // a pays a $90 dinner for three ($30 each): a is owed $60, b and c owe $30.
    const nets = balances([
      { id: "x", description: "", amountCents: 9000, paidBy: "a", shares: ["a", "b", "c"].map((playerId) => ({ playerId, weight: 1 })) },
    ]);
    expect(Object.fromEntries(nets.map((n) => [n.playerId, n.netCents]))).toEqual({ a: 6000, b: -3000, c: -3000 });
    expect(settle(nets)).toEqual([
      { fromPlayerId: "b", toPlayerId: "a", cents: 3000 },
      { fromPlayerId: "c", toPlayerId: "a", cents: 3000 },
    ]);
  });

  it("the settle-up hands the biggest debt to the biggest creditor first", () => {
    expect(
      settle([
        { playerId: "A", netCents: 500 },
        { playerId: "B", netCents: 125 },
        { playerId: "C", netCents: -625 },
      ]),
    ).toEqual([
      { fromPlayerId: "C", toPlayerId: "A", cents: 500 },
      { fromPlayerId: "C", toPlayerId: "B", cents: 125 },
    ]);
  });

  it("a pot is the stake times the people who put it in; a split is exact to the cent", () => {
    expect(potCents(500, 5)).toBe(2500);
    expect(potCents(-500, 5)).toBe(0);
    expect(potCents(500, 0)).toBe(0);
    expect(splitExactly(1000, [1, 1, 1])).toEqual([334, 333, 333]);
    expect(splitExactly(6000, [3, 2, 2])).toEqual([2572, 1714, 1714]);
  });
});

describe("when a game's amount may be reported — one table", () => {
  it("every game the app offers says when it pays, and why is its kind", () => {
    for (const kind of CARD_SIDE_GAMES) expect(paysWhen(kind), kind).not.toBeNull();
    for (const kind of DERIVED_KINDS) expect(paysWhen(kind), kind).toBe("when-the-round-is-final");
    expect(paysWhen("skins")).toBe("when-the-round-is-final");
    expect(paysWhen("nassau")).toBe("as-each-bet-is-decided");
    expect(paysWhen("match")).toBe("as-each-bet-is-decided");
    expect(paysWhen("contest")).toBe("when-a-winner-is-named");
    expect(paysWhen("press")).toBeNull();
    expect(Object.keys(SIDE_GAME_PAYS).sort()).toEqual([...DERIVED_KINDS, "contest", "match", "nassau", "skins"].sort());
  });

  it("a round's money is final when every hole is in, or the committee has closed it — never before", () => {
    expect(roundMoneyIsFinal({ holesReturned: 18, holeCount: 18, roundComplete: false })).toBe(true);
    expect(roundMoneyIsFinal({ holesReturned: 17, holeCount: 18, roundComplete: false })).toBe(false);
    expect(roundMoneyIsFinal({ holesReturned: 0, holeCount: 18, roundComplete: true })).toBe(true);
    expect(roundMoneyIsFinal({ holesReturned: 9, holeCount: 9, roundComplete: false })).toBe(true);
    expect(roundMoneyIsFinal({ holesReturned: 0, holeCount: 0, roundComplete: true })).toBe(false);
  });
});
