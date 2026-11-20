import { describe, it, expect } from "vitest";
import {
  aggregateStats,
  computeStandings,
  cutLineShape,
  cutLineTies,
  decidedOutcome,
  groupCutoff,
  qualificationBubble,
  rankPlayers,
  strokeIndexOfMatch,
  type MatchTiebreak,
  type RankedPlayer,
} from "@/lib/domain/standings";
import { DEFAULT_SCORING } from "@/lib/domain/types";
import type { HoleResult, Match, Player, PlayerStats, ScoringRules, TiebreakerKey } from "@/lib/domain/types";

/**
 * J49: the mutants in `domain/standings.ts` that no test noticed (Stryker, narrowed to
 * the unit tests that import it). Every expectation here is worked by hand from the
 * rule it states, with invented players; nothing is read off the code's own output.
 *
 * Cards are four holes written as a string: A / B = the hole won by that side,
 * H = halved, - = not played. Rule 3.2a(3): a match ends when one side leads by
 * more holes than remain, and the holes after that do not count. Rule 3.2a(1):
 * a hole is won by the side that holes in fewer strokes, a halved hole counts for nobody.
 */

const holesOf = (card: string): HoleResult[] => [...card].map((c) => (c === "-" ? null : (c as HoleResult)));

const player = (id: string, seed: number, handicap = 10): Player => ({ id, name: id.toUpperCase(), handicap, seed });

let n = 0;
const match = (a: string, b: string, card: string, extra: Partial<Match> = {}): Match => ({
  id: `m${++n}`,
  stageId: "s",
  groupId: "g",
  round: 1,
  playerAId: a,
  playerBId: b,
  holes: holesOf(card),
  ...extra,
});

/** Win 5, halve 2, lose 1, half a point a hole, 10 for turning up, 4 a match played: every figure distinct. */
const S: ScoringRules = {
  winPts: 5,
  tiePts: 2,
  lossPts: 1,
  holeRatioPts: 0.5,
  bonusPts: 10,
  playPts: 4,
  maxPerMatch: 0,
  tiebreakers: [],
};

/** Standings in which everybody finishes level on points, whatever they did, so only the tiebreaker chain can separate. */
function levelled(
  players: Player[],
  matches: Match[],
  chain: TiebreakerKey[],
  holeDifficulty?: Parameters<typeof computeStandings>[4],
  matchTiebreakers: Parameters<typeof computeStandings>[5] = [],
): RankedPlayer[] {
  const scoring = { ...DEFAULT_SCORING, tiebreakers: chain };
  const stats = aggregateStats(players, matches, scoring);
  const carried = Object.fromEntries(players.map((p) => [p.id, 100 - stats.get(p.id)!.points]));
  return computeStandings(players, matches, scoring, carried, holeDifficulty, matchTiebreakers);
}
const ids = (r: RankedPlayer[]) => r.map((x) => x.player.id);
const ranks = (r: RankedPlayer[]) => r.map((x) => x.rank);

describe("strokeIndexOfMatch", () => {
  const m = match("a", "b", "AAAA");
  it("is an empty card when there is none, not undefined", () => {
    expect(strokeIndexOfMatch(undefined, m)).toEqual([]);
  });
  it("returns an array card as it is, and asks a function for the match's own card", () => {
    expect(strokeIndexOfMatch([4, 3, 2, 1], m)).toEqual([4, 3, 2, 1]);
    expect(strokeIndexOfMatch((x) => (x.id === m.id ? [9, 8] : []), m)).toEqual([9, 8]);
  });
});

describe("aggregateStats: the record and the points, worked by hand", () => {
  it("a won match: 2&1 to A", () => {
    // AAH-: A,A then a halve; after the third hole A leads 2 with 1 to play (2 > 1): over, 2&1.
    // A: 2 holes won, 0 lost. Points 5 (win) + 2*0.5 = 6, +10 bonus, +4 for the match played = 20.
    // B: 0 won, 2 lost. 1 (loss) + 0 = 1, +10, +4 = 15. C has not played: the bonus only.
    const st = aggregateStats([player("a", 1), player("b", 2), player("c", 3)], [match("a", "b", "AAH-")], S, { a: 3 });
    expect(st.get("a")).toEqual({
      playerId: "a", played: 1, playedForPoints: 1, wins: 1, losses: 0, ties: 0, holesWon: 2, holesLost: 0, points: 20, totalPoints: 23,
    });
    expect(st.get("b")).toEqual({
      playerId: "b", played: 1, playedForPoints: 1, wins: 0, losses: 1, ties: 0, holesWon: 0, holesLost: 2, points: 15, totalPoints: 15,
    });
    expect(st.get("c")).toMatchObject({ played: 0, wins: 0, points: 10, totalPoints: 10 });
  });

  it("the other way about: B wins, so the win points and the loss points go to the right sides", () => {
    const st = aggregateStats([player("a", 1), player("b", 2)], [match("a", "b", "BBH-")], S);
    expect(st.get("b")).toMatchObject({ wins: 1, losses: 0, holesWon: 2, points: 20 });
    expect(st.get("a")).toMatchObject({ wins: 0, losses: 1, holesLost: 2, points: 15 });
  });

  it("a cap on points from one match bites on the big score and leaves the small one alone", () => {
    // Raw: A 5 + 1 = 6, B 1. A cap of 4 -> A 4, B 1 (the lesser of raw and cap). Bonus and play points sit outside it.
    const capped = aggregateStats([player("a", 1), player("b", 2)], [match("a", "b", "AAH-")], { ...S, maxPerMatch: 4 });
    expect(capped.get("a")!.points).toBe(4 + 10 + 4);
    expect(capped.get("b")!.points).toBe(1 + 10 + 4);
    // A cap above the score changes nothing; a negative one is no cap.
    const high = aggregateStats([player("a", 1), player("b", 2)], [match("a", "b", "AAH-")], { ...S, maxPerMatch: 100 });
    expect(high.get("a")!.points).toBe(20);
    const negative = aggregateStats([player("a", 1), player("b", 2)], [match("a", "b", "AAH-")], { ...S, maxPerMatch: -3 });
    expect(negative.get("a")!.points).toBe(20);
  });

  it("a cap is applied to each match, not to the total", () => {
    // Two matches of 6 each against different opponents, cap 4: 8, not 4 and not 12.
    const st = aggregateStats(
      [player("a", 1), player("b", 2), player("c", 3)],
      [match("a", "b", "AAH-"), match("a", "c", "AAH-")],
      { ...S, maxPerMatch: 4, bonusPts: 0, playPts: 0 },
    );
    expect(st.get("a")!.points).toBe(8);
  });

  it("a match still being played pays its holes and nothing for an outcome, and no appearance point", () => {
    // AA--: two holes in, two to go: nothing is decided. A has 2 holes (1 point), B none. No match played yet.
    const st = aggregateStats([player("a", 1), player("b", 2)], [match("a", "b", "AA--")], S);
    expect(st.get("a")).toMatchObject({ played: 0, playedForPoints: 0, wins: 0, holesWon: 2, holesLost: 0, points: 1 + 10 });
    expect(st.get("b")).toMatchObject({ played: 0, losses: 0, holesWon: 0, holesLost: 2, points: 0 + 10 });
  });

  it("a live match is paid to the one player who is on the list, whichever side they are", () => {
    const onlyA = aggregateStats([player("a", 1)], [match("a", "ghost", "AA--")], S);
    expect(onlyA.get("a")).toMatchObject({ holesWon: 2, points: 11 });
    const onlyB = aggregateStats([player("b", 1)], [match("ghost", "b", "BA--")], S);
    // B won hole 1, lost hole 2: one hole each, half a point.
    expect(onlyB.get("b")).toMatchObject({ holesWon: 1, holesLost: 1, points: 0.5 + 10 });
  });

  it("a finished match is read for the one player on the list, and a match with nobody on the list changes nothing", () => {
    const a = aggregateStats([player("a", 1)], [match("a", "ghost", "AAH-")], S);
    expect(a.get("a")).toMatchObject({ played: 1, playedForPoints: 1, wins: 1, losses: 0, ties: 0, holesWon: 2, points: 20 });
    const b = aggregateStats([player("b", 1)], [match("ghost", "b", "AAH-")], S);
    expect(b.get("b")).toMatchObject({ played: 1, wins: 0, losses: 1, holesLost: 2, points: 15 });
    const nobody = aggregateStats([player("c", 1)], [match("x", "y", "AAH-")], S);
    expect(nobody.get("c")).toMatchObject({ played: 0, holesWon: 0, points: 10 });
    expect([...nobody.keys()]).toEqual(["c"]);
    // A halved match, one player listed, either side.
    const tieA = aggregateStats([player("a", 1)], [match("a", "ghost", "HHHH")], S);
    expect(tieA.get("a")).toMatchObject({ ties: 1, wins: 0, losses: 0, points: 2 + 10 + 4 });
    const tieB = aggregateStats([player("b", 1)], [match("ghost", "b", "HHHH")], S);
    expect(tieB.get("b")).toMatchObject({ ties: 1, wins: 0, losses: 0, points: 2 + 10 + 4 });
    // A match the listed player LOST, from each side.
    const lossA = aggregateStats([player("a", 1)], [match("a", "ghost", "BBH-")], S);
    expect(lossA.get("a")).toMatchObject({ losses: 1, wins: 0 });
    const winB = aggregateStats([player("b", 1)], [match("ghost", "b", "BBH-")], S);
    expect(winB.get("b")).toMatchObject({ wins: 1, losses: 0 });
  });

  it("a forfeit is decided by the forfeit, whichever of the two is on the list", () => {
    // Rule 3.2b(1): a concession ends the match. The opponent takes the win and the win points, the conceder the loss
    // points; no holes, and only the one who turned up is paid the appearance point.
    const both = aggregateStats([player("a", 1), player("b", 2)], [match("a", "b", "AAAA", { forfeitedBy: "a" })], S);
    expect(both.get("b")).toMatchObject({ played: 1, playedForPoints: 1, wins: 1, holesWon: 0, points: 5 + 10 + 4 });
    expect(both.get("a")).toMatchObject({ played: 1, playedForPoints: 0, losses: 1, holesLost: 0, points: 1 + 10 });
    const other = aggregateStats([player("a", 1), player("b", 2)], [match("a", "b", "BBBB", { forfeitedBy: "b" })], S);
    expect(other.get("a")).toMatchObject({ wins: 1, points: 19 });
    expect(other.get("b")).toMatchObject({ losses: 1, points: 11 });
    // Only the winner listed.
    const onlyWinner = aggregateStats([player("b", 2)], [match("a", "b", "AAAA", { forfeitedBy: "a" })], S);
    expect(onlyWinner.get("b")).toMatchObject({ wins: 1, losses: 0, points: 19 });
    const onlyWinnerA = aggregateStats([player("a", 2)], [match("a", "b", "BBBB", { forfeitedBy: "b" })], S);
    expect(onlyWinnerA.get("a")).toMatchObject({ wins: 1, losses: 0, points: 19 });
    // Only the conceder listed.
    const onlyLoser = aggregateStats([player("a", 1)], [match("a", "b", "AAAA", { forfeitedBy: "a" })], S);
    expect(onlyLoser.get("a")).toMatchObject({ played: 1, wins: 0, losses: 1, playedForPoints: 0, points: 11 });
    const onlyLoserB = aggregateStats([player("b", 1)], [match("a", "b", "BBBB", { forfeitedBy: "b" })], S);
    expect(onlyLoserB.get("b")).toMatchObject({ played: 1, wins: 0, losses: 1, points: 11 });
  });
});

describe("aggregateStats: an all-square match put through the countback", () => {
  // AHHB: A won hole 1, B won hole 4, the rest halved. All square after four holes: Rule 3.2a(4), a halved match.
  const AHHB = "AHHB";
  const players = [player("a", 1), player("b", 2)];

  it("with no countback it stays halved: a tie each, and the hole each", () => {
    for (const mt of [undefined, { sequence: [], strokeIndex: [] }] as Array<MatchTiebreak | undefined>) {
      const st = aggregateStats(players, [match("a", "b", AHHB)], S, {}, mt);
      expect(st.get("a")).toMatchObject({ ties: 1, wins: 0, losses: 0, points: 2 + 0.5 + 10 + 4 });
      expect(st.get("b")).toMatchObject({ ties: 1, wins: 0, losses: 0, points: 2 + 0.5 + 10 + 4 });
    }
  });

  it("the last hole decides it for B: B wins, A loses, and the points follow the countback", () => {
    const st = aggregateStats(players, [match("a", "b", AHHB)], S, {}, { sequence: ["last-1"], strokeIndex: [] });
    expect(st.get("b")).toMatchObject({ wins: 1, ties: 0, losses: 0, points: 5 + 0.5 + 10 + 4 });
    expect(st.get("a")).toMatchObject({ wins: 0, ties: 0, losses: 1, points: 1 + 0.5 + 10 + 4 });
  });

  it("the hardest hole decides it the other way when the card says hole 1 is the hardest", () => {
    // Stroke index 1 = hardest. [1,2,3,4]: hole 1 is hardest and A won it. [4,3,2,1]: hole 4, which B won.
    const hard1 = aggregateStats(players, [match("a", "b", AHHB)], S, {}, { sequence: ["toughest-1"], strokeIndex: [1, 2, 3, 4] });
    expect(hard1.get("a")).toMatchObject({ wins: 1, losses: 0 });
    const hard4 = aggregateStats(players, [match("a", "b", AHHB)], S, {}, { sequence: ["toughest-1"], strokeIndex: [4, 3, 2, 1] });
    expect(hard4.get("b")).toMatchObject({ wins: 1, losses: 0 });
  });

  it("each match is decided on its OWN card when the card is a function of the match", () => {
    const [a, b, c, d] = ["a", "b", "c", "d"].map((x, i) => player(x, i + 1));
    const m1 = match("a", "b", AHHB);
    const m2 = match("c", "d", AHHB);
    const card = (m: Match) => (m.id === m1.id ? [1, 2, 3, 4] : [4, 3, 2, 1]);
    const st = aggregateStats([a, b, c, d], [m1, m2], S, {}, { sequence: ["toughest-1"], strokeIndex: card });
    expect(st.get("a")).toMatchObject({ wins: 1 }); // away card: hole 1 hardest, A's
    expect(st.get("d")).toMatchObject({ wins: 1 }); // home card: hole 4 hardest, B's
  });

  it("a countback that cannot separate them leaves it halved", () => {
    // No stroke index on the card: the toughest-1 step is skipped, nothing else in the sequence.
    const st = aggregateStats(players, [match("a", "b", AHHB)], S, {}, { sequence: ["toughest-1"], strokeIndex: [] });
    expect(st.get("a")).toMatchObject({ ties: 1, wins: 0 });
  });

  it("a countback is for a halved match only: a match somebody won stays won", () => {
    // AAAB: A is 3 up with 1 to play, over. Last hole is B's; a countback on last-1 must not hand it to B.
    const st = aggregateStats(players, [match("a", "b", "AAAB")], S, {}, { sequence: ["last-1"], strokeIndex: [] });
    expect(st.get("a")).toMatchObject({ wins: 1, losses: 0 });
    expect(st.get("b")).toMatchObject({ wins: 0, losses: 1 });
  });
});

describe("decidedOutcome", () => {
  it("a forfeit names the other side; a forfeit naming nobody in the match is read off the card", () => {
    expect(decidedOutcome(match("a", "b", "BBBB", { forfeitedBy: "a" }))).toBe("B");
    expect(decidedOutcome(match("a", "b", "AAAA", { forfeitedBy: "b" }))).toBe("A");
    expect(decidedOutcome(match("a", "b", "AAAA", { forfeitedBy: "team-9" }))).toBe("A");
    expect(decidedOutcome(match("a", "b", "BBBB", { forfeitedBy: "" }))).toBe("B");
  });
  it("a match not yet over has no outcome (null), which is not the same as level (H)", () => {
    expect(decidedOutcome(match("a", "b", "A---"))).toBeNull();
    expect(decidedOutcome(match("a", "b", "AHHH"))).toBe("A");
    expect(decidedOutcome(match("a", "b", "HHHH"))).toBe("H");
    expect(decidedOutcome(match("a", "b", "BBH-"))).toBe("B");
  });
  it("a halved match is put through the countback, and stays H when it cannot be separated", () => {
    const m = match("a", "b", "AHHB");
    expect(decidedOutcome(m, { sequence: ["last-1"], strokeIndex: [] })).toBe("B");
    expect(decidedOutcome(m, { sequence: ["toughest-1"], strokeIndex: [1, 2, 3, 4] })).toBe("A");
    expect(decidedOutcome(m, { sequence: ["toughest-1"], strokeIndex: () => [4, 3, 2, 1] })).toBe("B");
    expect(decidedOutcome(m, { sequence: ["toughest-1"], strokeIndex: [] })).toBe("H");
    expect(decidedOutcome(m, { sequence: [], strokeIndex: [] })).toBe("H");
    expect(decidedOutcome(m)).toBe("H");
  });
});

describe("the tiebreaker chain, one step at a time (players level on points)", () => {
  // Seeds are given AGAINST the expected order every time, so the seed fallback cannot give the right answer by luck.

  it("most-wins: the player with a win is above the one with none", () => {
    const p1 = player("p1", 2);
    const p2 = player("p2", 1);
    const r = levelled([p1, p2], [match("p1", "g", "AAAA")], ["most-wins"]);
    expect(ids(r)).toEqual(["p1", "p2"]);
    expect(ranks(r)).toEqual([1, 2]);
  });

  it("win-percentage is wins over matches played, and a player with none played scores 0 and is last", () => {
    // p1: 1 win from 1 = 100%. p2: 2 wins from 4 = 50%. p3: nothing played = 0%.
    const p = [player("p1", 3), player("p2", 2), player("p3", 1)];
    const ms = [
      match("p1", "g", "AAAA"),
      match("p2", "g1", "AAAA"), match("p2", "g2", "AAAA"), match("p2", "g3", "BBBB"), match("p2", "g4", "BBBB"),
    ];
    const pct = levelled(p, ms, ["win-percentage"]);
    expect(ids(pct)).toEqual(["p1", "p2", "p3"]);
    expect(ranks(pct)).toEqual([1, 2, 3]);
    // The same players on most-wins: the two wins of p2 beat the one of p1, so the answer differs.
    expect(ids(levelled(p, ms, ["most-wins"]))).toEqual(["p2", "p1", "p3"]);
  });

  it("holes-won-ratio is holes won less holes lost; fewest-holes-lost is the holes lost alone", () => {
    // p1: AHHH, 1 up: won 1, lost 0 (+1). p2: ABAA, 3&0... A2 B1 after 3, then A: won 3, lost 1 (+2).
    const ms = [match("p1", "g1", "AHHH"), match("p2", "g2", "ABAA")];
    const ratio = levelled([player("p1", 1), player("p2", 2)], ms, ["holes-won-ratio"]);
    expect(ids(ratio)).toEqual(["p2", "p1"]);
    const lost = levelled([player("p1", 2), player("p2", 1)], ms, ["fewest-holes-lost"]);
    expect(ids(lost)).toEqual(["p1", "p2"]);
  });

  it("lower-handicap, asked for by the committee, ranks the lower handicap first (decimal indexes)", () => {
    const r = levelled([player("p1", 1, 3.5), player("p2", 2, 3.4)], [], ["lower-handicap"]);
    expect(ids(r)).toEqual(["p2", "p1"]);
    expect(ranks(r)).toEqual([1, 2]);
  });

  it("head-to-head: the mini-league among the level players, a win +1 and a loss -1 whichever side they play", () => {
    // a beats c, b beats c, a beats b (a plays from the B side against c and b): a +2, b 0, c -2.
    const p = [player("c", 1), player("b", 2), player("a", 3)];
    const ms = [match("c", "a", "BBBB"), match("b", "c", "AAAA"), match("b", "a", "BBBB")];
    const r = levelled(p, ms, ["head-to-head"]);
    expect(ids(r)).toEqual(["a", "b", "c"]);
    expect(ranks(r)).toEqual([1, 2, 3]);
  });

  it("head-to-head counts only meetings among the level players, and a halved or unfinished meeting counts for nothing", () => {
    const base = DEFAULT_SCORING;
    const stats = (pts: Record<string, number>): Map<string, PlayerStats> =>
      new Map(
        Object.entries(pts).map(([id, totalPoints]) => [
          id,
          { playerId: id, played: 0, playedForPoints: 0, wins: 0, losses: 0, ties: 0, holesWon: 0, holesLost: 0, points: totalPoints, totalPoints },
        ]),
      );
    const chain = { ...base, tiebreakers: ["head-to-head"] as TiebreakerKey[] };
    const ps = [player("a", 1), player("b", 2), player("c", 3)];
    // a and b level on 10; c on 5. b beat c, a lost to c: neither is a meeting between the two level players.
    const outsiders = rankPlayers(ps, stats({ a: 10, b: 10, c: 5 }), chain, [match("b", "c", "AAAA"), match("a", "c", "BBBB")]);
    expect(ranks(outsiders)).toEqual([1, 1, 3]);
    // Their own meeting halved, or not finished: still level.
    expect(ranks(rankPlayers(ps, stats({ a: 10, b: 10, c: 5 }), chain, [match("a", "b", "HHHH")]))).toEqual([1, 1, 3]);
    expect(ranks(rankPlayers(ps, stats({ a: 10, b: 10, c: 5 }), chain, [match("a", "b", "A---")]))).toEqual([1, 1, 3]);
    // Won: separated.
    const won = rankPlayers(ps, stats({ a: 10, b: 10, c: 5 }), chain, [match("b", "a", "AAAA")]);
    expect(ids(won)).toEqual(["b", "a", "c"]);
    expect(ranks(won)).toEqual([1, 2, 3]);
  });

  it("head-to-head reads a halved meeting through the countback, in the table and in the tiebreak", () => {
    // a and b halve AHHB; the round's countback gives it to B on the last hole. b seed 2, a seed 1.
    const ps = [player("a", 1), player("b", 2)];
    const stats = new Map<string, PlayerStats>(
      ["a", "b"].map((id) => [id, { playerId: id, played: 1, playedForPoints: 1, wins: 0, losses: 0, ties: 1, holesWon: 1, holesLost: 1, points: 2, totalPoints: 2 }]),
    );
    const chain = { ...DEFAULT_SCORING, tiebreakers: ["head-to-head"] as TiebreakerKey[] };
    const m = match("a", "b", "AHHB");
    expect(ranks(rankPlayers(ps, stats, chain, [m]))).toEqual([1, 1]);
    const decided = rankPlayers(ps, stats, chain, [m], undefined, { sequence: ["last-1"], strokeIndex: [] });
    expect(ids(decided)).toEqual(["b", "a"]);
    expect(ranks(decided)).toEqual([1, 2]);
  });

  it("computeStandings hands the countback its stroke index for the tiebreak as well as for the table", () => {
    // AHHB halved; hardest hole is hole 1 (A's). Carried points make the two level AFTER the countback has paid A 2 and B 0.
    const ps = [player("a", 2), player("b", 1)];
    const m = match("a", "b", "AHHB");
    const r = computeStandings(ps, [m], { ...DEFAULT_SCORING, tiebreakers: ["head-to-head"] }, { a: 0, b: 2 }, [1, 2, 3, 4], ["toughest-1"]);
    expect(ids(r)).toEqual(["a", "b"]);
    expect(ranks(r)).toEqual([1, 2]);
  });
});

describe("the toughest-N steps", () => {
  const SI = [4, 3, 2, 1]; // hole 4 is the hardest, then 3, 2, 1

  it("count the hardest holes only, from each side, and N is the number of holes", () => {
    // p1 (A side): HHBA -> loses hole 3, wins hole 4. Hardest 1 = hole 4: +1. Hardest 2 = holes 4 and 3: +1 -1 = 0.
    // p3 (B side): HHHB -> wins hole 4: +1 on the hardest. p2: nothing played.
    const ps = [player("p1", 3), player("p3", 2), player("p2", 1)];
    const ms = [match("p1", "g1", "HHBA"), match("g3", "p3", "HHHB")];
    const one = levelled(ps, ms, ["toughest-1"], SI);
    expect(ids(one)).toEqual(["p3", "p1", "p2"]);
    expect(ranks(one)).toEqual([1, 1, 3]);
    // Hardest two: p1 0, p3 +1, p2 0.
    const two = levelled(ps, ms, ["toughest-2"], SI);
    expect(ids(two)).toEqual(["p3", "p2", "p1"]);
    expect(ranks(two)).toEqual([1, 2, 2]);
  });

  it("the same card read the other way round: stroke index 1 is the hardest, so ascending", () => {
    const ps = [player("p1", 2), player("p2", 1)];
    const ms = [match("p1", "g1", "AHHH")]; // p1 wins hole 1 only
    expect(ids(levelled(ps, ms, ["toughest-1"], [1, 2, 3, 4]))).toEqual(["p1", "p2"]);
    expect(ranks(levelled(ps, ms, ["toughest-1"], [4, 3, 2, 1]))).toEqual([1, 1]);
  });

  it("each match is read on its own card when the card is a function", () => {
    // p1 wins hole 1 of m1, p2 wins hole 1 of m2; m1's card makes hole 1 the hardest, m2's makes hole 4 the hardest.
    const m1 = match("p1", "g1", "AHHH");
    const m2 = match("p2", "g2", "AHHH");
    const card = (m: Match) => (m.id === m1.id ? [1, 2, 3, 4] : [4, 3, 2, 1]);
    const r = levelled([player("p1", 2), player("p2", 1)], [m1, m2], ["toughest-1"], card);
    expect(ids(r)).toEqual(["p1", "p2"]);
    expect(ranks(r)).toEqual([1, 2]);
  });

  it("holes played after the match was already over do not count", () => {
    // AAAB: over after three holes (Rule 3.2a(3)); the fourth, B's, is not part of it. toughest-1 (hole 4) = nothing, 0.
    // The player who won hole 4 of an unfinished-looking raw card must not be marked down: level with a player who played nobody.
    const ps = [player("p1", 2), player("p2", 1)];
    expect(ranks(levelled(ps, [match("p1", "g1", "AAAB")], ["toughest-1"], SI))).toEqual([1, 1]);
    // All four holes: AAAB counted is A,A,A = +3; AAHH is +2. Raw AAAB would be +2 and tie it.
    const ps2 = [player("p4", 2), player("p5", 1)];
    const r = levelled(ps2, [match("p4", "g1", "AAAB"), match("p5", "g2", "AAHH")], ["toughest-4"], SI);
    expect(ids(r)).toEqual(["p4", "p5"]);
    expect(ranks(r)).toEqual([1, 2]);
  });

  it("holes not yet played and halved holes count for nobody", () => {
    // p7 won hole 1 of A--- (+1). p8 has no match. p9 halved everything. Hardest four: p7 +1, p8 0, p9 0.
    const ps = [player("p9", 1), player("p8", 2), player("p7", 3)];
    const r = levelled(ps, [match("p7", "g1", "A---"), match("p9", "g2", "HHHH")], ["toughest-4"], SI);
    expect(ids(r)).toEqual(["p7", "p9", "p8"]);
    expect(ranks(r)).toEqual([1, 2, 2]);
  });

  it("a forfeited match has no card worth reading", () => {
    // p10 was 3 up, then the opponent conceded: the discarded holes must not lift p10 above p8.
    const r = levelled([player("p10", 2), player("p8", 1)], [match("p10", "g", "AAAA", { forfeitedBy: "g" })], ["toughest-4"], SI);
    expect(ranks(r)).toEqual([1, 1]);
  });

  it("with no card, an empty card, or a number outside 1..18, the step decides nothing", () => {
    const ps = [player("p1", 2), player("p2", 1)];
    const ms = [match("p1", "g1", "AAAA")];
    expect(ranks(levelled(ps, ms, ["toughest-3"], undefined))).toEqual([1, 1]);
    expect(ranks(levelled(ps, ms, ["toughest-3"], []))).toEqual([1, 1]);
    expect(ranks(levelled(ps, ms, ["toughest-0" as TiebreakerKey], SI))).toEqual([1, 1]);
    expect(ranks(levelled(ps, ms, ["toughest-19" as TiebreakerKey], SI))).toEqual([1, 1]);
    expect(ranks(levelled(ps, ms, ["not-a-step" as TiebreakerKey], SI))).toEqual([1, 1]);
    // And the control: with a card, it does separate them.
    expect(ranks(levelled(ps, ms, ["toughest-3"], SI))).toEqual([1, 2]);
  });
});

describe("rankPlayers: whose chain applies", () => {
  const pair = (hcpA: number, hcpB: number) => [player("a", 1, hcpA), player("b", 2, hcpB)];
  const noMatches: Match[] = [];

  it("an untouched default chain orders by handicap but shares the place; the handicap decided nothing", () => {
    const r = computeStandings(pair(12, 5), noMatches, { ...DEFAULT_SCORING, tiebreakers: [...DEFAULT_SCORING.tiebreakers] });
    expect(ids(r)).toEqual(["b", "a"]);
    expect(ranks(r)).toEqual([1, 1]);
  });

  it("a chain that is not there at all takes the default", () => {
    const r = computeStandings(pair(12, 5), noMatches, { ...DEFAULT_SCORING, tiebreakers: undefined as unknown as TiebreakerKey[] });
    expect(ranks(r)).toEqual([1, 1]);
  });

  it("a reordered default is a choice: the handicap then separates", () => {
    const r = computeStandings(pair(12, 5), noMatches, {
      ...DEFAULT_SCORING,
      tiebreakers: ["head-to-head", "fewest-holes-lost", "holes-won-ratio", "lower-handicap"],
    });
    expect(ranks(r)).toEqual([1, 2]);
    expect(ids(r)).toEqual(["b", "a"]);
  });

  it("a chain that only shares the first key with the default is a choice too", () => {
    const r = computeStandings(pair(12, 5), noMatches, {
      ...DEFAULT_SCORING,
      tiebreakers: ["head-to-head", "most-wins", "win-percentage", "lower-handicap"],
    });
    expect(ranks(r)).toEqual([1, 2]);
  });

  it("the default four minus the handicap separates on results only", () => {
    const r = computeStandings(pair(12, 5), noMatches, {
      ...DEFAULT_SCORING,
      tiebreakers: ["head-to-head", "holes-won-ratio", "fewest-holes-lost"],
    });
    expect(ranks(r)).toEqual([1, 1]);
    expect(ids(r)).toEqual(["a", "b"]); // nothing orders them but the seed
  });

  it("a player is placed on the points they hold: the higher total is first, carried points included", () => {
    const r = computeStandings(
      [player("a", 1), player("b", 2), player("c", 3)],
      noMatches,
      { ...DEFAULT_SCORING, tiebreakers: [] },
      { a: 1, b: 7, c: 4 },
    );
    expect(ids(r)).toEqual(["b", "c", "a"]);
    expect(ranks(r)).toEqual([1, 2, 3]);
  });

  it("the caller's list is not reordered, and a player the stats do not know is last on nought", () => {
    const players = [player("c", 3), player("a", 1), player("b", 2)];
    const before = players.map((p) => p.id);
    const stats = new Map<string, PlayerStats>(
      ["a", "b"].map((id, i) => [id, { playerId: id, played: 0, playedForPoints: 0, wins: 0, losses: 0, ties: 0, holesWon: 0, holesLost: 0, points: 5 - i, totalPoints: 5 - i }]),
    );
    const r = rankPlayers(players, stats, { ...DEFAULT_SCORING, tiebreakers: [] }, []);
    expect(players.map((p) => p.id)).toEqual(before);
    expect(ids(r)).toEqual(["a", "b", "c"]);
    expect(ranks(r)).toEqual([1, 2, 3]);
  });
});

function ranked(id: string, totalPoints: number, rank: number): RankedPlayer {
  return {
    player: player(id, rank),
    rank,
    stats: { playerId: id, played: 0, playedForPoints: 0, wins: 0, losses: 0, ties: 0, holesWon: 0, holesLost: 0, points: totalPoints, totalPoints },
  };
}

describe("groupCutoff", () => {
  const table = [ranked("a", 9, 1), ranked("b", 7, 2), ranked("c", 4, 3)];
  it("is the points of the last player through", () => {
    expect(groupCutoff(table, 1)).toBe(9);
    expect(groupCutoff(table, 2)).toBe(7);
    expect(groupCutoff(table, 3)).toBe(4);
  });
  it("is the last player's when more qualify than there are", () => {
    expect(groupCutoff(table, 10)).toBe(4);
  });
  it("is null for nobody, or for a cut of nought or fewer", () => {
    expect(groupCutoff([], 2)).toBeNull();
    expect(groupCutoff(table, 0)).toBeNull();
    expect(groupCutoff(table, -1)).toBeNull();
    expect(groupCutoff([], 0)).toBeNull();
    // An empty table with a positive cut must not read a row that is not there.
    expect(() => groupCutoff([], 3)).not.toThrow();
  });
});

describe("cutLineTies", () => {
  const row = (id: string, rank: number, advancing: boolean, extra: Partial<Parameters<typeof cutLineTies>[0][number]> = {}) => ({
    id, rank, ranked: true, advancing, ...extra,
  });

  it("finds the position the line runs through, with everybody on it", () => {
    const t = cutLineTies([row("a", 1, true), row("b", 8, true), row("c", 8, false), row("d", 8, false), row("e", 9, false)], "overall");
    expect(t).toEqual([{ rank: 8, playerIds: ["b", "c", "d"] }]);
  });

  it("a shared place with everybody through, or everybody out, has no line through it", () => {
    expect(cutLineTies([row("a", 3, true), row("b", 3, true)], "overall")).toEqual([]);
    expect(cutLineTies([row("a", 3, false), row("b", 3, false)], "overall")).toEqual([]);
    expect(cutLineTies([row("a", 3, true)], "overall")).toEqual([]);
  });

  it("an unranked player, a rank below 1 and a rank that is not a number hold no position", () => {
    expect(cutLineTies([row("a", 2, true), { ...row("b", 2, false), ranked: false }], "overall")).toEqual([]);
    expect(cutLineTies([row("a", 0, true), row("b", 0, false)], "overall")).toEqual([]);
    expect(cutLineTies([row("a", Number.NaN, true), row("b", Number.NaN, false)], "overall")).toEqual([]);
    expect(cutLineTies([row("a", Infinity, true), row("b", Infinity, false)], "overall")).toEqual([]);
    // Position 1 itself is a position (Rule 3.3 / Procedures 5A: the winner can be tied too).
    expect(cutLineTies([row("a", 1, true), row("b", 1, false)], "overall")).toEqual([{ rank: 1, playerIds: ["a", "b"] }]);
  });

  it("per flight, the same rank in different flights is not a tie; overall it is", () => {
    const rows = [row("a", 2, true, { groupId: "f1" }), row("b", 2, false, { groupId: "f2" })];
    expect(cutLineTies(rows, "perFlight")).toEqual([]);
    expect(cutLineTies(rows, "overall")).toEqual([{ rank: 2, playerIds: ["a", "b"] }]);
    const same = [row("a", 2, true, { groupId: "f1" }), row("b", 2, false, { groupId: "f1" })];
    expect(cutLineTies(same, "perFlight")).toEqual([{ rank: 2, playerIds: ["a", "b"] }]);
  });

  it("per flight, a missing flight, a null flight and a blank flight are one flight", () => {
    const rows = [row("a", 4, true), row("b", 4, false, { groupId: null }), row("c", 4, false, { groupId: "" })];
    expect(cutLineTies(rows, "perFlight")).toEqual([{ rank: 4, playerIds: ["a", "b", "c"] }]);
  });

  it("lists the ties best position first", () => {
    const t = cutLineTies(
      [row("a", 6, true, { groupId: "x" }), row("b", 6, false, { groupId: "x" }), row("c", 2, true, { groupId: "y" }), row("d", 2, false, { groupId: "y" })],
      "perFlight",
    );
    expect(t.map((x) => x.rank)).toEqual([2, 6]);
  });
});

describe("cutLineShape", () => {
  it("a gap is a gap, in either direction", () => {
    expect(cutLineShape(2, false)).toBe("clear-gap");
    expect(cutLineShape(2, true)).toBe("clear-gap");
    expect(cutLineShape(-1, false)).toBe("clear-gap");
    expect(cutLineShape(0.5, true)).toBe("clear-gap");
  });
  it("no gap: a shared place is the committee's to decide; otherwise a countback already did", () => {
    expect(cutLineShape(0, true)).toBe("shared-place");
    expect(cutLineShape(0, false)).toBe("level-on-score");
  });
});

describe("qualificationBubble", () => {
  const p = (id: string, score: number, advancing: boolean, groupId?: string | null) => ({ id, score, advancing, groupId });

  it("points: the worst qualifier against the best who missed, whatever order they are listed in", () => {
    const players = [p("a", 12, true), p("b", 8, true), p("c", 10, true), p("d", 7, false), p("e", 3, false), p("f", 5, false)];
    for (const list of [players, [...players].reverse()]) {
      const b = qualificationBubble(list, "overall", true);
      expect(b!.lastIn.id).toBe("b");
      expect(b!.firstOut.id).toBe("d");
      expect(b!.gap).toBe(1);
    }
  });

  it("strokes: lower is better, so the worst qualifier is the highest score", () => {
    const players = [p("a", 70, true), p("b", 74, true), p("c", 72, true), p("d", 75, false), p("e", 80, false), p("f", 77, false)];
    for (const list of [players, [...players].reverse()]) {
      const b = qualificationBubble(list, "overall", false);
      expect(b!.lastIn.id).toBe("b");
      expect(b!.firstOut.id).toBe("d");
      expect(b!.gap).toBe(1);
    }
  });

  it("level scores: the first listed holds the place, and the gap is nought, not nothing", () => {
    const b = qualificationBubble([p("a", 10, true), p("b", 10, true), p("c", 10, false), p("d", 10, false)], "overall", true);
    expect(b).toEqual({ lastIn: p("a", 10, true), firstOut: p("c", 10, false), gap: 0 });
  });

  it("nobody out, or nobody in, is no bubble", () => {
    expect(qualificationBubble([p("a", 1, true)], "overall", true)).toBeNull();
    expect(qualificationBubble([p("a", 1, false)], "overall", true)).toBeNull();
    expect(qualificationBubble([], "overall", true)).toBeNull();
  });

  it("overall is one race whatever the flights; per flight each flight has its own", () => {
    const players = [p("a", 9, true, "f1"), p("b", 8, false, "f2"), p("c", 20, true, "f2"), p("d", 15, false, "f1")];
    // Overall: lastIn = lowest advancing (9), firstOut = highest out (15): the out is ahead -> a negative gap, no bubble.
    expect(qualificationBubble(players, "overall", true)).toBeNull();
    // Per flight: f1 lastIn 9, firstOut 15: negative, skipped. f2 lastIn 20, firstOut 8: gap 12.
    const f = qualificationBubble(players, "perFlight", true);
    expect(f!.gap).toBe(12);
    expect(f!.lastIn.id).toBe("c");
  });

  it("surfaces the tightest flight, the first of equals, and passes over a flight whose gap is negative", () => {
    const players = [
      p("a1", 10, true, "A"), p("a2", 6, false, "A"), // gap 4
      p("b1", 10, true, "B"), p("b2", 9, false, "B"), // gap 1
      p("c1", 10, true, "C"), p("c2", 9, false, "C"), // gap 1 (equal: B stays)
      p("d1", 3, true, "D"), p("d2", 8, false, "D"), // gap -5, no bubble
    ];
    const b = qualificationBubble(players, "perFlight", true);
    expect(b!.gap).toBe(1);
    expect(b!.lastIn.id).toBe("b1");
    // The tightest may come in any order of flight.
    const r = qualificationBubble([...players].reverse(), "perFlight", true);
    expect(r!.gap).toBe(1);
    expect(r!.lastIn.id).toBe("c1");
    // Only negative flights: no bubble at all.
    expect(qualificationBubble([p("x", 1, true, "Z"), p("y", 5, false, "Z")], "perFlight", true)).toBeNull();
  });

  it("a gap of exactly nought is still a bubble", () => {
    const b = qualificationBubble([p("a", 5, true, "Z"), p("b", 5, false, "Z")], "perFlight", true);
    expect(b!.gap).toBe(0);
  });

  it("per flight, a missing flight and a null flight are one flight", () => {
    const b = qualificationBubble([p("a", 5, true), p("b", 4, false, null), p("c", 5, true, "")], "perFlight", true);
    expect(b).not.toBeNull();
    expect(b!.firstOut.id).toBe("b");
    expect(b!.gap).toBe(1);
  });
});
