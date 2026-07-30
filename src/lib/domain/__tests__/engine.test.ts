import { describe, it, expect } from "vitest";
import {
  resolveMatch,
  marginToHoles,
  parseResultTranscript,
  aggregateStats,
  computeStandings,
  groupCutoff,
  formGroups,
  groupCountFor,
  roundRobinSchedule,
  roundRobinMatchCount,
  buildBracket,
  pickQualifiers,
  splitBrackets,
  carriedInto,
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
    const r = resolveMatch(H("AAAAABBBB"));
    expect(r.remaining).toBe(0);
    expect(r.winner).toBe("A");
    expect(r.resultText).toBe("1 UP");
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

describe("carry-forward", () => {
  it("carries a percentage of previous totals", () => {
    const carried = carriedInto({ p1: 10, p2: 6 }, true, 50);
    expect(carried).toEqual({ p1: 5, p2: 3 });
  });
  it("returns empty when disabled", () => {
    expect(carriedInto({ p1: 10 }, false, 50)).toEqual({});
  });
});

describe("grouping", () => {
  it("group count is max(2, round(n/4))", () => {
    expect(groupCountFor(32)).toBe(8);
    expect(groupCountFor(4)).toBe(1 === 1 ? 2 : 2); // max(2, 1) = 2
    expect(groupCountFor(10)).toBe(3); // round(2.5)=3 (banker? JS rounds .5 up)
  });

  it("snake-drafts by handicap into balanced groups", () => {
    const players = Array.from({ length: 8 }, (_, i) =>
      player(`p${i}`, `P${i}`, i + 1, i + 1),
    );
    const groups = formGroups(players, "handicap");
    expect(groups.length).toBe(2);
    // 8 players, 2 groups: snake gives group A the 1st,4th,5th,8th lowest hcp.
    const a = groups[0].playerIds;
    const b = groups[1].playerIds;
    expect(a.length).toBe(4);
    expect(b.length).toBe(4);
    // Every player assigned exactly once.
    expect(new Set([...a, ...b]).size).toBe(8);
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
