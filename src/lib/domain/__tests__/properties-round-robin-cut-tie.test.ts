import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { computeStandings } from "../standings";
import { roundRobinCutOutcome, CUT_TIE_RULES, survivorCount, type CutTieRule } from "../cut";
import { DEFAULT_SCORING, type HoleResult, type Match, type Player } from "../types";

/**
 * PROPERTIES OF A ROUND ROBIN'S CUT LINE (J31, 2026-11-06), checked against a
 * second route to the same answer.
 *
 * Random flights of random round robins — every meeting won 1 up, won 2 up, or
 * halved — ranked by the app's own table, then cut. The reference does not read
 * the table's order or its rows' points: it counts each player's points off the
 * list of results (win 2, halve 1 — the app's default) and works the line from
 * those numbers, as a committee would with a pencil. Committee Procedures 5A(6):
 * a tie at the line is settled by the method the committee published, so:
 *
 *   - "ties"      everybody on at least the N-th best points goes through;
 *   - a play-off  everybody above it goes through, and if more are on it than
 *                 there are places left, exactly they are owed a play-off;
 *   - a countback the table's shared places decide it, and a draw is owed only
 *                 for players the table could not separate.
 *
 * And the property the old cut failed: who goes through on points does not
 * depend on the ORDER the players entered.
 */
const RUNS = { seed: 20261106, numRuns: 400 } as const;

type Result = "A" | "B" | "AA" | "BB" | "H";
const holesOf = (r: Result): HoleResult[] => {
  const rest = (k: number) => new Array<HoleResult>(18 - k).fill("H");
  if (r === "H") return rest(0);
  if (r === "A" || r === "B") return [r, ...rest(1)];
  return [r[0] as HoleResult, r[0] as HoleResult, ...rest(2)];
};
const pointsFor = (r: Result, side: "A" | "B") => (r === "H" ? 1 : r[0] === side ? 2 : 0);

/** A field: flight sizes, every meeting's result, and an entry order. */
const fieldArb = fc
  .array(fc.integer({ min: 1, max: 7 }), { minLength: 1, maxLength: 3 })
  .chain((sizes) => {
    const total = sizes.reduce((a, b) => a + b, 0);
    const meetings = sizes.reduce((a, m) => a + (m * (m - 1)) / 2, 0);
    return fc.record({
      sizes: fc.constant(sizes),
      results: fc.array(fc.constantFrom<Result>("A", "B", "AA", "BB", "H"), { minLength: meetings, maxLength: meetings }),
      order: fc.shuffledSubarray(Array.from({ length: total }, (_, i) => i), { minLength: total, maxLength: total }),
      count: fc.integer({ min: 1, max: 8 }),
      tie: fc.constantFrom<CutTieRule>(...CUT_TIE_RULES),
    });
  });

function build(sizes: number[], results: Result[], order: number[]) {
  const players: Player[] = [];
  sizes.forEach((m, g) => {
    for (let i = 0; i < m; i += 1) players.push({ id: `f${g}p${i}`, name: `f${g}p${i}`, handicap: 0, seed: 0, groupId: `f${g}` });
  });
  // The entry order — what the old cut fell back on.
  order.forEach((at, i) => (players[at].seed = i + 1));
  const matches: Match[] = [];
  const points = new Map(players.map((p) => [p.id, 0]));
  let k = 0;
  sizes.forEach((m, g) => {
    for (let i = 0; i < m; i += 1) {
      for (let j = i + 1; j < m; j += 1) {
        const r = results[k++];
        const a = `f${g}p${i}`;
        const b = `f${g}p${j}`;
        matches.push({ id: `${a}-${b}`, stageId: "r1", groupId: `f${g}`, round: 1, playerAId: a, playerBId: b, holes: holesOf(r) });
        points.set(a, points.get(a)! + pointsFor(r, "A"));
        points.set(b, points.get(b)! + pointsFor(r, "B"));
      }
    }
  });
  return { players, matches, points, table: computeStandings(players, matches, DEFAULT_SCORING) };
}

const next = (count: number, tie: CutTieRule) => ({
  cutScope: "perFlight",
  cutMode: "count",
  cutCount: count,
  cutPercent: 50,
  cutTies: tie,
  cutTieDecisions: "[]",
});
const sorted = (ids: Iterable<string>) => [...ids].sort();

describe("a round robin's cut line, against a pencil", () => {
  it("goes through, or is owed a tie, exactly as the points and the shared places say", () => {
    fc.assert(
      fc.property(fieldArb, ({ sizes, results, order, count, tie }) => {
        const { players, points, table } = build(sizes, results, order);
        const out = roundRobinCutOutcome(table, next(count, tie));
        const owed = out.undecided.flatMap((u) => u.playerIds);
        expect(owed.filter((id) => out.through.has(id))).toEqual([]);
        sizes.forEach((m, g) => {
          const ids = players.filter((p) => p.groupId === `f${g}`).map((p) => p.id);
          const k = survivorCount({ scope: "perFlight", mode: "count", count, percent: 50 }, m);
          const throughHere = ids.filter((id) => out.through.has(id));
          const owedHere = out.undecided.filter((u) => u.groupId === `f${g}`);
          if (tie === "countback") {
            // The table's places, read as numbers: the k-th best place, and who is on it.
            const rank = new Map(table.map((r) => [r.player.id, r.rank]));
            const R = ids.map((id) => rank.get(id)!).sort((a, b) => a - b)[k - 1];
            const atOrAbove = ids.filter((id) => rank.get(id)! <= R);
            if (atOrAbove.length > k) {
              expect(sorted(throughHere)).toEqual(sorted(ids.filter((id) => rank.get(id)! < R)));
              expect(owedHere.map((u) => [sorted(u.playerIds), u.places, u.by])).toEqual([
                [sorted(ids.filter((id) => rank.get(id) === R)), k - ids.filter((id) => rank.get(id)! < R).length, "draw"],
              ]);
            } else {
              expect(sorted(throughHere)).toEqual(sorted(atOrAbove));
              expect(owedHere).toEqual([]);
            }
            return;
          }
          // Points, by pencil: the k-th best total is the line.
          const L = ids.map((id) => points.get(id)!).sort((a, b) => b - a)[k - 1];
          const onOrAbove = ids.filter((id) => points.get(id)! >= L);
          const above = ids.filter((id) => points.get(id)! > L);
          if (tie === "ties" || onOrAbove.length === k) {
            expect(sorted(throughHere)).toEqual(sorted(onOrAbove));
            expect(owedHere).toEqual([]);
          } else {
            expect(sorted(throughHere)).toEqual(sorted(above));
            expect(owedHere.map((u) => [sorted(u.playerIds), u.places, u.by])).toEqual([
              [sorted(ids.filter((id) => points.get(id) === L)), k - above.length, "playoff"],
            ]);
          }
        });
      }),
      RUNS,
    );
  });

  it("does not depend on the order the players entered, where the points decide it", () => {
    fc.assert(
      fc.property(
        fieldArb,
        fc.integer({ min: 0, max: 1000 }),
        ({ sizes, results, order, count, tie }, salt) => {
          if (tie === "countback") return; // the table's places are the table's business
          const again = [...order].sort((a, b) => ((a * 7919 + salt) % 97) - ((b * 7919 + salt) % 97));
          const one = roundRobinCutOutcome(build(sizes, results, order).table, next(count, tie));
          const two = roundRobinCutOutcome(build(sizes, results, again).table, next(count, tie));
          expect(sorted(one.through)).toEqual(sorted(two.through));
          expect(one.undecided.map((u) => sorted(u.playerIds))).toEqual(two.undecided.map((u) => sorted(u.playerIds)));
        },
      ),
      RUNS,
    );
  });

  it("once every owed tie is recorded, each flight sends exactly N (a play-off or a countback)", () => {
    fc.assert(
      fc.property(fieldArb, ({ sizes, results, order, count, tie }) => {
        if (tie === "ties") return;
        const { players, table } = build(sizes, results, order);
        const out = roundRobinCutOutcome(table, next(count, tie));
        const decisions = out.undecided.map((u) => ({ tied: u.playerIds, through: u.playerIds.slice(-u.places) }));
        const settled = roundRobinCutOutcome(table, { ...next(count, tie), cutTieDecisions: JSON.stringify(decisions) });
        expect(settled.undecided).toEqual([]);
        sizes.forEach((m, g) => {
          const went = players.filter((p) => p.groupId === `f${g}` && settled.through.has(p.id)).length;
          expect(went).toBe(Math.min(count, m));
        });
      }),
      RUNS,
    );
  });
});
