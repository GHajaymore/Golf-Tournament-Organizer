import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { computeStandings } from "../standings";
import { orderClubs, type ClubRecord, type HeadToHead } from "../league-order";
import { placesOfLevelGroup } from "../level-places";
import { roundRobinCutOutcome } from "../cut";
import { DEFAULT_SCORING, type HoleResult, type Match, type Player, type TiebreakerKey } from "../types";
import { readSource, stripComments } from "../../__tests__/source";

/**
 * PLAYERS LEVEL ON POINTS ARE PLACED OVER THE WHOLE LEVEL GROUP, NOT PAIR BY
 * PAIR (2026-11-07; registered by the J31 review in docs/deferred-register.md).
 *
 * The rule, worked here by hand from the results and never from the table's
 * order. How a tie is decided is the Committee's (Committee Procedures 5A(6)),
 * and the table's chain ("Level in the table") is that decision. Its
 * head-to-head step is the usual league practice, a MINI-LEAGUE among only
 * the tied (as football's group rules write it: points among the tied, and
 * if some are still level, the same again among only those): asked of the
 * whole level group; a part still level is asked it AGAIN over only its own
 * members; a group it cannot separate at all (a cycle) goes on to the next
 * step together; once a step after head-to-head has been reached, the chain
 * goes on down and does not start again; whoever is still level at the end
 * SHARES the place. Never entry order, and never a handicap the committee did
 * not choose (`a-handicap-is-not-a-result.test.ts`).
 *
 * The defect: `rankPlayers` ordered by the group's mini-league but decided a
 * shared place by asking each NEIGHBOURING PAIR's own meeting. Three level
 * players beating each other in a circle were numbered 2, 3, 4 in entry order.
 *
 * Every cell is run in EVERY entry order (all permutations of the seeds) with
 * handicaps that disagree with the seeds, so an answer that leans on either
 * cannot pass by luck.
 */

/** k holes won outright, then halved — "k up", or k&(18-k-…) where it closes out. Holes won = k. */
const won = (side: "A" | "B", k: number): HoleResult[] => [
  ...new Array<HoleResult>(k).fill(side),
  ...new Array<HoleResult>(18 - k).fill("H"),
];
const halved = (): HoleResult[] => new Array<HoleResult>(18).fill("H");

/** A result: [winner, loser, holes won by the winner] — or a halve. */
type Result = [string, string, number] | [string, string, "halved"];

function field(names: string[], results: Result[], order: number[]) {
  // Handicaps run the OTHER way from the names, so a handicap answer and an
  // entry-order answer are both visibly wrong.
  const players: Player[] = names.map((id, i) => ({ id, name: id, handicap: 30 - i, seed: order[i] + 1, groupId: "g" }));
  const matches: Match[] = results.map(([a, b, k], i) => ({
    id: `m${i}`,
    stageId: "s",
    groupId: "g",
    round: 1,
    playerAId: a,
    playerBId: b,
    holes: k === "halved" ? halved() : won("A", k),
  }));
  return { players, matches };
}

function permutations(n: number): number[][] {
  if (n === 1) return [[0]];
  const out: number[][] = [];
  for (const rest of permutations(n - 1)) {
    for (let at = 0; at <= rest.length; at += 1) out.push([...rest.slice(0, at), n - 1, ...rest.slice(at)]);
  }
  return out;
}

/** Every entry order the field can come in (up to 720), each ranked; returns the one rank map, or fails. */
function ranksInEveryOrder(names: string[], results: Result[], tiebreakers: TiebreakerKey[] = DEFAULT_SCORING.tiebreakers) {
  const scoring = { ...DEFAULT_SCORING, tiebreakers };
  let first: Record<string, number> | null = null;
  for (const order of permutations(names.length)) {
    const { players, matches } = field(names, results, order);
    const ranks = Object.fromEntries(computeStandings(players, matches, scoring).map((r) => [r.player.id, r.rank]));
    if (first === null) first = ranks;
    else expect(ranks, `entry order ${order.join(",")}`).toEqual(first);
  }
  return first!;
}

/**
 * The J31 review's round: Ann beats all three; Bea b Cat, Cat b Dot, Dot b Bea;
 * every match 1 up. By hand (win 2, halve 1, loss 0):
 *   Ann  3 wins                   6 points
 *   Bea  b Cat; lost Ann, Dot     2 points ┐
 *   Cat  b Dot; lost Ann, Bea     2 points ├ level
 *   Dot  b Bea; lost Ann, Cat     2 points ┘
 * Among the three only: each won 1 and lost 1 — the mini-league is 0, 0, 0.
 * Hole difference: each won 1 hole and lost 2 — -1, -1, -1. Holes lost: 2, 2, 2.
 * Nothing any of them did separates them: Ann 1st, the three share 2nd.
 */
const CYCLE: Result[] = [
  ["ann", "bea", 1], ["ann", "cat", 1], ["ann", "dot", 1],
  ["bea", "cat", 1], ["cat", "dot", 1], ["dot", "bea", 1],
];

describe("a head-to-head cycle among players level on points", () => {
  it("three beating each other in a circle SHARE the place, in every entry order", () => {
    expect(ranksInEveryOrder(["ann", "bea", "cat", "dot"], CYCLE)).toEqual({ ann: 1, bea: 2, cat: 2, dot: 2 });
  });

  it("and a cut on countback at that place owes a draw for it, never the earliest entry", () => {
    // Committee Procedures 5A(6): a tie the committee's method cannot settle
    // is settled by lot — the app finds it, the committee records it.
    for (const order of permutations(4)) {
      const { players, matches } = field(["ann", "bea", "cat", "dot"], CYCLE, order);
      const table = computeStandings(players, matches, DEFAULT_SCORING);
      const out = roundRobinCutOutcome(table, {
        cutScope: "overall", cutMode: "count", cutCount: 2, cutPercent: 50, cutTies: "countback", cutTieDecisions: "[]",
      });
      expect([...out.through], `entry order ${order.join(",")}`).toEqual(["ann"]);
      expect(out.undecided.map((u) => [[...u.playerIds].sort(), u.places, u.by])).toEqual([[["bea", "cat", "dot"], 1, "draw"]]);
    }
  });

  it("a cycle goes on to the NEXT step together — hole difference, then holes lost", () => {
    // Bea b Cat by 3 holes (3&2), Cat b Dot by 1, Dot b Bea by 2 (2&1); Ann
    // beats each 1 up. Points: Ann 6, the three 2 each. Mini-league 0, 0, 0.
    //   Bea  won 3            lost 1 (Ann) + 2 (Dot) = 3   difference  0
    //   Cat  won 1            lost 1 (Ann) + 3 (Bea) = 4   difference -3
    //   Dot  won 2            lost 1 (Ann) + 1 (Cat) = 2   difference  0
    // Cat is 4th on hole difference; Bea and Dot are level on it, and fewest
    // holes lost puts Dot (2) above Bea (3).
    const margins: Result[] = [
      ["ann", "bea", 1], ["ann", "cat", 1], ["ann", "dot", 1],
      ["bea", "cat", 3], ["cat", "dot", 1], ["dot", "bea", 2],
    ];
    expect(ranksInEveryOrder(["ann", "bea", "cat", "dot"], margins)).toEqual({ ann: 1, dot: 2, bea: 3, cat: 4 });
    // The chain is not started again for the two hole difference leaves level:
    // with no step after it, Bea and Dot share 2nd — though Dot beat Bea.
    expect(ranksInEveryOrder(["ann", "bea", "cat", "dot"], margins, ["head-to-head", "holes-won-ratio"])).toEqual({
      ann: 1, bea: 2, dot: 2, cat: 4,
    });
  });

  it("a cycle with a fourth who halved all three: the next step decides what it can, and the rest share", () => {
    //   Ann  b Cat, halves Bea, lost Eve      2 + 1 + 0 = 3
    //   Bea  halves Ann, Cat and Eve          1 + 1 + 1 = 3
    //   Cat  lost Ann, halves Bea, b Eve      0 + 1 + 2 = 3
    //   Eve  b Ann, halves Bea, lost Cat      2 + 1 + 0 = 3
    // All four level on 3. Mini-league among the four: Ann +1 -1 = 0, Bea 0,
    // Cat -1 +1 = 0, Eve +1 -1 = 0 — a cycle Ann > Cat > Eve > Ann, Bea halving
    // all three. Hole difference: Ann 1-1, Bea 0-0, Cat 1-1, Eve 1-1 — all 0.
    // Holes lost: Bea 0, the others 1 each. So Bea 1st, the three share 2nd.
    const level: Result[] = [
      ["ann", "cat", 1], ["ann", "bea", "halved"], ["eve", "ann", 1],
      ["bea", "cat", "halved"], ["bea", "eve", "halved"], ["cat", "eve", 1],
    ];
    expect(ranksInEveryOrder(["ann", "bea", "cat", "eve"], level)).toEqual({ bea: 1, ann: 2, cat: 2, eve: 2 });
  });

  it("a mini-league that DOES separate is used, though each pair of neighbours halved their own meeting", () => {
    // Ann b Cat; Ann halves Bea; Bea halves Cat (every win 1 up). Two
    // outsiders level the points: Ann loses to Eve and Fay; Bea halves Eve and
    // loses to Fay; Cat beats Eve and loses to Fay; Eve halves Fay.
    //   Ann  2 + 1 + 0 + 0   3      Eve  2 + 1 + 0 + 1   4
    //   Bea  1 + 1 + 1 + 0   3      Fay  2 + 2 + 2 + 1   7
    //   Cat  0 + 1 + 2 + 0   3
    // The committee's chain is head-to-head alone. The three's mini-league:
    // Ann +1, Bea 0, Cat -1 — three places, 3rd, 4th and 5th. Asked pair by
    // pair, Ann and Bea halved, and Bea and Cat halved, so all three "shared"
    // 3rd under the old rule.
    const results: Result[] = [
      ["ann", "cat", 1], ["ann", "bea", "halved"], ["bea", "cat", "halved"],
      ["eve", "ann", 1], ["fay", "ann", 1], ["bea", "eve", "halved"], ["fay", "bea", 1],
      ["cat", "eve", 1], ["fay", "cat", 1], ["eve", "fay", "halved"],
    ];
    expect(ranksInEveryOrder(["ann", "bea", "cat", "eve", "fay"], results, ["head-to-head"])).toEqual({
      fay: 1, eve: 2, ann: 3, bea: 4, cat: 5,
    });
  });

  it("a part still level after head-to-head is asked head-to-head AGAIN, over only itself", () => {
    // Four level on points, two outsiders. Within the four:
    //   Ann b Bea, Ann b Cat, Dot b Ann, Bea b Cat, Bea b Dot, Cat b Dot
    // Mini-league over the four: Ann +1 (b Bea, b Cat, lost Dot), Bea +1
    // (b Cat, b Dot, lost Ann), Cat -1, Dot -1. Asked again of {Ann, Bea}:
    // Ann beat Bea — Ann 1st, Bea 2nd. Of {Cat, Dot}: Cat beat Dot — Cat 3rd,
    // Dot 4th. The outsiders level the points: Ann and Bea beat Fay and lose
    // to Eve; Cat and Dot beat both; Eve and Fay halve.
    //   Ann  2 wins in the four (4) + b Fay (2) + lost Eve      6
    //   Bea  2 wins in the four (4) + b Fay (2) + lost Eve      6
    //   Cat  1 win  in the four (2) + b Eve, b Fay (4)          6
    //   Dot  1 win  in the four (2) + b Eve, b Fay (4)          6
    //   Eve  b Ann, b Bea (4) + halves Fay (1)                  5
    //   Fay  halves Eve                                         1
    // Hole difference (every win 1 up): Ann 3-2, Bea 3-2, Cat 3-2, Dot 3-2 —
    // all +1, so nothing but head-to-head can separate them, and the
    // pairwise rule with a handicap fallback put whoever was listed first of
    // Ann and Bea on top.
    const results: Result[] = [
      ["ann", "bea", 1], ["ann", "cat", 1], ["dot", "ann", 1], ["bea", "cat", 1], ["bea", "dot", 1], ["cat", "dot", 1],
      ["ann", "fay", 1], ["bea", "fay", 1], ["eve", "ann", 1], ["eve", "bea", 1],
      ["cat", "eve", 1], ["cat", "fay", 1], ["dot", "eve", 1], ["dot", "fay", 1],
      ["eve", "fay", "halved"],
    ];
    expect(ranksInEveryOrder(["ann", "bea", "cat", "dot", "eve", "fay"], results)).toEqual({
      ann: 1, bea: 2, cat: 3, dot: 4, eve: 5, fay: 6,
    });
  });

  it("a 4-player partial cycle: the mini-league puts one on top and the other three share the next place", () => {
    // Ann beats Bea, Cat and Dot; Bea b Cat, Cat b Dot, Dot b Bea. Bea, Cat
    // and Dot beat Eve and Fay; Ann loses to both; Eve b Fay. Every win 1 up.
    //   Ann  3 wins (6) + 0                       6
    //   Bea  b Cat (2) + b Eve, b Fay (4)         6
    //   Cat  b Dot (2) + b Eve, b Fay (4)         6
    //   Dot  b Bea (2) + b Eve, b Fay (4)         6
    //   Eve  b Ann, b Fay                          4
    //   Fay  b Ann                                 2
    // Mini-league of the four: Ann +3, the others -1 each. Asked again of
    // {Bea, Cat, Dot}: 0, 0, 0 — a cycle. Hole difference: each won 3, lost 2
    // (+1); holes lost 2 each. Ann 1st, the three share 2nd, Eve 5th, Fay 6th.
    const results: Result[] = [
      ["ann", "bea", 1], ["ann", "cat", 1], ["ann", "dot", 1], ["bea", "cat", 1], ["cat", "dot", 1], ["dot", "bea", 1],
      ["bea", "eve", 1], ["bea", "fay", 1], ["cat", "eve", 1], ["cat", "fay", 1], ["dot", "eve", 1], ["dot", "fay", 1],
      ["eve", "ann", 1], ["fay", "ann", 1], ["eve", "fay", 1],
    ];
    expect(ranksInEveryOrder(["ann", "bea", "cat", "dot", "eve", "fay"], results)).toEqual({
      ann: 1, bea: 2, cat: 2, dot: 2, eve: 5, fay: 6,
    });
  });

  it("a committee that CHOSE the handicap step has the cycle decided by it — the handicap, never the seed", () => {
    // Handicaps in `field`: Ann 30, Bea 29, Cat 28, Dot 27 — so Dot, Cat, Bea.
    expect(ranksInEveryOrder(["ann", "bea", "cat", "dot"], CYCLE, ["head-to-head", "lower-handicap"])).toEqual({
      ann: 1, dot: 2, cat: 3, bea: 4,
    });
  });

  it("an empty chain separates nobody: level on points is level", () => {
    expect(ranksInEveryOrder(["ann", "bea", "cat", "dot"], CYCLE, [])).toEqual({ ann: 1, bea: 2, cat: 2, dot: 2 });
  });

  it("a list still needs an order inside a shared place, and it is the seed — without being a place", () => {
    const { players, matches } = field(["ann", "bea", "cat", "dot"], CYCLE, [3, 2, 1, 0]);
    const rows = computeStandings(players, matches, DEFAULT_SCORING);
    // Seeds: Dot 1, Cat 2, Bea 3, Ann 4 — but the default chain's handicap
    // orders a shared place first (Dot 27, Cat 28, Bea 29): the list's order
    // as it has always been, the places shared.
    expect(rows.map((r) => [r.player.id, r.rank])).toEqual([["ann", 1], ["dot", 2], ["cat", 2], ["bea", 2]]);
  });
});

describe("the league of clubs, on the same rule", () => {
  const club = (name: string, over: Partial<ClubRecord> = {}): ClubRecord => ({
    clubId: name.toLowerCase(), name, points: 4, played: 3, won: 1, holesWon: 10, holesLost: 10, ...over,
  });
  const meetings = (pairs: Array<[string, string]>): HeadToHead => {
    const m: HeadToHead = new Map();
    const put = (a: string, b: string, v: number) => {
      if (!m.has(a)) m.set(a, new Map());
      m.get(a)!.set(b, v);
    };
    for (const [w, l] of pairs) {
      put(w, l, 1);
      put(l, w, -1);
    }
    return m;
  };

  it("three clubs beating each other in a circle go on to the next step together, whatever order they arrive in", () => {
    // Balfron b Cardross, Cardross b Drymen, Drymen b Balfron: a cycle, so
    // head-to-head decides nothing and hole difference does — Drymen +4,
    // Balfron +1, Cardross -5. The pairwise comparator this replaced gave an
    // order that depended on the order the rows came in.
    const rows = [
      club("Balfron", { holesWon: 11 }),
      club("Cardross", { holesWon: 5 }),
      club("Drymen", { holesWon: 14 }),
    ];
    const h2h = meetings([["balfron", "cardross"], ["cardross", "drymen"], ["drymen", "balfron"]]);
    for (const order of permutations(3)) {
      const shuffled = order.map((i) => rows[i]);
      expect(orderClubs(shuffled, ["head-to-head", "holes-won-ratio"], h2h).map((c) => c.name)).toEqual([
        "Drymen", "Balfron", "Cardross",
      ]);
      // With nothing after head-to-head the three are level, listed by name.
      expect(orderClubs(shuffled, ["head-to-head"], h2h).map((c) => c.name)).toEqual(["Balfron", "Cardross", "Drymen"]);
    }
  });

  it("a part still level is asked head-to-head again over only itself", () => {
    // Four clubs level on points. Ardlui b Balfron, Ardlui b Cardross, Drymen
    // b Ardlui, Balfron b Cardross, Balfron b Drymen, Cardross b Drymen:
    // Ardlui +1, Balfron +1, Cardross -1, Drymen -1; then Ardlui b Balfron and
    // Cardross b Drymen. The alphabet happens to agree here, so hole
    // difference is set against it.
    const rows = [
      club("Ardlui", { holesWon: 9 }), club("Balfron", { holesWon: 12 }),
      club("Cardross", { holesWon: 8 }), club("Drymen", { holesWon: 11 }),
    ];
    const h2h = meetings([
      ["ardlui", "balfron"], ["ardlui", "cardross"], ["drymen", "ardlui"],
      ["balfron", "cardross"], ["balfron", "drymen"], ["cardross", "drymen"],
    ]);
    for (const order of permutations(4)) {
      expect(orderClubs(order.map((i) => rows[i]), ["head-to-head", "holes-won-ratio"], h2h).map((c) => c.name)).toEqual([
        "Ardlui", "Balfron", "Cardross", "Drymen",
      ]);
    }
  });
});

describe("the resolver itself", () => {
  it("returns places: a cycle is one place, a separated group is several", () => {
    const beat: Record<string, string[]> = { a: ["b"], b: ["c"], c: ["a"] };
    const h2h = {
      score: (m: string, group: readonly string[]) =>
        group.reduce((s, o) => s + (beat[m]?.includes(o) ? 1 : beat[o]?.includes(m) ? -1 : 0), 0),
      regroup: true,
    };
    expect(placesOfLevelGroup(["c", "a", "b"], [h2h], (x, y) => x.localeCompare(y))).toEqual([["a", "b", "c"]]);
    const line: Record<string, string[]> = { a: ["b", "c"], b: ["c"] };
    const h2hLine = { ...h2h, score: (m: string, group: readonly string[]) =>
      group.reduce((s, o) => s + (line[m]?.includes(o) ? 1 : line[o]?.includes(m) ? -1 : 0), 0) };
    expect(placesOfLevelGroup(["c", "b", "a"], [h2hLine], (x, y) => x.localeCompare(y))).toEqual([["a"], ["b"], ["c"]]);
    expect(placesOfLevelGroup([], [h2h], () => 0)).toEqual([]);
  });
});

/**
 * ONE RULE, ONE PLACE: a ranking that applies the head-to-head step does it
 * through `level-places.ts`. The shape refused is a `case "head-to-head"` (the
 * step being applied) in a file that does not use the resolver — which is
 * exactly what `standings.ts` and `league-order.ts` each held before.
 */
describe("nobody applies head-to-head without the level-group resolver", () => {
  const SRC = join(process.cwd(), "src");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return name === "__tests__" || name === "node_modules" ? [] : files(path);
      return /\.(ts|tsx)$/.test(name) ? [path] : [];
    });
  const appliesHeadToHead = (code: string) => /case\s+["']head-to-head["']\s*:/.test(code);
  const usesResolver = (code: string) => /from\s+["'](?:\.\/|@\/lib\/domain\/)level-places["']/.test(code);

  it("CONTROL: the sweep sees the old shape", () => {
    const old = stripComments(`
      import type { TiebreakerKey } from "./types";
      function compareOn(key: TiebreakerKey, a, b, h2h) {
        switch (key) {
          case "head-to-head":
            return -(h2h.get(a.clubId)?.get(b.clubId) ?? 0);
        }
      }`);
    expect(appliesHeadToHead(old) && !usesResolver(old)).toBe(true);
  });

  it("every file that applies the step uses the resolver", () => {
    const offenders = files(SRC)
      .map((path) => ({ path, code: readSource(relative(process.cwd(), path)) }))
      .filter(({ code }) => appliesHeadToHead(code) && !usesResolver(code))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
    // And the sweep is not passing on nothing: the two rankings are found.
    const appliers = files(SRC).filter((path) => appliesHeadToHead(readSource(relative(process.cwd(), path))));
    expect(appliers.length).toBeGreaterThanOrEqual(2);
  });
});
