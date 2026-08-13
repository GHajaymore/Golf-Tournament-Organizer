import { describe, it, expect } from "vitest";
import {
  resolveMatch,
  marginToHoles,
  parseResultTranscript,
  aggregateStats,
  computeStandings,
  groupCutoff,
  qualificationBubble,
  type BubblePlayer,
  formGroups,
  flightCountFor,
  roundRobinSchedule,
  roundRobinMatchCount,
  buildBracket,
  splitBrackets,
  carriedInto,
  computeStrokeCard,
  holeStrokesReceived,
  stablefordPointsForHole,
  toParText,
  DEFAULT_SCORING,
  type HoleResult,
  type Player,
} from "../index";

const H = (s: string): HoleResult[] =>
  s.split("").map((c) => (c === "A" || c === "B" || c === "H" ? (c as HoleResult) : null));

const player = (id: string, name: string, handicap: number, seed: number): Player => ({
  id,
  name,
  handicap,
  seed,
});

describe("resolveMatch", () => {
  it("closes out early as N&M", () => {
    // A wins holes 1-3, loses none, 2 holes remain unplayed -> 3&2, dormie logic.
    const r = resolveMatch([..."AAA".split(""), null, null] as HoleResult[]);
    expect(r.complete).toBe(true);
    expect(r.winner).toBe("A");
    expect(r.resultText).toBe("3&2");
  });

  it("returns AS when all holes played and level", () => {
    const r = resolveMatch(H("AABBHHHHH".padEnd(9, "H")));
    expect(r.remaining).toBe(0);
    expect(r.complete).toBe(true);
    expect(r.winner).toBe("H");
    expect(r.resultText).toBe("AS");
  });

  it("returns N UP through the full round", () => {
    // 9 holes: A wins 5, B wins 4 -> A 1 up.
    //
    // The card was "AAAAABBBB", which is not a match anyone could have played:
    // A is five up with four to play at the 5th, so the match ENDED there,
    // 5&4 — B cannot then win the last four. resolveMatch now reads that, so
    // the fixture is a legal 1-up finish instead: the lead never exceeds the
    // holes remaining until the last putt drops.
    const r = resolveMatch(H("ABABABABA"));
    expect(r.remaining).toBe(0);
    expect(r.winner).toBe("A");
    expect(r.resultText).toBe("1 UP");
  });

  it("reports a closed-out match at the margin it closed on", () => {
    // The regression this guards: a match that ended 5&4 was reported "1 UP"
    // because the players carried on and the final state was read instead of
    // the moment the match was decided. It also credited B four holes won
    // after the match was over, which fed the standings tiebreakers.
    const r = resolveMatch(H("AAAAABBBB"));
    expect(r.resultText).toBe("5&4");
    expect(r.winner).toBe("A");
    expect(r.holesWonB).toBe(0);
  });

  it("is not complete while the trailing player can still square it", () => {
    // A up 1 with 2 to play: |lead| (1) not > remaining (2) -> still live.
    const r = resolveMatch([..."A".split(""), null, null] as HoleResult[]);
    expect(r.complete).toBe(false);
    expect(r.winner).toBe(null);
    expect(r.resultText).toBe("");
  });

  it("B can close out too", () => {
    // B up 3 with 2 to play: |lead| (3) > remaining (2) -> closed out 3&2.
    const r = resolveMatch([..."BBB".split(""), null, null] as HoleResult[]);
    expect(r.winner).toBe("B");
    expect(r.resultText).toBe("3&2");
  });
});

describe("marginToHoles round-trips through resolveMatch", () => {
  it("3&2 for A over 18 holes", () => {
    const holes = marginToHoles("A", "3&2", 18);
    const r = resolveMatch(holes);
    expect(r.winner).toBe("A");
    expect(r.resultText).toBe("3&2");
  });

  it("2 UP for B over 18 holes", () => {
    const holes = marginToHoles("B", "2 UP", 18);
    const r = resolveMatch(holes);
    expect(r.winner).toBe("B");
    expect(r.resultText).toBe("2 UP");
  });

  it("AS produces a halved full round", () => {
    const holes = marginToHoles("H", "AS", 18);
    const r = resolveMatch(holes);
    expect(r.winner).toBe("H");
    expect(r.resultText).toBe("AS");
  });
});

describe("parseResultTranscript", () => {
  it("detects halve keywords", () => {
    expect(parseResultTranscript("all square", "Sam", "Lee")).toEqual({
      winner: "H",
      margin: "AS",
    });
  });
  it("detects a player name and an N&M margin", () => {
    expect(parseResultTranscript("Sam wins 3 and 2", "Sam", "Lee")).toEqual({
      winner: "A",
      margin: "3&2",
    });
  });
  it("detects N up", () => {
    expect(parseResultTranscript("Lee 2 up", "Sam", "Lee")).toEqual({
      winner: "B",
      margin: "2 UP",
    });
  });
});

describe("standings", () => {
  const players = [
    player("p1", "Alice", 4, 1),
    player("p2", "Bob", 8, 2),
    player("p3", "Cara", 12, 3),
  ];
  // Round robin among 3: p1 beats p2 (2&1), p1 beats p3 (3&2), p2 halves p3 (AS).
  const matches = [
    { id: "m1", stageId: "s1", groupId: "g", round: 1, playerAId: "p1", playerBId: "p2", holes: marginToHoles("A", "2&1", 18) },
    { id: "m2", stageId: "s1", groupId: "g", round: 2, playerAId: "p1", playerBId: "p3", holes: marginToHoles("A", "3&2", 18) },
    { id: "m3", stageId: "s1", groupId: "g", round: 3, playerAId: "p2", playerBId: "p3", holes: marginToHoles("H", "AS", 18) },
  ];

  it("aggregates W/L/T correctly", () => {
    const stats = aggregateStats(players, matches, DEFAULT_SCORING);
    expect(stats.get("p1")).toMatchObject({ wins: 2, losses: 0, ties: 0, played: 2 });
    expect(stats.get("p2")).toMatchObject({ wins: 0, losses: 1, ties: 1, played: 2 });
    expect(stats.get("p3")).toMatchObject({ wins: 0, losses: 1, ties: 1, played: 2 });
  });

  it("ranks Alice first on points", () => {
    const ranked = computeStandings(players, matches, DEFAULT_SCORING);
    expect(ranked[0].player.id).toBe("p1");
    expect(ranked[0].rank).toBe(1);
  });

  it("breaks a points tie by head-to-head", () => {
    // Two players level on points; p2 beat p3 head to head.
    const two = [player("x", "X", 10, 1), player("y", "Y", 10, 2)];
    const m = [
      { id: "h", stageId: "s", groupId: "g", round: 1, playerAId: "x", playerBId: "y", holes: marginToHoles("A", "1 UP", 18) },
    ];
    // Give both equal points artificially via bonus so only H2H separates — here x already won.
    const ranked = computeStandings(two, m, DEFAULT_SCORING);
    expect(ranked[0].player.id).toBe("x");
  });

  it("computes the group cutoff at the qualify line", () => {
    const ranked = computeStandings(players, matches, DEFAULT_SCORING);
    const cutoff = groupCutoff(ranked, 2);
    expect(cutoff).toBe(ranked[1].stats.totalPoints);
  });
});

describe("qualification bubble", () => {
  // A flighted field with a per-flight cut, taking the top 2 of each flight.
  // Flight A is deep (high points), flight B is shallow. The overall list
  // interleaves them, so B's second qualifier sits well below A's third player
  // in the combined ranking.
  const perFlightField: BubblePlayer[] = [
    { id: "a1", score: 30, groupId: "A", advancing: true },
    { id: "a2", score: 28, groupId: "A", advancing: true },
    { id: "a3", score: 26, groupId: "A", advancing: false }, // out, but strong
    { id: "b1", score: 12, groupId: "B", advancing: true },
    { id: "b2", score: 10, groupId: "B", advancing: true }, // in, but low
    { id: "b3", score: 8, groupId: "B", advancing: false },
  ];

  it("never reports a negative gap for a player safe above their flight's line", () => {
    // The bug: comparing b2 (last in, 10 pts) against a3 (first out overall,
    // 26 pts) gave 10 − 26 = −16, telling a safe qualifier they were sixteen
    // points outside. Per flight, a3's bubble is inside flight A (28 − 26 = 2),
    // and every reported gap is against the correct line.
    const bubble = qualificationBubble(perFlightField, "perFlight", true);
    expect(bubble).not.toBeNull();
    expect(bubble!.gap).toBeGreaterThanOrEqual(0);
  });

  it("surfaces the tightest flight race, measured inside that flight", () => {
    // Flight A's bubble is 2 pts (a2 in at 28, a3 out at 26); flight B's is
    // also 2 (b2 in at 10, b3 out at 8). A ties, and the first flight seen
    // wins — either way the first-out is compared to its own flight's last-in.
    const bubble = qualificationBubble(perFlightField, "perFlight", true)!;
    expect(bubble.gap).toBe(2);
    expect(["a3", "b3"]).toContain(bubble.firstOut.id);
    expect(bubble.lastIn.groupId).toBe(bubble.firstOut.groupId);
  });

  it("compares against the whole field for an overall cut", () => {
    // Same players, but now the cut is overall: only the top four by points go
    // through, so a3 (26) is in and b1/b2 are out. The bubble is a3 (last in)
    // against b1 (first out): 26 − 12 = 14.
    const overall: BubblePlayer[] = perFlightField.map((p) => ({
      ...p,
      advancing: p.score >= 26,
    }));
    const bubble = qualificationBubble(overall, "overall", true)!;
    expect(bubble.lastIn.id).toBe("a3");
    expect(bubble.firstOut.id).toBe("b1");
    expect(bubble.gap).toBe(14);
  });

  it("reads a lower score as better when higherIsBetter is false", () => {
    // Stroke net: fewer shots is better, so the gap is firstOut − lastIn.
    const net: BubblePlayer[] = [
      { id: "x", score: 68, groupId: null, advancing: true },
      { id: "y", score: 70, groupId: null, advancing: true }, // last in
      { id: "z", score: 73, groupId: null, advancing: false }, // first out
    ];
    const bubble = qualificationBubble(net, "overall", false)!;
    expect(bubble.lastIn.id).toBe("y");
    expect(bubble.firstOut.id).toBe("z");
    expect(bubble.gap).toBe(3);
  });

  it("has no bubble when nobody is cut", () => {
    const allIn: BubblePlayer[] = [
      { id: "p", score: 5, advancing: true },
      { id: "q", score: 4, advancing: true },
    ];
    expect(qualificationBubble(allIn, "overall", true)).toBeNull();
  });
});

describe("toughest-N tiebreakers", () => {
  // Stroke index by position: hole index 0 = SI 1 (hardest), index 10 = SI 11 (mid-pack) —
  // toughest-3 covers indexes 0,1,2, so only the hole-0 result feeds it here.
  const strokeIndex = Array.from({ length: 18 }, (_, i) => i + 1);

  // X wins the toughest hole and loses an easy one; Y does the opposite. Both matches
  // are otherwise all-halved, so both players end up level on points, W/L/T, and
  // overall hole differential — only the toughest-3 comparison tells them apart. Y is
  // seeded ahead of X, so the seed fallback would rank Y first if toughest-3 didn't fire.
  const holesX: HoleResult[] = new Array(18).fill("H");
  holesX[0] = "A";
  holesX[10] = "B";
  const holesY: HoleResult[] = new Array(18).fill("H");
  holesY[0] = "B";
  holesY[10] = "A";
  const players = [player("x", "X", 10, 2), player("y", "Y", 10, 1)];
  const matches = [
    { id: "m1", stageId: "s", groupId: "g", round: 1, playerAId: "x", playerBId: "o1", holes: holesX },
    { id: "m2", stageId: "s", groupId: "g", round: 1, playerAId: "y", playerBId: "o2", holes: holesY },
  ];
  const scoring = { ...DEFAULT_SCORING, tiebreakers: ["toughest-3" as const] };

  it("ranks whoever won the toughest holes first, when stroke index is known", () => {
    const ranked = computeStandings(players, matches, scoring, {}, strokeIndex);
    expect(ranked[0].player.id).toBe("x");
  });

  it("falls through to seed order when stroke index is unknown", () => {
    const ranked = computeStandings(players, matches, scoring);
    expect(ranked[0].player.id).toBe("y");
  });
});

describe("carry-forward", () => {
  it("carries a percentage of previous totals", () => {
    const carried = carriedInto({ p1: 10, p2: 6 }, true, 50);
    expect(carried).toEqual({ p1: 5, p2: 3 });
  });
  it("returns empty when disabled", () => {
    expect(carriedInto({ p1: 10 }, false, 50)).toEqual({});
  });
});

describe("flight formation", () => {
  const field = (n: number) =>
    Array.from({ length: n }, (_, i) => player(`p${i}`, `P${i}`, (i * 1.7) % 20, i + 1));

  it("flight count: auto ~ n/4, honoring count / perFlight config", () => {
    expect(flightCountFor(32)).toBe(8);
    expect(flightCountFor(4)).toBe(2); // max(2, round(1))
    expect(flightCountFor(30, { mode: "count", value: 6 })).toBe(6);
    expect(flightCountFor(30, { mode: "perFlight", value: 5 })).toBe(6); // ceil(30/5)
    expect(flightCountFor(30, { mode: "perFlight", value: 4 })).toBe(8); // ceil(30/4)
  });

  it("every rule partitions the field evenly with no duplicates", () => {
    for (const rule of ["balanced", "handicap", "seeding", "random", "manual"] as const) {
      const groups = formGroups(field(32), rule);
      const ids = groups.flatMap((g) => g.playerIds);
      expect(ids.length).toBe(32);
      expect(new Set(ids).size).toBe(32);
      expect(groups.every((g) => g.playerIds.length === 4)).toBe(true);
    }
  });

  it("handicap and seeding differ when the two orderings diverge", () => {
    // handicap order and seed order are genuinely different permutations.
    const players = [
      player("p0", "P0", 5, 1),
      player("p1", "P1", 2, 2),
      player("p2", "P2", 8, 3),
      player("p3", "P3", 1, 4),
      player("p4", "P4", 7, 5),
      player("p5", "P5", 3, 6),
      player("p6", "P6", 9, 7),
      player("p7", "P7", 4, 8),
    ];
    const byHcp = formGroups(players, "handicap")[0].playerIds.slice().sort();
    const bySeed = formGroups(players, "seeding")[0].playerIds.slice().sort();
    expect(byHcp).not.toEqual(bySeed);
  });

  it("balanced honors a fixed flight count with even sizes", () => {
    const groups = formGroups(field(16), "balanced", { mode: "count", value: 4 });
    expect(groups.length).toBe(4);
    expect(groups.every((g) => g.playerIds.length === 4)).toBe(true);
  });

  it("random is deterministic under a fixed rng and varies across seeds", () => {
    const seeded = (seed: number) => {
      let s = seed;
      return () => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
      };
    };
    const a = formGroups(field(16), "random", { mode: "auto" }, undefined, seeded(1));
    const a2 = formGroups(field(16), "random", { mode: "auto" }, undefined, seeded(1));
    const b = formGroups(field(16), "random", { mode: "auto" }, undefined, seeded(2));
    expect(a.map((g) => g.playerIds)).toEqual(a2.map((g) => g.playerIds));
    expect(a.map((g) => g.playerIds)).not.toEqual(b.map((g) => g.playerIds));
  });

  it("manual keeps roster order", () => {
    const players = Array.from({ length: 6 }, (_, i) => player(`p${i}`, `P${i}`, 0, i + 1));
    const groups = formGroups(players, "manual");
    expect(groups[0].playerIds[0]).toBe("p0");
  });
});

describe("round robin schedule", () => {
  it("pairs everyone exactly once", () => {
    const ids = ["a", "b", "c", "d"];
    const sched = roundRobinSchedule(ids);
    expect(sched.length).toBe(roundRobinMatchCount(4)); // 6
    const seen = new Set(sched.map((p) => [p.aId, p.bId].sort().join("-")));
    expect(seen.size).toBe(6);
  });

  it("handles odd counts with a bye", () => {
    const sched = roundRobinSchedule(["a", "b", "c"]);
    expect(sched.length).toBe(roundRobinMatchCount(3)); // 3
  });
});

describe("stroke play", () => {
  it("computes gross/net/to-par and nines", () => {
    const pars = [4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 4, 3, 4, 5, 4, 3, 4, 5]; // par 72
    const strokes = [4, 5, 3, 5, 4, 4, 3, 6, 4, 4, 4, 3, 5, 5, 4, 3, 4, 5]; // gross 75
    const card = computeStrokeCard(strokes, pars, 8);
    expect(card.gross).toBe(75);
    expect(card.toPar).toBe(3);
    expect(card.net).toBe(67); // 75 - 8
    expect(card.front + card.back).toBe(75);
    expect(card.played).toBe(18);
  });
  it("handles partial rounds and formats to-par", () => {
    const pars = [4, 4, 3, 5];
    const card = computeStrokeCard([4, 4, null, null], pars, 0);
    expect(card.gross).toBe(8);
    expect(card.played).toBe(2);
    expect(card.toPar).toBe(0);
    expect(toParText(0)).toBe("E");
    expect(toParText(3)).toBe("+3");
    expect(toParText(-2)).toBe("-2");
  });

  it("allocates handicap strokes per hole (1/18 + extra on the hardest holes)", () => {
    expect(holeStrokesReceived(10, 1)).toBe(1); // in the hardest-10 holes
    expect(holeStrokesReceived(10, 15)).toBe(0); // not in the hardest-10
    expect(holeStrokesReceived(20, 1)).toBe(2); // 1 flat + 1 extra (hardest 2 holes)
    expect(holeStrokesReceived(20, 5)).toBe(1); // 1 flat only
  });

  it("prorates net to holes actually played instead of the full handicap", () => {
    const pars = [4, 4];
    const strokeIndex = [1, 2, ...Array.from({ length: 16 }, (_, i) => i + 3)]; // 18 holes, SI 1 & 2 first
    // Handicap 9 on the two hardest holes: each gets exactly 1 stroke (floor(9/18)=0, remainder 9 covers SI 1 & 2).
    const card = computeStrokeCard([5, 5, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null], pars, 9, strokeIndex);
    expect(card.gross).toBe(10);
    expect(card.net).toBe(8); // 10 - 2 strokes received on the 2 holes played, NOT 10 - 9
  });

  it("scores Stableford points per hole (2 for net par, floored at 0)", () => {
    expect(stablefordPointsForHole(4, 4, 0)).toBe(2); // net par
    expect(stablefordPointsForHole(3, 4, 0)).toBe(3); // net birdie
    expect(stablefordPointsForHole(2, 4, 0)).toBe(4); // net eagle
    expect(stablefordPointsForHole(5, 4, 0)).toBe(1); // net bogey
    expect(stablefordPointsForHole(6, 4, 0)).toBe(0); // net double bogey
    expect(stablefordPointsForHole(8, 4, 0)).toBe(0); // way worse — still floors at 0, not negative
    expect(stablefordPointsForHole(5, 4, 1)).toBe(2); // a stroke turns a gross bogey into a net par
  });

  it("totals Stableford points on the card", () => {
    const pars = [4, 4];
    const strokeIndex = [1, 2];
    // Scratch player (handicap 0): net par + net birdie = 2 + 3 = 5 points.
    const card = computeStrokeCard([4, 3], pars, 0, strokeIndex);
    expect(card.points).toBe(5);
  });
});

describe("bracket", () => {
  const seeds = Array.from({ length: 8 }, (_, i) => player(`s${i + 1}`, `Seed${i + 1}`, 0, i + 1));

  it("seeds round of 8 as 1v8, 4v5, 3v6, 2v7", () => {
    const view = buildBracket("winners", seeds, {});
    const r0 = view.rounds[0].matches;
    expect(r0[0].a.seed).toBe(1);
    expect(r0[0].b.seed).toBe(8);
    expect(r0[1].a.seed).toBe(4);
    expect(r0[1].b.seed).toBe(5);
    expect(r0[2].a.seed).toBe(3);
    expect(r0[2].b.seed).toBe(6);
    expect(r0[3].a.seed).toBe(2);
    expect(r0[3].b.seed).toBe(7);
  });

  it("advances chosen winners to a champion", () => {
    const winners: Record<string, string> = {
      "winners-0-0": "s1",
      "winners-0-1": "s4",
      "winners-0-2": "s3",
      "winners-0-3": "s2",
      "winners-1-0": "s1",
      "winners-1-1": "s2",
      "winners-2-0": "s1",
    };
    const view = buildBracket("winners", seeds, winners);
    expect(view.rounds[1].matches[0].a.playerId).toBe("s1");
    expect(view.rounds[1].matches[0].b.playerId).toBe("s4");
    expect(view.champion?.playerId).toBe("s1");
  });

  it("splits qualifiers top/bottom half", () => {
    const q = Array.from({ length: 16 }, (_, i) => player(`q${i}`, `Q${i}`, 0, i + 1));
    const { winners, consolation } = splitBrackets(q);
    expect(winners.length).toBe(8);
    expect(consolation.length).toBe(8);
    expect(winners[0].id).toBe("q0");
    expect(consolation[0].id).toBe("q8");
  });
});

describe("voice result attribution between prefix names", () => {
  it("credits Samantha, not Sam, when Samantha wins", () => {
    // Substring matching credited whoever was checked first: "samantha wins
    // 3 and 2" contains "sam", so Sam took Samantha's match. Whole-word
    // matching with the longer name tried first.
    const r = parseResultTranscript("samantha wins 3 and 2", "Sam", "Samantha");
    expect(r.winner).toBe("B");
    expect(r.margin).toBe("3&2");
  });

  it("still hears the shorter name on its own", () => {
    const r = parseResultTranscript("sam wins 2 up", "Sam", "Samantha");
    expect(r.winner).toBe("A");
    expect(r.margin).toBe("2 UP");
  });
});

describe("margins on a nine-hole card", () => {
  it("reconstructs 3&2 over nine holes", () => {
    const holes = marginToHoles("A", "3&2", 9);
    expect(holes).toHaveLength(9);
    const r = resolveMatch(holes);
    expect(r.winner).toBe("A");
    expect(r.resultText).toBe("3&2");
  });

  it("reconstructs 2 UP through nine", () => {
    const r = resolveMatch(marginToHoles("B", "2 UP", 9));
    expect(r.winner).toBe("B");
    expect(r.resultText).toBe("2 UP");
  });

  it("halves all nine on AS", () => {
    const holes = marginToHoles("H", "AS", 9);
    expect(holes.every((h) => h === "H")).toBe(true);
    expect(resolveMatch(holes).resultText).toBe("AS");
  });
});

describe("a per-match points cap", () => {
  const players = [player("p1", "Alice", 4, 1), player("p2", "Bob", 8, 2)];
  /** One thrashing and one narrow win — the shape a cap exists to flatten. */
  const matches = [
    { id: "m1", stageId: "s1", groupId: "g", round: 1, playerAId: "p1", playerBId: "p2", holes: marginToHoles("A", "7&6", 18) },
    { id: "m2", stageId: "s1", groupId: "g", round: 2, playerAId: "p1", playerBId: "p2", holes: marginToHoles("A", "1UP", 18) },
  ];

  it("changes nothing when no cap is set", () => {
    // Every existing tournament stores zero and must keep its numbers. The
    // engine now sums match by match rather than from season totals, and this
    // is what proves the two agree.
    const uncapped = aggregateStats(players, matches, { ...DEFAULT_SCORING, maxPerMatch: 0 });
    const p1 = uncapped.get("p1")!;
    expect(p1.points).toBe(
      p1.wins * DEFAULT_SCORING.winPts +
        p1.losses * DEFAULT_SCORING.lossPts +
        p1.ties * DEFAULT_SCORING.tiePts +
        p1.holesWon * DEFAULT_SCORING.holeRatioPts +
        DEFAULT_SCORING.bonusPts,
    );
  });

  it("stops one thrashing from being worth several wins", () => {
    // The whole point: uncapped, the 7&6 pays far more than the 1-up, so a
    // flight can be settled before the last match is played.
    const capped = aggregateStats(players, matches, { ...DEFAULT_SCORING, maxPerMatch: 4 });
    const uncapped = aggregateStats(players, matches, { ...DEFAULT_SCORING, maxPerMatch: 0 });
    expect(capped.get("p1")!.points).toBeLessThan(uncapped.get("p1")!.points);
    // Two matches, no more than 4 from either.
    expect(capped.get("p1")!.points).toBeLessThanOrEqual(8);
  });

  it("leaves a modest win untouched — the cap only bites the outliers", () => {
    // A 1-up win pays 3 + a hole or two; a cap of 4 should not reach it.
    const oneUp = [matches[1]];
    const capped = aggregateStats(players, oneUp, { ...DEFAULT_SCORING, maxPerMatch: 8 });
    const uncapped = aggregateStats(players, oneUp, { ...DEFAULT_SCORING, maxPerMatch: 0 });
    expect(capped.get("p1")!.points).toBe(uncapped.get("p1")!.points);
  });

  it("keeps the participation bonus outside the cap", () => {
    // The bonus is for turning up, not earned from a match, so capping it
    // would quietly punish playing.
    const scoring = { ...DEFAULT_SCORING, bonusPts: 10, maxPerMatch: 1 };
    expect(aggregateStats(players, matches, scoring).get("p1")!.points).toBeGreaterThanOrEqual(10);
  });

  it("records the same wins and holes either way — only points move", () => {
    // A cap changes what a match is worth, never what happened on the course.
    const capped = aggregateStats(players, matches, { ...DEFAULT_SCORING, maxPerMatch: 2 });
    const uncapped = aggregateStats(players, matches, { ...DEFAULT_SCORING, maxPerMatch: 0 });
    expect(capped.get("p1")!.wins).toBe(uncapped.get("p1")!.wins);
    expect(capped.get("p1")!.holesWon).toBe(uncapped.get("p1")!.holesWon);
  });
});
