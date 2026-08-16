import { describe, it, expect } from "vitest";
import { computeStandings } from "@/lib/domain/standings";
import { marginToHoles } from "@/lib/domain/match";
import { DEFAULT_SCORING } from "@/lib/domain/types";
import type { Player, Match } from "@/lib/domain/types";

/**
 * The ranking comparator has to be a total order.
 *
 * It was not. `head-to-head` is pairwise, and a cycle — A beat B, B beat C,
 * C beat A — is an ordinary week in a round robin. Handed an intransitive
 * comparator, `Array.sort` returns whatever its algorithm reaches, so the
 * standings depended on things that are not results: the order the players
 * happened to arrive in, and how many other people were in the field. The
 * audit caught the second one (two players level on points ranking one way
 * over a field of 24 and the other way over 28).
 *
 * These tests assert the invariant underneath both symptoms rather than the
 * anecdote: the same results must produce the same standings, full stop. The
 * field-size version of the bug is V8-sort-specific and would make a brittle
 * test; permutation is the same defect and reproduces on any engine. Before
 * the fix the property test below failed within the first few seeds.
 */

const seeded = (seed: number) => {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
};

/**
 * A field where everyone is dead level on points and the only thing telling
 * them apart is who beat whom — the condition the tiebreaker chain exists for,
 * and the one where an intransitive comparator shows.
 */
function levelField(n: number, seed: number) {
  const rand = seeded(seed);
  const players: Player[] = Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: `Player ${i}`,
    handicap: 10,
    seed: i + 1,
  }));

  const edges: [number, number][] = [];
  for (let a = 0; a < n; a += 1) {
    for (let b = a + 1; b < n; b += 1) {
      if (rand() < 0.4) edges.push(rand() < 0.5 ? [a, b] : [b, a]);
    }
  }
  const matches = edges.map(([a, b], i) => ({
    id: `m${i}`,
    stageId: "s",
    groupId: "g",
    round: i + 1,
    playerAId: `p${a}`,
    playerBId: `p${b}`,
    // Every result the same margin, so holes won and holes lost cannot quietly
    // do the tiebreaking for us and hide the defect.
    holes: marginToHoles("A", "2&1", 18),
  })) as Match[];

  // Level the points by carrying in the complement of what was won.
  const carried: Record<string, number> = {};
  for (const p of players) carried[p.id] = 500;
  for (const [a] of edges) carried[`p${a}`] -= DEFAULT_SCORING.winPts;

  return { players, matches, carried };
}

const rankOf = (players: Player[], matches: Match[], carried: Record<string, number>) =>
  computeStandings(players, matches, DEFAULT_SCORING, carried).map((r) => r.player.id);

describe("standings are a function of results, not of array order", () => {
  it("ranks the same field identically however the players are shuffled", () => {
    for (let seed = 1; seed <= 25; seed += 1) {
      for (const n of [6, 8, 12, 24]) {
        const { players, matches, carried } = levelField(n, seed);
        const expected = rankOf(players, matches, carried);

        const rand = seeded(seed * 7919);
        for (let attempt = 0; attempt < 20; attempt += 1) {
          const shuffled = [...players];
          for (let i = shuffled.length - 1; i > 0; i -= 1) {
            const j = Math.floor(rand() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
          }
          expect(rankOf(shuffled, matches, carried), `seed ${seed}, field ${n}`).toEqual(expected);
        }
      }
    }
  });

  it("does not move a tied pair when unrelated players join the tournament", () => {
    // The audit's own symptom. The newcomers played nobody, so they cannot
    // have changed anyone's head-to-head — only the length of the array.
    const { players, matches, carried } = levelField(20, 3);
    const before = rankOf(players, matches, carried);

    for (const extra of [1, 4, 8]) {
      const grown = [...players];
      const grownCarried = { ...carried };
      for (let i = 0; i < extra; i += 1) {
        const id = `late${i}`;
        grown.push({ id, name: `Late ${i}`, handicap: 10, seed: 100 + i });
        grownCarried[id] = 500;
      }
      const after = rankOf(grown, matches, grownCarried).filter((id) => !id.startsWith("late"));
      expect(after, `${extra} late entries`).toEqual(before);
    }
  });
});

describe("the mini-league", () => {
  const three = (): Player[] => [
    { id: "A", name: "A", handicap: 10, seed: 1 },
    { id: "B", name: "B", handicap: 10, seed: 2 },
    { id: "C", name: "C", handicap: 10, seed: 3 },
  ];
  const beat = (id: string, w: string, l: string): Match =>
    ({
      id,
      stageId: "s",
      groupId: "g",
      round: 1,
      playerAId: w,
      playerBId: l,
      holes: marginToHoles("A", "2&1", 18),
    }) as Match;

  it("settles a three-way cycle deterministically instead of by luck", () => {
    // A beat B, B beat C, C beat A: one win and one loss each, so all three are
    // level and the mini-league is 0 all round. There is no head-to-head answer
    // here and pretending there is one is the bug — the chain has to fall
    // through to the next tiebreaker, and it has to do so the same way twice.
    const players = three();
    const matches = [beat("ab", "A", "B"), beat("bc", "B", "C"), beat("ca", "C", "A")];

    const order = rankOf(players, matches, {});
    expect(rankOf([...players].reverse(), matches, {})).toEqual(order);
    expect(rankOf([players[1], players[2], players[0]], matches, {})).toEqual(order);
    // Everything downstream of head-to-head is level too, so it lands on seed.
    expect(order).toEqual(["A", "B", "C"]);
  });

  it("still gives a straight two-way tie to whoever won the meeting", () => {
    // The common case, and the one people actually expect. A mini-league of two
    // is exactly the old rule, so the fix must not have changed this.
    const players = three().slice(0, 2);
    const matches = [beat("ab", "B", "A")];
    expect(rankOf(players, matches, { A: DEFAULT_SCORING.winPts })).toEqual(["B", "A"]);
  });

  it("counts only results against the players actually tied", () => {
    // A and B are level; both played C, who is not. A beat C and B lost to C,
    // which under a whole-field tally would put A ahead. It must not: C is in a
    // different position on the table and their results are not A and B's tie
    // to break. B beat A, so B takes it.
    const players = three();
    const matches = [beat("ac", "A", "C"), beat("cb", "C", "B"), beat("ba", "B", "A")];

    // A: beat C, lost to B = 3. B: beat A, lost to C = 3. C: beat B, lost to A = 3.
    // Carry C clear of the tie so only A and B are level.
    const order = rankOf(players, matches, { C: 100 });
    expect(order[0]).toBe("C");
    expect(order.slice(1)).toEqual(["B", "A"]);
  });
});
