import { describe, it, expect } from "vitest";
import {
  orderGroups,
  groupByStandings,
  groupPosition,
  positionLookup,
  startSlots,
  addMinutes,
  DRAW_ORDERS,
  type Standing,
} from "../domain/draw";
import { formGroups } from "../domain/grouping";
import type { Group, Player } from "../domain/types";

/**
 * The draw.
 *
 * Grouping, running order and start style are three decisions, and these pin
 * them apart — the point of the module is that changing one does not silently
 * change another.
 */

const player = (id: string, seed: number): Player => ({ id, name: id.toUpperCase(), handicap: seed, seed });
const field = (n: number) => Array.from({ length: n }, (_, i) => player(`p${i + 1}`, i + 1));

const group = (id: string, ...ids: string[]): Group => ({ id, name: id, playerIds: ids });

/** p1 leads, p2 second, and so on. */
const straightStandings = (n: number): Standing[] =>
  Array.from({ length: n }, (_, i) => ({ playerId: `p${i + 1}`, position: i + 1 }));

describe("where a group sits in the draw", () => {
  it("takes its best-placed player", () => {
    // The convention on every tour sheet: a group with the leader in it is the
    // leading group, whoever else is in it.
    const pos = positionLookup([
      { playerId: "a", position: 40 },
      { playerId: "b", position: 3 },
      { playerId: "c", position: 22 },
    ]);
    expect(groupPosition(group("g", "a", "b", "c"), pos)).toBe(3);
  });

  it("puts anyone unranked at the back, not the front", () => {
    // A player with no position must not be read as position 0 and drawn out
    // with the leaders.
    const pos = positionLookup([{ playerId: "a", position: 5 }]);
    expect(pos("nobody")).toBe(Number.MAX_SAFE_INTEGER);
    expect(groupPosition(group("g", "nobody"), pos)).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("running order", () => {
  const groups = [group("g1", "p3"), group("g2", "p1"), group("g3", "p2")];
  const pos = positionLookup(straightStandings(3));

  it("sends the leaders out last by default convention", () => {
    // The last group off is the last group in, so the tournament finishes
    // where the lead is.
    const out = orderGroups(groups, "leaders-last", pos);
    expect(out.map((g) => g.id)).toEqual(["g1", "g3", "g2"]);
  });

  it("can send them out first instead", () => {
    const out = orderGroups(groups, "leaders-first", pos);
    expect(out.map((g) => g.id)).toEqual(["g2", "g3", "g1"]);
  });

  it("leaves the order alone when asked to", () => {
    expect(orderGroups(groups, "as-formed", pos).map((g) => g.id)).toEqual(["g1", "g2", "g3"]);
  });

  it("never mutates the array it was handed", () => {
    const original = [...groups];
    orderGroups(groups, "leaders-last", pos);
    expect(groups).toEqual(original);
  });

  it("keeps tied groups in the order they were formed, both ways round", () => {
    // Reversing a sorted array would flip the tiebreak too, so two groups
    // level on position would swap places purely because the order changed.
    const level = [group("a", "x"), group("b", "y"), group("c", "z")];
    const flat = positionLookup([
      { playerId: "x", position: 7 },
      { playerId: "y", position: 7 },
      { playerId: "z", position: 7 },
    ]);
    expect(orderGroups(level, "leaders-first", flat).map((g) => g.id)).toEqual(["a", "b", "c"]);
    expect(orderGroups(level, "leaders-last", flat).map((g) => g.id)).toEqual(["a", "b", "c"]);
  });

  it("shuffles on a random draw, keeping every group", () => {
    let s = 7;
    const rng = () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
    const many = Array.from({ length: 12 }, (_, i) => group(`g${i}`, `p${i}`));
    const out = orderGroups(many, "random", undefined, rng);
    expect(out).toHaveLength(12);
    expect(new Set(out.map((g) => g.id)).size).toBe(12);
  });

  it("marks which orders need a leaderboard", () => {
    // Round one has no standings, so the UI has to know which of these it can
    // offer.
    expect(DRAW_ORDERS.filter((d) => d.needsStandings).map((d) => d.key)).toEqual([
      "leaders-last",
      "leaders-first",
    ]);
  });
});

describe("grouping by position", () => {
  it("puts consecutive places together", () => {
    const groups = groupByStandings(field(8), positionLookup(straightStandings(8)), 4);
    expect(groups[0].playerIds).toEqual(["p1", "p2", "p3", "p4"]);
    expect(groups[1].playerIds).toEqual(["p5", "p6", "p7", "p8"]);
  });

  it("never leaves a one-ball: five in twos is 3 + 2", () => {
    // Nobody plays alone, so an odd field in twos has to contain one
    // three-ball. It goes at the TOP of the board, which puts the short group
    // at the bottom — under "leaders out last" that is the first group off the
    // tee, where every club puts it.
    const groups = groupByStandings(field(5), positionLookup(straightStandings(5)), 2);
    expect(groups.map((g) => g.playerIds.length)).toEqual([3, 2]);
    expect(groups[0].playerIds).toEqual(["p1", "p2", "p3"]);
  });

  it("leaves a lone player alone when they are the whole field", () => {
    const groups = groupByStandings(field(1), positionLookup(straightStandings(1)), 4);
    expect(groups).toHaveLength(1);
    expect(groups[0].playerIds).toEqual(["p1"]);
  });

  it("draws unranked players at the back", () => {
    // Someone added after round one has no position and must not displace a
    // player who has actually posted a score.
    const players = [...field(4), player("late", 99)];
    const groups = groupByStandings(players, positionLookup(straightStandings(4)), 2);
    expect(groups[groups.length - 1].playerIds).toContain("late");
    expect(groups[0].playerIds).toEqual(["p1", "p2", "p3"]);
  });

  it("keeps everyone", () => {
    const groups = groupByStandings(field(23), positionLookup(straightStandings(23)), 4);
    expect(groups.flatMap((g) => g.playerIds)).toHaveLength(23);
  });

  it("draws no five-ball out of nine players in fours", () => {
    /**
     * The audit's case, and the reason this rule stopped chunking on its own.
     * Nine cut into fixed fours leaves 4 + 4 + 1, and folding the single
     * forward — right in itself, nobody plays a one-ball — made a FIVE-ball.
     * There is no such group in a competition: four is the maximum, and the
     * sheet saved and published without a word.
     */
    const groups = groupByStandings(field(9), positionLookup(straightStandings(9)), 4);
    expect(groups.map((g) => g.playerIds.length)).toEqual([3, 3, 3]);
  });

  it("draws no five-ball when the whole field is five", () => {
    // The same arithmetic with one group in it: 4 + 1 folded to a single
    // five-ball, so the entire tee sheet was one illegal group.
    const groups = groupByStandings(field(5), positionLookup(straightStandings(5)), 4);
    expect(groups.map((g) => g.playerIds.length)).toEqual([3, 2]);
  });

  it("agrees with the other four rules on the same screen", () => {
    /**
     * The fault was never the arithmetic on its own — it was having a second
     * copy of it. "By position" sits beside Random, Balanced handicap,
     * Balanced skill and Seeded, and an organizer switching between them for
     * the same field expects the same shape of sheet out of all five.
     */
    const players = field(9);
    const mine = groupByStandings(players, positionLookup(straightStandings(9)), 4).map(
      (g) => g.playerIds.length,
    );
    for (const rule of ["random", "handicap", "balanced", "seeding", "manual"] as const) {
      const theirs = formGroups(players, rule, { mode: "perFlight", value: 4 }).map(
        (g) => g.playerIds.length,
      );
      expect(mine, rule).toEqual(theirs);
    }
  });

  it("puts the fuller groups at the top of the board", () => {
    // Ten in fours is 4 + 3 + 3. The leaders are in the full group and the
    // short one is last on the board, i.e. first off the tee.
    const sizes = groupByStandings(field(10), positionLookup(straightStandings(10)), 4).map(
      (g) => g.playerIds.length,
    );
    expect(sizes).toEqual([4, 3, 3]);
    expect([...sizes].sort((a, b) => b - a)).toEqual(sizes);
  });
});

describe("start times and tees", () => {
  const three = [group("g1", "a"), group("g2", "b"), group("g3", "c")];

  it("spaces a single-tee start by the interval", () => {
    const slots = startSlots(three, "tee", { firstTee: "08:00", interval: 10 });
    expect(slots.map((s) => s.time)).toEqual(["8:00 AM", "8:10 AM", "8:20 AM"]);
    expect(slots.every((s) => s.startHole === 1)).toBe(true);
  });

  it("sends two groups at a time off a split tee", () => {
    // The reason most club events use it: half the time to get a field away.
    const slots = startSlots(three, "split", { firstTee: "08:00", interval: 10 });
    expect(slots.map((s) => s.time)).toEqual(["8:00 AM", "8:00 AM", "8:10 AM"]);
    expect(slots.map((s) => s.startHole)).toEqual([1, 10, 1]);
  });

  it("splits off the 5th on a nine-hole course, which has no 10th tee", () => {
    const slots = startSlots(three, "split", { holes: 9 });
    expect(slots.map((s) => s.startHole)).toEqual([1, 5, 1]);
  });

  it("gives a shotgun one hole each and one time", () => {
    const many = Array.from({ length: 18 }, (_, i) => group(`g${i}`, `p${i}`));
    const slots = startSlots(many, "shotgun", { firstTee: "09:00" });
    expect(new Set(slots.map((s) => s.time))).toEqual(new Set(["9:00 AM"]));
    expect(slots.map((s) => s.startHole)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
    expect(slots.every((s) => s.half === undefined)).toBe(true);
  });

  it("doubles up as A and B when the field outgrows the course", () => {
    // A real arrangement, not an overflow error — 1A tees off, 1B follows.
    const many = Array.from({ length: 20 }, (_, i) => group(`g${i}`, `p${i}`));
    const slots = startSlots(many, "shotgun");
    expect(slots[0]).toMatchObject({ startHole: 1, half: "A" });
    expect(slots[18]).toMatchObject({ startHole: 1, half: "B" });
    expect(slots[19]).toMatchObject({ startHole: 2, half: "B" });
  });

  it("wraps a shotgun round nine holes on a nine-hole course", () => {
    const many = Array.from({ length: 9 }, (_, i) => group(`g${i}`, `p${i}`));
    const slots = startSlots(many, "shotgun", { holes: 9 });
    expect(slots.map((s) => s.startHole)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("gives every group exactly one slot", () => {
    for (const style of ["tee", "split", "shotgun"] as const) {
      expect(startSlots(three, style).map((s) => s.groupId), style).toEqual(["g1", "g2", "g3"]);
    }
  });
});

describe("the clock", () => {
  it("rolls over midday and midnight", () => {
    expect(addMinutes("08:00", 0)).toBe("8:00 AM");
    expect(addMinutes("11:55", 10)).toBe("12:05 PM");
    expect(addMinutes("23:50", 20)).toBe("12:10 AM");
  });

  it("falls back to 8am rather than rendering nonsense", () => {
    expect(addMinutes("not a time", 0)).toBe("8:00 AM");
  });
});

/**
 * No group is ever sent to a hole the course does not have.
 *
 * The harm the tee-sheet bug actually did. A nine-hole round drawn with the
 * wrong hole count put groups on the 10th tee of a nine-hole course — on the
 * sheet, on the published draw, and in each player's "your tee time".
 *
 * Asserted as an invariant over every start style and field size rather than a
 * fixture, because the fault was never in the arithmetic: `startSlots` was
 * always right about the number it was handed. What no test covered was that a
 * start hole must lie on the course at all.
 */
describe("a start hole is always on the course", () => {
  const groupsOf = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `g${i + 1}`,
      name: `G${i + 1}`,
      playerIds: [`p${i}a`, `p${i}b`],
    }));

  for (const holes of [9, 18] as const) {
    for (const style of ["tee", "split", "shotgun"] as const) {
      for (const n of [1, 2, 3, 5, 9, 10, 12, 19, 28]) {
        it(`${style} start, ${n} groups over ${holes} holes`, () => {
          const slots = startSlots(groupsOf(n), style, { holes, firstTee: "08:00", interval: 10 });
          for (const s of slots) {
            expect(s.startHole, `${s.groupId} sent to hole ${s.startHole}`).toBeGreaterThanOrEqual(1);
            expect(s.startHole, `${s.groupId} sent to hole ${s.startHole} of ${holes}`).toBeLessThanOrEqual(holes);
          }
        });
      }
    }
  }

  it("splits a nine off the 1st and the 5th, not the 10th", () => {
    // The concrete case: two groups, nine holes. The second tee has to be a
    // hole that exists, and on a nine that is the 5th.
    const slots = startSlots(groupsOf(2), "split", { holes: 9 });
    expect(slots.map((s) => s.startHole).sort()).toEqual([1, 5]);
  });

  it("still splits an eighteen off the 1st and the 10th", () => {
    const slots = startSlots(groupsOf(2), "split", { holes: 18 });
    expect(slots.map((s) => s.startHole).sort()).toEqual([1, 10]);
  });

  it("doubles a shotgun back onto the course rather than inventing holes", () => {
    // Ten groups on a nine: somebody shares a tee. Nobody goes to a 10th.
    const slots = startSlots(groupsOf(10), "shotgun", { holes: 9 });
    expect(Math.max(...slots.map((s) => s.startHole))).toBeLessThanOrEqual(9);
    expect(new Set(slots.map((s) => s.startHole)).size).toBe(9);
  });
});
