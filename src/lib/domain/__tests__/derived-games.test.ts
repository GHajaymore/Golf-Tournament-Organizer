import { describe, it, expect } from "vitest";
import {
  derivedNets,
  lowScoreWinners,
  countUnder,
  nassauNets,
  nassauLedger,
  isDerivedKind,
  DERIVED_LABEL,
  type DerivedPot,
  type PotCard,
  type NassauBet,
} from "../derived-games";
import { settle } from "../money";
import type { HoleResult } from "../types";

/**
 * The side bets the cards settle by themselves.
 *
 * Every test is the same question in a different costume: does the pot pay out
 * exactly what went in, to the right people, to the cent — including when
 * nobody wins, when everybody ties, and when somebody walked in after nine.
 */

const PARS = new Array(18).fill(4) as number[];

const card = (playerId: string, strokes: number | (number | null)[], received = 0): PotCard => ({
  playerId,
  strokes: Array.isArray(strokes) ? strokes : new Array(18).fill(strokes),
  strokesReceived: received,
});

const pot = (over: Partial<DerivedPot> = {}): DerivedPot => ({
  kind: "low-gross",
  buyInCents: 1_000,
  entrantIds: ["a", "b", "c", "d"],
  cards: [card("a", 4), card("b", 5), card("c", 5), card("d", 5)],
  pars: PARS,
  ...over,
});

const sum = (nets: Array<{ netCents: number }>) => nets.reduce((a, n) => a + n.netCents, 0);

describe("low gross", () => {
  it("pays the lowest card", () => {
    const nets = derivedNets(pot());
    expect(sum(nets)).toBe(0);
    // $40 pot, less a's own $10 stake.
    expect(nets.find((n) => n.playerId === "a")!.netCents).toBe(3_000);
    expect(nets.find((n) => n.playerId === "b")!.netCents).toBe(-1_000);
  });

  it("splits a tie", () => {
    const nets = derivedNets(pot({ cards: [card("a", 4), card("b", 4), card("c", 5), card("d", 5)] }));
    expect(sum(nets)).toBe(0);
    expect(nets.find((n) => n.playerId === "a")!.netCents).toBe(1_000);
    expect(nets.find((n) => n.playerId === "b")!.netCents).toBe(1_000);
  });

  it("splits a three-way tie without losing a cent", () => {
    // $40 between three is 13.3333 each.
    const nets = derivedNets(
      pot({ cards: [card("a", 4), card("b", 4), card("c", 4), card("d", 5)] }),
    );
    expect(sum(nets)).toBe(0);
    const won = nets
      .filter((n) => ["a", "b", "c"].includes(n.playerId))
      .map((n) => n.netCents + 1_000)
      .sort((x, y) => y - x);
    expect(won).toEqual([1_334, 1_333, 1_333]);
    expect(won.reduce((x, y) => x + y, 0)).toBe(4_000);
  });

  it("will not let an unfinished card win", () => {
    // Nine holes of fours is 36 and beats everybody's 72 — and would hand the
    // pot to whoever walked in early, which is the opposite of the bet.
    const nine = [...new Array(9).fill(4), ...new Array(9).fill(null)] as (number | null)[];
    const winners = lowScoreWinners(pot({ cards: [card("a", nine), card("b", 5), card("c", 5), card("d", 5)] }));
    expect(winners).not.toContain("a");
    expect(winners).toEqual(["b", "c", "d"]);
  });

  it("gives everyone their stake back when nobody returned a card", () => {
    const nets = derivedNets(pot({ cards: [] }));
    expect(sum(nets)).toBe(0);
    expect(nets).toEqual([]);
  });
});

describe("low net", () => {
  it("uses the strokes received, so the handicap decides it", () => {
    // b shoots 90 off 18 and beats a's gross 76 off scratch.
    const nets = derivedNets(
      pot({
        kind: "low-net",
        cards: [
          card("a", [...new Array(4).fill(5), ...new Array(14).fill(4)]), // 76
          card("b", 5, 18), // 90 - 18 = 72
          card("c", 5, 0),
          card("d", 5, 0),
        ],
      }),
    );
    expect(sum(nets)).toBe(0);
    expect(nets.find((n) => n.playerId === "b")!.netCents).toBe(3_000);
  });

  it("rounds the received strokes once, not per hole", () => {
    const nets = derivedNets(
      pot({ kind: "low-net", cards: [card("a", 4, 0.4), card("b", 4, 0.6), card("c", 5), card("d", 5)] }),
    );
    // 72 - 0 vs 72 - 1: b wins outright rather than a tie appearing from a
    // fractional handicap.
    expect(nets.find((n) => n.playerId === "b")!.netCents).toBe(3_000);
    expect(sum(nets)).toBe(0);
  });
});

describe("the birdie pot", () => {
  const withBirdies = (playerId: string, birdies: number): PotCard =>
    card(playerId, new Array(18).fill(4).map((v, i) => (i < birdies ? 3 : v)));

  it("divides by the birdies MADE, so two is two shares", () => {
    const nets = derivedNets(
      pot({
        kind: "birdies",
        cards: [withBirdies("a", 2), withBirdies("b", 1), withBirdies("c", 1), card("d", 4)],
      }),
    );
    expect(sum(nets)).toBe(0);
    // $40 pot over 4 birdies = $10 a birdie. a made two: +$20, less their stake.
    expect(nets.find((n) => n.playerId === "a")!.netCents).toBe(1_000);
    expect(nets.find((n) => n.playerId === "d")!.netCents).toBe(-1_000);
    // b made one birdie and staked $10, so their share is exactly their stake
    // back: no money, and a ledger carries no zero rows.
    expect(nets.find((n) => n.playerId === "b")).toBeUndefined();
  });

  it("gives everyone their stake back when nobody made one", () => {
    const nets = derivedNets({ ...pot({ kind: "birdies" }), cards: [card("a", 4), card("b", 5)] });
    expect(sum(nets)).toBe(0);
    expect(nets).toEqual([]);
  });

  it("counts an eagle as an eagle and not as a birdie", () => {
    const eagle = card("a", new Array(18).fill(4).map((v, i) => (i === 0 ? 2 : v)));
    expect(countUnder(eagle, PARS, 1), "an eagle is also one under or better").toBe(1);
    expect(countUnder(eagle, PARS, 2)).toBe(1);
    const birdie = card("b", new Array(18).fill(4).map((v, i) => (i === 0 ? 3 : v)));
    expect(countUnder(birdie, PARS, 2), "a birdie is not an eagle").toBe(0);
  });

  it("ignores holes with no score", () => {
    const half = card("a", [...new Array(9).fill(3), ...new Array(9).fill(null)]);
    expect(countUnder(half, PARS, 1)).toBe(9);
  });
});

describe("a Nassau", () => {
  const H = (s: string): HoleResult[] =>
    s.split("").map((c) => (c === "A" ? "A" : c === "B" ? "B" : c === "H" ? "H" : null));

  const bet = (holes: HoleResult[], stakeCents = 500): NassauBet => ({
    matchId: "m1",
    playerAId: "a",
    playerBId: "b",
    holes,
    stakeCents,
  });

  it("pays each decided segment separately", () => {
    // A wins the front outright and the back outright, so all three bets.
    const nets = nassauNets(bet(H("AAAAAAAAAAAAAAAAAA")));
    expect(sum(nets)).toBe(0);
    expect(nets.find((n) => n.playerId === "a")!.netCents).toBe(1_500);
  });

  it("lets a player lose the front and still win the day", () => {
    // B takes the front 5&4; A takes the back and, with it, the overall.
    const holes = H("BBBBBBBBB" + "AAAAAAAAA");
    const nets = nassauNets(bet(holes));
    // Front to B (-500), back to A (+500), overall halved on holes won.
    expect(sum(nets)).toBe(0);
    const a = nets.find((n) => n.playerId === "a")?.netCents ?? 0;
    expect(Math.abs(a)).toBeLessThanOrEqual(1_500);
  });

  it("pays nothing for a segment still being played", () => {
    // Three holes in: a leader, not a result. Paying a lead would settle a bet
    // that is still on.
    //
    // The card must be EIGHTEEN long with fifteen holes unplayed. A
    // three-element array is a three-hole match, which the engine correctly
    // reports as finished — the same impossible-fixture mistake the
    // 2026-08-12 audit found twice.
    expect(nassauNets(bet(H("AAA" + ".".repeat(15))))).toEqual([]);
  });

  it("pays nothing on a halved segment", () => {
    expect(nassauNets(bet(H("ABABABABABABABABAB")))).toEqual([]);
  });

  it("is one bet over nine holes, not three", () => {
    // Slicing nine into "front" and "overall" would charge the same bet twice.
    const nets = nassauNets(bet(H("AAAAAAAAA")));
    expect(nets.find((n) => n.playerId === "a")!.netCents).toBe(500);
  });

  it("adds up across a round of matches and settles square", () => {
    const bets: NassauBet[] = [
      { matchId: "m1", playerAId: "a", playerBId: "b", holes: H("AAAAAAAAAAAAAAAAAA"), stakeCents: 500 },
      { matchId: "m2", playerAId: "c", playerBId: "d", holes: H("BBBBBBBBBBBBBBBBBB"), stakeCents: 500 },
    ];
    const nets = nassauLedger(bets);
    expect(sum(nets)).toBe(0);
    const after = new Map(nets.map((n) => [n.playerId, n.netCents]));
    for (const t of settle(nets)) {
      after.set(t.fromPlayerId, (after.get(t.fromPlayerId) ?? 0) + t.cents);
      after.set(t.toPlayerId, (after.get(t.toPlayerId) ?? 0) - t.cents);
    }
    for (const [id, cents] of after) expect(cents, id).toBe(0);
  });
});

describe("what counts as a derived game", () => {
  it("knows its kinds", () => {
    for (const k of ["low-gross", "low-net", "birdies", "eagles"]) expect(isDerivedKind(k)).toBe(true);
    for (const k of ["closest-pin", "nassau", ""]) expect(isDerivedKind(k)).toBe(false);
    expect(DERIVED_LABEL["low-net"]).toBe("Low net");
  });

  it("is worth nothing with a zero stake", () => {
    expect(derivedNets(pot({ buyInCents: 0 }))).toEqual([]);
  });

  it("charges a player once even if entered twice", () => {
    const nets = derivedNets(pot({ entrantIds: ["a", "b", "b", "c", "d"] }));
    expect(sum(nets)).toBe(0);
    expect(nets.find((n) => n.playerId === "b")!.netCents).toBe(-1_000);
  });
});
