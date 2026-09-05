import { describe, it, expect } from "vitest";
import {
  breakMatchTie,
  cleanMatchTiebreakers,
  defaultCountback,
  MATCH_TIEBREAK_KEYS,
  MATCH_TIEBREAK_LABELS,
  MATCH_TIEBREAK_BLURBS,
  STANDARD_COUNTBACK,
  STANDARD_COUNTBACK_9,
  type MatchTiebreakKey,
} from "../domain/match-tiebreak";
import type { HoleResult, Match, Player, ScoringRules } from "../domain/types";
import { aggregateStats, computeStandings } from "../domain/standings";
import { resolveMatch } from "../domain/match";

/**
 * Deciding one all-square match.
 *
 * A different question from the standings tiebreakers, which separate players
 * level on points across a tournament. This separates two players level on the
 * card in front of you, and the app previously had no answer at all: an all
 * square match was halved, full stop.
 */

/** A card where A and B each win the holes listed, everything else halved. */
const card = (holes: number, aWins: number[], bWins: number[]): HoleResult[] =>
  Array.from({ length: holes }, (_, i) =>
    aWins.includes(i + 1) ? "A" : bWins.includes(i + 1) ? "B" : "H",
  );

/** Standard men's card: odd indexes on the front, even on the back. */
const SI = [7, 3, 11, 1, 15, 5, 17, 9, 13, 8, 4, 12, 2, 16, 6, 18, 10, 14];

describe("the countback", () => {
  it("gives it to whoever won more of the back nine", () => {
    // Level overall: A won 1 and 2, B won 10 and 11 — but the back nine is B's.
    const holes = card(18, [1, 2, 3], [10, 11, 12]);
    const r = breakMatchTie(holes, SI, STANDARD_COUNTBACK);
    expect(r.winner).toBe("B");
    expect(r.decidedBy).toBe("last-9");
  });

  it("falls through to the last six when the back nine is level", () => {
    // Back nine level at 1–1 (A won the 10th, B the 15th), but the 10th sits
    // outside the last six — so that step separates them and the earlier one
    // does not.
    const holes = card(18, [10], [15]);
    const r = breakMatchTie(holes, SI, STANDARD_COUNTBACK);
    expect(r.decidedBy).toBe("last-6");
    expect(r.winner).toBe("B");
  });

  it("falls all the way to the last hole", () => {
    // Every earlier step has to tie for the last hole to matter, and the 18th
    // is inside all of them — so it takes offsetting wins. A won the 18th, B
    // the 16th: level on the last 9, 6 and 3, decided on the last.
    const holes = card(18, [18], [16]);
    const r = breakMatchTie(holes, SI, STANDARD_COUNTBACK);
    expect(r.winner).toBe("A");
    expect(r.decidedBy).toBe("last-1");
  });

  it("leaves it halved when nothing separates them", () => {
    // Genuinely identical cards — the honest outcome is no winner, not a
    // coin toss dressed up as a rule.
    const holes = card(18, [], []);
    const r = breakMatchTie(holes, SI, STANDARD_COUNTBACK);
    expect(r.winner).toBeNull();
    expect(r.decidedBy).toBeNull();
    expect(r.detail).toContain("nothing in the countback");
  });

  it("stops at 'leave it halved' without looking further", () => {
    // A sequence ending in "halved" means the organizer chose to accept ties.
    const holes = card(18, [18], []);
    const r = breakMatchTie(holes, SI, ["halved", "last-1"]);
    expect(r.winner).toBeNull();
    expect(r.decidedBy).toBeNull();
  });
});

describe("toughest holes", () => {
  it("uses the card's stroke index, not hole order", () => {
    // Stroke index 1 is the 4th hole on this card. A won it; B won the 1st,
    // which is index 7 and not in the toughest three.
    const holes = card(18, [4], [1]);
    const r = breakMatchTie(holes, SI, ["toughest-3"]);
    expect(r.winner).toBe("A");
    expect(r.decidedBy).toBe("toughest-3");
  });

  it("toughest-1 is stroke index 1 and nothing else", () => {
    const holes = card(18, [4], [2]); // SI 1 vs SI 3
    const r = breakMatchTie(holes, SI, ["toughest-1"]);
    expect(r.winner).toBe("A");
  });

  it("skips a toughest step when the card has no stroke index", () => {
    // Rather than treating every hole as equally hard and picking the first
    // few, which would be an invented order presented as a rule.
    const holes = card(18, [18], []);
    const r = breakMatchTie(holes, [], ["toughest-3", "last-1"]);
    expect(r.decidedBy).toBe("last-1");
    expect(r.winner).toBe("A");
  });

  it("falls through when the toughest holes are level", () => {
    const holes = card(18, [4], [2, 18]); // SI 1 to A, SI 3 to B → 1–1 on toughest-3
    const r = breakMatchTie(holes, SI, ["toughest-3", "last-1"]);
    expect(r.decidedBy).toBe("last-1");
    expect(r.winner).toBe("B");
  });
});

describe("nine-hole rounds", () => {
  it("has its own default, because a 'last 9' is the whole round", () => {
    expect(defaultCountback(9)).toEqual(STANDARD_COUNTBACK_9);
    expect(defaultCountback(9)).not.toContain("last-9");
    expect(defaultCountback(18)).toEqual(STANDARD_COUNTBACK);
  });

  it("counts the last six of nine, not of eighteen", () => {
    const holes = card(9, [5], [1]); // hole 5 is inside the last six; hole 1 isn't
    const r = breakMatchTie(holes, SI.slice(0, 9), STANDARD_COUNTBACK_9);
    expect(r.winner).toBe("A");
    expect(r.decidedBy).toBe("last-6");
  });

  it("never reads past the end of a nine-hole card", () => {
    // "last 9" on a nine-hole round is every hole, not an overrun.
    const holes = card(9, [1], []);
    const r = breakMatchTie(holes, SI.slice(0, 9), ["last-9"]);
    expect(r.winner).toBe("A");
  });
});

describe("sudden death", () => {
  it("asks for a human rather than inventing a result", () => {
    const holes = card(18, [], []);
    const r = breakMatchTie(holes, SI, ["sudden-death"]);
    expect(r.winner).toBeNull();
    expect(r.needsManualResult).toBe(true);
    expect(r.detail).toContain("play off");
  });

  it("only reaches it once the computable steps have tied", () => {
    const holes = card(18, [18], []);
    const r = breakMatchTie(holes, SI, ["last-1", "sudden-death"]);
    expect(r.winner).toBe("A");
    expect(r.needsManualResult).toBe(false);
  });
});

describe("the catalogue", () => {
  it("labels and describes every key", () => {
    for (const k of MATCH_TIEBREAK_KEYS) {
      expect(MATCH_TIEBREAK_LABELS[k], k).toBeTruthy();
      expect(MATCH_TIEBREAK_BLURBS[k]?.length ?? 0, k).toBeGreaterThan(15);
    }
  });

  it("the standard countback is the one the rules recommend", () => {
    expect(STANDARD_COUNTBACK).toEqual(["last-9", "last-6", "last-3", "last-1"]);
  });

  it("cleans a stored sequence, dropping junk and duplicates", () => {
    expect(cleanMatchTiebreakers(["last-6", "nonsense", "last-6", "toughest-3"])).toEqual([
      "last-6",
      "toughest-3",
    ]);
    expect(cleanMatchTiebreakers("last-6")).toEqual([]);
    expect(cleanMatchTiebreakers(null)).toEqual([]);
    expect(cleanMatchTiebreakers([1, 2, 3])).toEqual([]);
  });

  it("an empty sequence leaves the match halved", () => {
    const r = breakMatchTie(card(18, [18], []), SI, []);
    expect(r.winner).toBeNull();
  });

  it("ignores a step it doesn't know rather than throwing", () => {
    const r = breakMatchTie(card(18, [18], []), SI, ["bogus" as MatchTiebreakKey, "last-1"]);
    expect(r.winner).toBe("A");
  });
});

describe("a decided match changes the points", () => {
  // The whole reason the engine exists: an all-square match awarded half a
  // point each. With a countback set it awards a win and a loss instead — and
  // that changes the standings the cut is made on.
  const players: Player[] = [
    { id: "a", name: "A", handicap: 0, seed: 1 },
    { id: "b", name: "B", handicap: 0, seed: 2 },
  ];
  const scoring: ScoringRules = {
    winPts: 3, tiePts: 1, lossPts: 0, holeRatioPts: 0, bonusPts: 0, playPts: 0, maxPerMatch: 0,
    tiebreakers: ["head-to-head"],
  };
  // All square overall, but A won the 18th and B the 16th — level on the last
  // 9, 6 and 3, decided on the last hole.
  const holes = Array.from({ length: 18 }, (_, i) =>
    i === 17 ? "A" : i === 15 ? "B" : "H",
  ) as HoleResult[];
  const match = { id: "m1", playerAId: "a", playerBId: "b", holes } as unknown as Match;
  const SI = [7, 3, 11, 1, 15, 5, 17, 9, 13, 8, 4, 12, 2, 16, 6, 18, 10, 14];

  it("halves it when no sequence is set", () => {
    const s = aggregateStats(players, [match], scoring);
    expect(s.get("a")!.ties).toBe(1);
    expect(s.get("b")!.ties).toBe(1);
    expect(s.get("a")!.points).toBe(1);
  });

  it("awards a win and a loss once a countback is set", () => {
    const s = aggregateStats(players, [match], scoring, {}, {
      sequence: ["last-9", "last-6", "last-3", "last-1"],
      strokeIndex: SI,
    });
    expect(s.get("a")!.wins).toBe(1);
    expect(s.get("a")!.ties).toBe(0);
    expect(s.get("b")!.losses).toBe(1);
    expect(s.get("a")!.points).toBe(3);
    expect(s.get("b")!.points).toBe(0);
  });

  it("leaves it halved when the sequence cannot separate them", () => {
    const dead = Array.from({ length: 18 }, () => "H") as HoleResult[];
    const s = aggregateStats(players, [{ ...match, holes: dead } as Match], scoring, {}, {
      sequence: ["last-9", "last-1"],
      strokeIndex: SI,
    });
    expect(s.get("a")!.ties).toBe(1);
  });

  it("does not touch a match that already had a winner", () => {
    const won = Array.from({ length: 18 }, (_, i) => (i < 3 ? "A" : "H")) as HoleResult[];
    const s = aggregateStats(players, [{ ...match, holes: won } as Match], scoring, {}, {
      sequence: ["last-1"],
      strokeIndex: SI,
    });
    expect(s.get("a")!.wins).toBe(1);
    expect(s.get("b")!.losses).toBe(1);
  });

  it("reaches the standings through computeStandings", () => {
    const ranked = computeStandings(players, [match], scoring, {}, SI, [
      "last-9", "last-6", "last-3", "last-1",
    ]);
    expect(ranked[0].player.id).toBe("a");
    expect(ranked[0].stats.points).toBe(3);
  });

  /**
   * ...and it decides the HEAD-TO-HEAD as well as the points.
   *
   * `aggregateStats` put the countback through to wins and losses. The
   * tiebreakers asked the card themselves and stopped at `winner === "H"`, so a
   * match the countback had decided read as no meeting at all — and two players
   * level on points fell straight past head-to-head to whatever came next,
   * while the table beside them showed the win.
   *
   * The fixture makes the two players level on POINTS deliberately: equal
   * points is the only state in which a tiebreaker is consulted, so a countback
   * that awards 3-0 would never reach it. `tiePts` and `winPts` are both 1
   * here, so the meeting is decided and the points are not.
   */
  const levelPoints: ScoringRules = {
    winPts: 1, tiePts: 1, lossPts: 1, holeRatioPts: 0, bonusPts: 0, playPts: 0, maxPerMatch: 0,
    tiebreakers: ["head-to-head"],
  };

  it("separates two players level on points, on the meeting the countback decided", () => {
    const ranked = computeStandings(players, [match], levelPoints, {}, SI, [
      "last-9", "last-6", "last-3", "last-1",
    ]);

    // The premise: genuinely level, so head-to-head is what decides.
    expect(ranked[0].stats.totalPoints).toBe(ranked[1].stats.totalPoints);
    // A won the 18th, so A won the meeting.
    expect(ranked[0].player.id).toBe("a");
    expect(ranked[0].rank).toBe(1);
    expect(ranked[1].rank).toBe(2);
  });

  it("still reports no meeting when the countback cannot separate them", () => {
    // The other half: a genuinely halved match must not become a head-to-head
    // win for whoever happens to sort first.
    const dead = Array.from({ length: 18 }, () => "H") as HoleResult[];
    const ranked = computeStandings(
      players,
      [{ ...match, holes: dead } as Match],
      levelPoints,
      {},
      SI,
      ["last-9", "last-1"],
    );
    expect(ranked[0].stats.totalPoints).toBe(ranked[1].stats.totalPoints);
    // Nothing separated them, so they share the position rather than being
    // ordered by seed and presented as a result.
    expect(ranked[0].rank).toBe(1);
    expect(ranked[1].rank).toBe(1);
  });

  it("does not invent a meeting when no countback is configured", () => {
    // With no sequence the match really is halved, and head-to-head really
    // does say nothing — so the pair stay level. This is what the old
    // behaviour was right about, and it must survive the fix.
    const ranked = computeStandings(players, [match], levelPoints, {}, SI, []);
    expect(ranked[0].rank).toBe(1);
    expect(ranked[1].rank).toBe(1);
  });
});

/**
 * The toughest-N tiebreakers read the same card the RESULT does.
 *
 * `resolveMatch` stops at the closeout — Rule 3.2a(3), a match ends when one
 * side leads by more holes than remain — and its own comment says holes played
 * after that "must not be part of the record either", because they were
 * feeding `holes-won-ratio` and `fewest-holes-lost`.
 *
 * That fix went into `resolveMatch`; `holesDiffOn`, which powers
 * `toughest-6`/`toughest-3`/`toughest-1`, walked the raw card and was missed.
 * So a player beaten 3&2 who took 17 and 18 in the walk-in had those holes
 * excluded from every stat and counted here — on the hardest holes of the
 * course, deciding a tie about the very match the result says ended earlier.
 */
describe("holes played after the match was over", () => {
  const players: Player[] = [
    { id: "a", name: "A", handicap: 0, seed: 1 },
    { id: "b", name: "B", handicap: 0, seed: 2 },
  ];
  /** Level on points, so a tiebreaker is reached at all. */
  const scoring: ScoringRules = {
    winPts: 1, tiePts: 1, lossPts: 1, holeRatioPts: 0, bonusPts: 0, playPts: 0, maxPerMatch: 0,
    tiebreakers: ["toughest-1"],
  };
  /**
   * A card whose HARDEST hole is the 17th (index 16).
   *
   * That placement is the whole fixture. The bug is a hole counted after the
   * closeout, and a match cannot close out early — A five up needs four or
   * fewer to play, which is the 14th at the earliest. So the hardest hole has
   * to fall late, or the tiebreaker never looks at the holes in dispute and
   * the test passes against both branches. My first attempt put stroke index 1
   * on the 4th and did exactly that.
   */
  const SI = [7, 3, 11, 5, 15, 9, 17, 13, 8, 4, 12, 6, 16, 10, 18, 14, 1, 2];
  /** Hole 17. */
  const HARDEST = 16;

  /** A wins the first five, everything halved to the 14th: 5&4. */
  const closedOut = (over: Partial<Record<number, "A" | "B" | "H">> = {}): HoleResult[] =>
    Array.from({ length: 18 }, (_, i) => over[i] ?? (i < 5 ? "A" : "H")) as HoleResult[];

  it("the fixture really does close the match out early", () => {
    // Asserted, because everything below is meaningless if it does not. A
    // whole-card match would count every hole legitimately.
    const r = resolveMatch(closedOut());
    expect(r.complete).toBe(true);
    expect(r.resultText).toBe("5&4");
  });

  it("does not count the hardest hole when it was played after the closeout", () => {
    // B takes the 17th in the walk-in. The result ended at the 14th, so that
    // hole is not part of it — and must not decide a tie about it either.
    const m = {
      id: "m1", playerAId: "a", playerBId: "b", holes: closedOut({ [HARDEST]: "B" }),
    } as unknown as Match;

    const r = computeStandings(players, [m], scoring, {}, SI, []);
    expect(r[0].stats.totalPoints).toBe(r[1].stats.totalPoints);
    expect(r[0].rank).toBe(1);
    expect(r[1].rank, "a hole after the closeout must not break the tie").toBe(1);
  });

  it("still counts a hard hole that was played while the match was live", () => {
    /**
     * The control, and the half a careless fix breaks: stroke index 2 is the
     * 18th here, so instead the tie is asked about the 3rd — index 1, stroke
     * index 3 — which A won on the way to closing it out. Reached through
     * `toughest-3`, which covers the hardest three: the 17th, the 18th and the
     * 2nd. Only the 2nd was played before the 14th, and A won it.
     */
    const inPlay: ScoringRules = { ...scoring, tiebreakers: ["toughest-3"] };
    const m = {
      id: "m2", playerAId: "a", playerBId: "b", holes: closedOut({ [HARDEST]: "B" }),
    } as unknown as Match;

    const r = computeStandings(players, [m], inPlay, {}, SI, []);
    expect(r[0].stats.totalPoints).toBe(r[1].stats.totalPoints);
    expect(r[0].player.id, "A won the hard hole that actually counted").toBe("a");
    expect(r[1].rank).toBe(2);
  });
});
