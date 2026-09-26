import { describe, it, expect } from "vitest";
import { groupBySides } from "../draw";

/**
 * PARTNERS GO OUT TOGETHER.
 *
 * Found 2026-09-26 running a Scramble as a newcomer: the tee sheet dealt the
 * field player by player, so side 1 (Eve, Finn, Ada, Dev) had Dev and Finn off
 * at 8:00 and Ada and Eve at 8:10. A scramble side hits one ball between them —
 * that sheet cannot be played. The same is true of every team format: partners
 * play together.
 *
 * The rule is asserted as an INVARIANT over many shapes, not just the case that
 * was seen: no side is ever split across groups, and every player is on the
 * sheet exactly once.
 */

const side = (name: string, n: number) => Array.from({ length: n }, (_, i) => `${name}${i}`);
const groupOf = (groups: { playerIds: string[] }[], id: string) =>
  groups.findIndex((g) => g.playerIds.includes(id));

describe("tee groups made from sides", () => {
  it("sends each scramble side of four out as its own group", () => {
    const a = ["eve", "finn", "ada", "dev"];
    const b = ["cleo", "hana", "gus", "ben"];
    const groups = groupBySides([a, b], [], 4);
    expect(groups.map((g) => g.playerIds)).toEqual([a, b]);
  });

  it("puts two four-ball pairs together in one group", () => {
    const groups = groupBySides([side("a", 2), side("b", 2), side("c", 2), side("d", 2)], [], 4);
    expect(groups.map((g) => g.playerIds.length)).toEqual([4, 4]);
    expect(groups[0].playerIds).toEqual([...side("a", 2), ...side("b", 2)]);
  });

  it("never cuts a side bigger than the group size — it goes out whole", () => {
    const groups = groupBySides([side("a", 4)], [], 3);
    expect(groups).toHaveLength(1);
    expect(groups[0].playerIds).toHaveLength(4);
  });

  it("starts a new group rather than splitting a side that won't fit", () => {
    // 3 + 2 > 4, so the three-ball goes out and the pair starts the next group.
    const groups = groupBySides([side("a", 3), side("b", 2), side("c", 2)], [], 4);
    expect(groups.map((g) => g.playerIds.length)).toEqual([3, 4]);
  });

  it("still places anybody on no side, after the sides", () => {
    const groups = groupBySides([side("a", 4)], ["x", "y"], 4);
    expect(groups.map((g) => g.playerIds)).toEqual([side("a", 4), ["x", "y"]]);
  });

  it("keeps every side whole and every player once, over many shapes", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let trial = 0; trial < 300; trial++) {
      const sides = Array.from({ length: 1 + Math.floor(rand() * 9) }, (_, s) => side(`t${trial}s${s}_`, 1 + Math.floor(rand() * 4)));
      const others = Array.from({ length: Math.floor(rand() * 3) }, (_, i) => `t${trial}x${i}`);
      const size = 2 + Math.floor(rand() * 3);
      const groups = groupBySides(sides, others, size);

      for (const s of sides) {
        const where = new Set(s.map((id) => groupOf(groups, id)));
        expect(where.size, `side split in trial ${trial}`).toBe(1);
      }
      const all = groups.flatMap((g) => g.playerIds);
      expect(new Set(all).size, `duplicate in trial ${trial}`).toBe(all.length);
      expect(all.length).toBe(sides.flat().length + others.length);
    }
  });
});
