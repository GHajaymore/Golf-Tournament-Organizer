import { describe, it, expect } from "vitest";
import { CONTEST_LABEL, contestLedger, contestNets, isDecided, potOf, type Contest } from "../contests";
import {
  DERIVED_HELP,
  DERIVED_KINDS,
  DERIVED_LABEL,
  countUnder,
  derivedNets,
  lowScoreWinners,
  matchBetLedger,
  matchBetNets,
  nassauLedger,
  nassauNets,
  type DerivedPot,
  type PotCard,
} from "../derived-games";
import type { HoleResult } from "../types";

/**
 * Written from the mutation run for backlog item J49: the changes to
 * `contests.ts` and `derived-games.ts` that no test noticed. Every expectation
 * is worked by hand from the side game's own rule (each entrant puts in the
 * stake, the winners share what was put in to the cent, a bet between sides
 * is paid per player and sums to zero) and not read off the code.
 *
 * Names are invented single letters. TourneyHQ works the money out and writes
 * it down; it never moves it.
 */

const contest = (over: Partial<Contest> = {}): Contest => ({
  id: "c1",
  kind: "closest-pin",
  name: "",
  buyInCents: 100,
  entrantIds: ["a", "b"],
  winnerIds: ["a"],
  ...over,
});

describe("a contest, worked from the rule that everybody stakes and the winners share", () => {
  it("lists the winner first, then those who lost the same amount in id order", () => {
    // Four in at $1, b wins the $4: b is +300 and the other three are -100 each.
    // Listed biggest first, a dead heat by id, whatever order they entered in.
    const nets = contestNets(contest({ entrantIds: ["c", "b", "a", "d"], winnerIds: ["b"] }));
    expect(nets).toEqual([
      { playerId: "b", netCents: 300 },
      { playerId: "a", netCents: -100 },
      { playerId: "c", netCents: -100 },
      { playerId: "d", netCents: -100 },
    ]);
  });

  it("ignores a blank id among the entrants and among the winners", () => {
    // a, b in at $1 = $2 pot. Blanks are not people: no blank stakes, no blank wins.
    expect(contestNets(contest({ entrantIds: ["a", "", "b"], winnerIds: ["a", ""] }))).toEqual([
      { playerId: "a", netCents: 100 },
      { playerId: "b", netCents: -100 },
    ]);
  });

  it("a winner who is also an entrant and wins back exactly their stake is not listed", () => {
    // a and b both win a $2 pot of two $1 stakes: each is down 100 and up 100.
    expect(contestNets(contest({ winnerIds: ["a", "b"] }))).toEqual([]);
  });

  it("pays and charges nobody when there is no stake, no entrant or no winner", () => {
    expect(contestNets(contest({ buyInCents: 0 }))).toEqual([]);
    expect(contestNets(contest({ entrantIds: [] }))).toEqual([]);
    expect(contestNets(contest({ winnerIds: [] }))).toEqual([]);
    expect(contestNets(contest({ winnerIds: [""] }))).toEqual([]);
    expect(contestNets(contest({ entrantIds: [""] }))).toEqual([]);
  });

  it("a winner who never entered still wins, and the stakes still come out of the entrants", () => {
    expect(contestNets(contest({ entrantIds: ["a", "b"], winnerIds: ["z"] }))).toEqual([
      { playerId: "z", netCents: 200 },
      { playerId: "a", netCents: -100 },
      { playerId: "b", netCents: -100 },
    ]);
  });

  it("the ledger of several contests is listed biggest first, ties by id, with a player who came out level shown at nothing", () => {
    const ledger = contestLedger([
      contest({ id: "1", entrantIds: ["d", "c"], winnerIds: ["c"] }), // c +100, d -100
      contest({ id: "2", entrantIds: ["b", "a"], winnerIds: ["a"] }), // a +100, b -100
      contest({ id: "3", entrantIds: ["e", "f"], winnerIds: ["e"] }), // e +100, f -100
      contest({ id: "4", entrantIds: ["e", "f"], winnerIds: ["f"] }), // e -100, f +100: level over the two
    ]);
    expect(ledger).toEqual([
      { playerId: "a", netCents: 100 },
      { playerId: "c", netCents: 100 },
      { playerId: "e", netCents: 0 },
      { playerId: "f", netCents: 0 },
      { playerId: "b", netCents: -100 },
      { playerId: "d", netCents: -100 },
    ]);
    expect(ledger.reduce((t, n) => t + n.netCents, 0)).toBe(0);
  });

  it("the pot on the table counts each real entrant once", () => {
    expect(potOf(contest({ buyInCents: 250, entrantIds: ["a", "", "b", "a"] }))).toBe(500);
  });

  it("a contest whose only winner is blank is still open", () => {
    expect(isDecided(contest({ winnerIds: [""] }))).toBe(false);
    expect(isDecided(contest({ winnerIds: ["", "a"] }))).toBe(true);
    expect(isDecided(contest({ winnerIds: [] }))).toBe(false);
  });

  it("calls the general kind a side game", () => {
    expect(CONTEST_LABEL.other).toBe("Side game");
  });
});

/* ── derived pots ──────────────────────────────────────────────────────── */

const PARS = new Array(18).fill(4) as number[];
const card = (playerId: string, strokes: (number | null)[] | number, received = 0): PotCard => ({
  playerId,
  strokes: Array.isArray(strokes) ? strokes : new Array(18).fill(strokes),
  strokesReceived: received,
});
const pot = (over: Partial<DerivedPot> = {}): DerivedPot => ({
  kind: "low-gross",
  buyInCents: 100,
  entrantIds: ["a", "b"],
  cards: [card("a", 4), card("b", 5)],
  pars: PARS,
  ...over,
});
/** 18 holes of 4 with the given holes replaced. */
const fours = (replace: Record<number, number | null>): (number | null)[] =>
  PARS.map((p, i) => (i in replace ? replace[i] : p));

describe("who has the lowest score, by the rule that only a finished card can win", () => {
  it("a hole with a 0, a blank or a minus on it was not played, so that card is a hole short and cannot win", () => {
    // b has 17 fours and one unplayed hole: 17 holes returned, not 18, so it cannot beat a's 72.
    // (Counted as played it would be 68 and win by walking off.)
    expect(lowScoreWinners(pot({ cards: [card("a", 4), card("b", fours({ 17: 0 }))] }))).toEqual(["a"]);
    expect(lowScoreWinners(pot({ cards: [card("a", 4), card("b", fours({ 17: null }))] }))).toEqual(["a"]);
    expect(lowScoreWinners(pot({ cards: [card("a", 4), card("b", fours({ 17: -1 }))] }))).toEqual(["a"]);
  });

  it("a hole that is missing altogether (not even a null) was not played", () => {
    const short = fours({});
    (short as unknown[])[17] = undefined;
    expect(lowScoreWinners(pot({ cards: [card("a", 4), card("b", short)] }))).toEqual(["a"]);
  });

  it("a card from somebody who is not in the pot cannot win it", () => {
    expect(
      lowScoreWinners(pot({ entrantIds: ["a", "b"], cards: [card("a", 5), card("b", 6), card("z", 3)] })),
    ).toEqual(["a"]);
  });

  it("low gross takes no notice of handicap strokes, low net does", () => {
    // b is 88 gross (four holes of 8, fourteen of 4) with 20 strokes: 68 net. a is 72 either way.
    const cards = [card("a", 4), card("b", fours({ 0: 8, 1: 8, 2: 8, 3: 8 }), 20)];
    expect(lowScoreWinners(pot({ kind: "low-gross", cards }))).toEqual(["a"]);
    expect(lowScoreWinners(pot({ kind: "low-net", cards }))).toEqual(["b"]);
  });

  it("nobody has returned a hole: nobody wins, and no money moves", () => {
    const empty = new Array(18).fill(null) as null[];
    const p = pot({ cards: [card("a", empty), card("b", empty)] });
    expect(lowScoreWinners(p)).toEqual([]);
    // Everyone is refunded their own stake: nobody is up or down, so nobody is listed.
    expect(derivedNets(p)).toEqual([]);
  });

  it("names a tie in id order, whatever order the pot lists them in", () => {
    const p = pot({
      entrantIds: ["z", "m", "a", "q"],
      cards: [card("z", 4), card("m", 4), card("a", 4), card("q", 5)],
    });
    expect(lowScoreWinners(p)).toEqual(["a", "m", "z"]);
  });
});

describe("a derived pot, worked from the rule that the pot goes back out in full", () => {
  it("ignores a blank entrant id", () => {
    // a, b in at $1 and a wins on gross: +100/-100. A blank would make it three in.
    expect(derivedNets(pot({ entrantIds: ["a", "", "b"] }))).toEqual([
      { playerId: "a", netCents: 100 },
      { playerId: "b", netCents: -100 },
    ]);
  });

  it("charges nothing for a free pot or an empty one", () => {
    expect(derivedNets(pot({ buyInCents: 0 }))).toEqual([]);
    expect(derivedNets(pot({ entrantIds: [] }))).toEqual([]);
  });

  it("lists the winner first, then the others in id order", () => {
    // d c b a enter at $1; c has the low card. $4 pot: c +300, the rest -100.
    const p = pot({
      entrantIds: ["d", "c", "b", "a"],
      cards: [card("d", 5), card("c", 4), card("b", 5), card("a", 5)],
    });
    expect(derivedNets(p)).toEqual([
      { playerId: "c", netCents: 300 },
      { playerId: "a", netCents: -100 },
      { playerId: "b", netCents: -100 },
      { playerId: "d", netCents: -100 },
    ]);
  });

  it("a birdie pot with no birdie made refunds each entrant", () => {
    expect(derivedNets(pot({ kind: "birdies", cards: [card("a", 4), card("b", 5)] }))).toEqual([]);
  });

  it("a hole with no par on the sheet is never a birdie", () => {
    expect(countUnder(card("a", fours({ 17: 3 })), PARS.slice(0, 17), 1)).toBe(0);
  });

  it("birdies count only holes that were played: a 0, a minus or a blank is no birdie", () => {
    expect(countUnder(card("a", fours({ 3: 0, 5: null, 7: -1 })), PARS, 1)).toBe(0);
    const gap = fours({ 3: 3 });
    (gap as unknown[])[5] = undefined;
    expect(countUnder(card("a", gap), PARS, 1)).toBe(1);
    // A real birdie and a real eagle are what they are.
    expect(countUnder(card("a", fours({ 1: 3, 2: 2 })), PARS, 1)).toBe(2);
    expect(countUnder(card("a", fours({ 1: 3, 2: 2 })), PARS, 2)).toBe(1);
  });

  it("a birdie pot divides by birdies made: three birdies to one is 3/4 of the pot", () => {
    // $2 each from two = $4. a made three birdies, b one: shares 300 / 100.
    const p = pot({
      kind: "birdies",
      buyInCents: 200,
      cards: [card("a", fours({ 0: 3, 1: 3, 2: 3 })), card("b", fours({ 3: 3 }))],
    });
    expect(derivedNets(p)).toEqual([
      { playerId: "a", netCents: 100 },
      { playerId: "b", netCents: -100 },
    ]);
  });
});

/* ── bets between sides ────────────────────────────────────────────────── */

const run = (s: string): HoleResult[] => s.split("").map((c) => (c === "." ? null : (c as "A" | "B" | "H")));
const ALL_A = "A".repeat(18);
const ALL_B = "B".repeat(18);

describe("the match bet, worked as each player against their opposite number", () => {
  const bet = (over: Partial<Parameters<typeof matchBetNets>[0]> = {}) => ({
    matchId: "m",
    sideA: ["a"],
    sideB: ["b"],
    holes: run(ALL_A),
    stakeCents: 1000,
    ...over,
  });

  it("pays nobody on no stake or a side with nobody on it", () => {
    expect(matchBetNets(bet({ stakeCents: 0 }))).toEqual([]);
    expect(matchBetNets(bet({ sideA: [] }))).toEqual([]);
    expect(matchBetNets(bet({ sideB: [] }))).toEqual([]);
    expect(matchBetNets(bet({ sideA: [""] }))).toEqual([]);
    expect(matchBetNets(bet({ sideB: [""] }))).toEqual([]);
  });

  it("a blank in a side is not a player", () => {
    // a v b, with a blank beside one of them: still one against one.
    expect(matchBetNets(bet({ sideA: ["a", ""] }))).toEqual([
      { playerId: "a", netCents: 1000 },
      { playerId: "b", netCents: -1000 },
    ]);
    expect(matchBetNets(bet({ sideB: ["", "b"] }))).toEqual([
      { playerId: "a", netCents: 1000 },
      { playerId: "b", netCents: -1000 },
    ]);
  });

  it("a match still in play pays nothing, a halved one pays nothing, and neither does an empty card", () => {
    // A leads by three with six holes unplayed: ahead, not over.
    expect(matchBetNets(bet({ holes: run("AAA" + ".".repeat(15)) }))).toEqual([]);
    expect(matchBetNets(bet({ holes: run("H".repeat(18)) }))).toEqual([]);
    expect(matchBetNets(bet({ holes: [] }))).toEqual([]);
  });

  it("uneven sides are paid at the smaller side's rate and still sum to zero", () => {
    // Two against one for $10 a head. The pair win: each takes half a stake off the one.
    const aWins = matchBetNets(bet({ sideA: ["a1", "a2"], sideB: ["b"], holes: run(ALL_A) }));
    expect(aWins).toEqual([
      { playerId: "a1", netCents: 500 },
      { playerId: "a2", netCents: 500 },
      { playerId: "b", netCents: -1000 },
    ]);
    // The one wins: takes a stake from the pair, who are each down half a stake.
    const bWins = matchBetNets(bet({ sideA: ["a1", "a2"], sideB: ["b"], holes: run(ALL_B) }));
    expect(bWins).toEqual([
      { playerId: "b", netCents: 1000 },
      { playerId: "a1", netCents: -500 },
      { playerId: "a2", netCents: -500 },
    ]);
  });

  it("lists the winners first, then the losers, each in id order", () => {
    const nets = matchBetNets(bet({ sideA: ["c", "a"], sideB: ["d", "b"], stakeCents: 100 }));
    expect(nets.map((n) => n.playerId)).toEqual(["a", "c", "b", "d"]);
  });

  it("the ledger of several match bets nets each player and lists biggest first, ties by id", () => {
    const ledger = matchBetLedger([
      bet({ matchId: "m1", sideA: ["c"], sideB: ["d"], stakeCents: 100 }),
      bet({ matchId: "m2", sideA: ["a"], sideB: ["b"], stakeCents: 100 }),
    ]);
    expect(ledger).toEqual([
      { playerId: "a", netCents: 100 },
      { playerId: "c", netCents: 100 },
      { playerId: "b", netCents: -100 },
      { playerId: "d", netCents: -100 },
    ]);
  });
});

describe("the Nassau, worked as three bets on one card", () => {
  const nassau = (over: Partial<Parameters<typeof nassauNets>[0]> = {}) => ({
    matchId: "n",
    sideA: ["a"],
    sideB: ["b"],
    holes: run(ALL_A),
    stakeCents: 100,
    ...over,
  });

  it("charges nothing on no stake or a side with nobody on it, and ignores a blank id", () => {
    expect(nassauNets(nassau({ stakeCents: 0 }))).toEqual([]);
    expect(nassauNets(nassau({ sideA: [] }))).toEqual([]);
    expect(nassauNets(nassau({ sideB: [] }))).toEqual([]);
    expect(nassauNets(nassau({ sideA: [""] }))).toEqual([]);
    expect(nassauNets(nassau({ sideB: [""] }))).toEqual([]);
    // Winning all three, with a blank beside each: still one against one, three stakes.
    expect(nassauNets(nassau({ sideA: ["a", ""], sideB: ["", "b"] }))).toEqual([
      { playerId: "a", netCents: 300 },
      { playerId: "b", netCents: -300 },
    ]);
  });

  it("a player who wins the front and loses the back is level and is not listed", () => {
    // A takes the front nine, B the back nine, and the eighteen is halved nine holes each.
    expect(nassauNets(nassau({ holes: run("A".repeat(9) + "B".repeat(9)) }))).toEqual([]);
  });

  it("uneven sides pay at the smaller side's rate on each segment", () => {
    // Two against one, $1 a segment, the pair win all three: each of the pair +50 a segment, the one -100.
    expect(nassauNets(nassau({ sideA: ["a1", "a2"], sideB: ["b"] }))).toEqual([
      { playerId: "a1", netCents: 150 },
      { playerId: "a2", netCents: 150 },
      { playerId: "b", netCents: -300 },
    ]);
    // The one wins all three: +100 a segment, each of the pair -50.
    expect(nassauNets(nassau({ sideA: ["a1", "a2"], sideB: ["b"], holes: run(ALL_B) }))).toEqual([
      { playerId: "b", netCents: 300 },
      { playerId: "a1", netCents: -150 },
      { playerId: "a2", netCents: -150 },
    ]);
  });

  it("lists the winners first, then the losers, each in id order", () => {
    const nets = nassauNets(nassau({ sideA: ["c", "a"], sideB: ["d", "b"] }));
    expect(nets.map((n) => n.playerId)).toEqual(["a", "c", "b", "d"]);
  });

  it("the ledger nets each player across bets, drops those level, and lists biggest first", () => {
    // a beats b three times over; then b beats a three times over: both back to nothing.
    expect(nassauLedger([nassau({ matchId: "n1" }), nassau({ matchId: "n2", holes: run(ALL_B) })])).toEqual([]);
    const ledger = nassauLedger([
      nassau({ matchId: "n1", sideA: ["c"], sideB: ["d"] }),
      nassau({ matchId: "n2", sideA: ["a"], sideB: ["b"] }),
    ]);
    expect(ledger).toEqual([
      { playerId: "a", netCents: 300 },
      { playerId: "c", netCents: 300 },
      { playerId: "b", netCents: -300 },
      { playerId: "d", netCents: -300 },
    ]);
  });
});

describe("what the screens call each derived pot", () => {
  it("names every kind, and says in a sentence how it is won", () => {
    expect(DERIVED_LABEL).toEqual({
      "low-gross": "Low gross",
      "low-net": "Low net",
      birdies: "Birdie pot",
      eagles: "Eagle pot",
      twos: "Twos pot",
    });
    for (const k of DERIVED_KINDS) expect(DERIVED_HELP[k].length).toBeGreaterThan(20);
    expect(DERIVED_HELP["low-gross"]).toMatch(/gross/i);
    expect(DERIVED_HELP["low-net"]).toMatch(/net/i);
    expect(DERIVED_HELP.birdies).toMatch(/birdie/i);
    expect(DERIVED_HELP.eagles).toMatch(/eagle/i);
    expect(DERIVED_HELP.twos).toMatch(/\b2\b/);
  });
});
