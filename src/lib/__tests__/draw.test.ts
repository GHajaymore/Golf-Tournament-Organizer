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

  it("folds a trailing single into the group in front", () => {
    // Nobody plays a one-ball. Five players in twos is 2 + 3, not 2 + 2 + 1.
    const groups = groupByStandings(field(5), positionLookup(straightStandings(5)), 2);
    expect(groups).toHaveLength(2);
    expect(groups[1].playerIds).toEqual(["p3", "p4", "p5"]);
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
    expect(groups[0].playerIds).toEqual(["p1", "p2"]);
  });

  it("keeps everyone", () => {
    const groups = groupByStandings(field(23), positionLookup(straightStandings(23)), 4);
    expect(groups.flatMap((g) => g.playerIds)).toHaveLength(23);
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
