import { describe, it, expect } from "vitest";
import {
  DRAW_ORDERS,
  positionLookup,
  groupPosition,
  orderGroups,
  groupByStandings,
  groupBySides,
  sidesByMatch,
  addMinutes,
  startSlots,
  sidesByStandings,
} from "../draw";
import type { Group, Player } from "../types";

/**
 * Survivors of the Stryker run on `draw.ts` (J49). Every expectation is worked
 * by counting by hand (who is in front of whom, how many fit in a group, what
 * the clock reads ten minutes on), never from the output of the code. Invented
 * ids only. Random orders are driven by a pinned stand-in for `Math.random`.
 */

const grp = (id: string, ...playerIds: string[]): Group => ({ id, name: id, playerIds });
const ids = (gs: Group[]) => gs.map((g) => g.id);
const player = (id: string): Player => ({ id, name: id, handicap: 10 }) as unknown as Player;
const field = (n: number) => Array.from({ length: n }, (_, i) => player(`p${i + 1}`));
const pos = (m: Record<string, number>) => positionLookup(Object.entries(m).map(([playerId, position]) => ({ playerId, position })));

describe("DRAW_ORDERS", () => {
  it("offers the four orders, the two that need a board first", () => {
    expect(DRAW_ORDERS.map((o) => [o.key, o.label, o.needsStandings])).toEqual([
      ["leaders-last", "Leaders out last", true],
      ["leaders-first", "Leaders out first", true],
      ["as-formed", "As grouped", false],
      ["random", "Random draw", false],
    ]);
    for (const o of DRAW_ORDERS) expect(o.blurb.length).toBeGreaterThan(40);
  });
});

describe("positionLookup", () => {
  it("returns the board position, including a leader at 0, and puts anyone unranked at the very back", () => {
    const of = positionLookup([
      { playerId: "a", position: 1 },
      { playerId: "z", position: 0 },
    ]);
    expect(of("a")).toBe(1);
    expect(of("z")).toBe(0);
    expect(of("nobody")).toBe(Number.MAX_SAFE_INTEGER);
    expect(positionLookup([])("a")).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("groupPosition", () => {
  it("is the best-placed player's place; an empty group goes to the back", () => {
    const of = pos({ a: 7, b: 3, c: 9 });
    expect(groupPosition(grp("g", "a", "b", "c"), of)).toBe(3);
    expect(groupPosition(grp("g", "c"), of)).toBe(9);
    expect(groupPosition(grp("g"), of)).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("orderGroups", () => {
  const g1 = grp("g1", "a"); // position 5
  const g2 = grp("g2", "b", "c"); // best is 1
  const g3 = grp("g3", "d"); // position 3
  const g4 = grp("g4", "e"); // position 3, ties g3
  const of = pos({ a: 5, b: 2, c: 1, d: 3, e: 3 });
  const all = [g1, g2, g3, g4];

  it("as-formed keeps the incoming order in a copy, never the same array", () => {
    const out = orderGroups(all, "as-formed", of);
    expect(ids(out)).toEqual(["g1", "g2", "g3", "g4"]);
    expect(out).not.toBe(all);
  });

  it("leaders-first puts the best-placed group first, ties in the order they came", () => {
    expect(ids(orderGroups(all, "leaders-first", of))).toEqual(["g2", "g3", "g4", "g1"]);
  });

  it("leaders-last is the other way about, but the tie still keeps its incoming order", () => {
    // Worst first: g1 (5), then the 3s in the order given (g3, g4), then g2 (1).
    expect(ids(orderGroups(all, "leaders-last", of))).toEqual(["g1", "g3", "g4", "g2"]);
  });

  it("does not disturb the groups it was given", () => {
    orderGroups(all, "leaders-last", of);
    orderGroups(all, "random", of, () => 0);
    expect(ids(all)).toEqual(["g1", "g2", "g3", "g4"]);
  });

  it("with no board every group is level, so both orders keep the sheet as formed", () => {
    expect(ids(orderGroups(all, "leaders-first"))).toEqual(["g1", "g2", "g3", "g4"]);
    expect(ids(orderGroups(all, "leaders-last"))).toEqual(["g1", "g2", "g3", "g4"]);
  });

  it("an unranked group is last under leaders-first and first under leaders-last", () => {
    const lone = grp("new", "zz");
    expect(ids(orderGroups([lone, g1, g2], "leaders-first", of))).toEqual(["g2", "g1", "new"]);
    expect(ids(orderGroups([g1, g2, lone], "leaders-last", of))).toEqual(["new", "g1", "g2"]);
  });

  it("an empty group counts as unranked", () => {
    const empty = grp("empty");
    expect(ids(orderGroups([empty, g1], "leaders-first", of))).toEqual(["g1", "empty"]);
  });

  it("random walks the shuffle from the back, j = floor(rng * (i + 1))", () => {
    // [g1 g2 g3 g4] with rng 0: i=3 swaps 3<->0 -> g4 g2 g3 g1; i=2 swaps 2<->0 -> g3 g2 g4 g1;
    // i=1 swaps 1<->0 -> g2 g3 g4 g1.
    expect(ids(orderGroups(all, "random", of, () => 0))).toEqual(["g2", "g3", "g4", "g1"]);
    // rng just under 1 always picks i itself: nothing moves.
    expect(ids(orderGroups(all, "random", of, () => 0.999))).toEqual(["g1", "g2", "g3", "g4"]);
    // rng 0.5: i=3 j=2 -> g1 g2 g4 g3; i=2 j=1 -> g1 g4 g2 g3; i=1 j=1 -> no change.
    expect(ids(orderGroups(all, "random", of, () => 0.5))).toEqual(["g1", "g4", "g2", "g3"]);
  });

  it("random draws one number for each place after the first, and none for one group or none", () => {
    let calls = 0;
    const rng = () => {
      calls += 1;
      return 0;
    };
    orderGroups(all, "random", of, rng);
    expect(calls).toBe(3);
    calls = 0;
    expect(ids(orderGroups([g1], "random", of, rng))).toEqual(["g1"]);
    expect(orderGroups([], "random", of, rng)).toEqual([]);
    expect(calls).toBe(0);
  });

  it("random with the default generator is still every group exactly once", () => {
    const out = orderGroups(all, "random");
    expect(ids(out).sort()).toEqual(["g1", "g2", "g3", "g4"]);
  });
});

describe("groupByStandings", () => {
  const board = (n: number) => pos(Object.fromEntries(Array.from({ length: n }, (_, i) => [`p${i + 1}`, i + 1])));

  it("cuts the board in order: nearest on the board play together", () => {
    const out = groupByStandings(field(8), board(8), 4);
    expect(out.map((g) => g.playerIds)).toEqual([
      ["p1", "p2", "p3", "p4"],
      ["p5", "p6", "p7", "p8"],
    ]);
    expect(out.map((g) => [g.id, g.name])).toEqual([
      ["group-0", "Group 1"],
      ["group-1", "Group 2"],
    ]);
  });

  it("sorts by position, not by the order the field came in; ties keep the field's order", () => {
    const of = pos({ p1: 3, p2: 1, p3: 3, p4: 2 });
    const out = groupByStandings(field(4), of, 2);
    expect(out.map((g) => g.playerIds)).toEqual([
      ["p2", "p4"],
      ["p1", "p3"],
    ]);
  });

  it("puts anyone unranked at the back", () => {
    const of = pos({ p3: 1, p4: 2 });
    const out = groupByStandings(field(4), of, 2);
    expect(out.map((g) => g.playerIds)).toEqual([
      ["p3", "p4"],
      ["p1", "p2"],
    ]);
  });

  it("never draws a five-ball: nine in fours is 3+3+3, five in fours is 3+2, seven is 4+3", () => {
    expect(groupByStandings(field(9), board(9), 4).map((g) => g.playerIds.length)).toEqual([3, 3, 3]);
    expect(groupByStandings(field(5), board(5), 4).map((g) => g.playerIds.length)).toEqual([3, 2]);
    expect(groupByStandings(field(7), board(7), 4).map((g) => g.playerIds.length)).toEqual([4, 3]);
  });

  it("a field of one is one group of one; an empty field is no groups", () => {
    expect(groupByStandings(field(1), board(1), 4).map((g) => g.playerIds)).toEqual([["p1"]]);
    expect(groupByStandings([], board(0), 4)).toEqual([]);
  });

  it("a size below two, or not a number, is read as twos; a fraction is rounded", () => {
    const sizes = (n: number, size: number) => groupByStandings(field(n), board(n), size).map((g) => g.playerIds.length);
    expect(sizes(6, 0)).toEqual([2, 2, 2]);
    expect(sizes(6, 1)).toEqual([2, 2, 2]);
    expect(sizes(6, -3)).toEqual([2, 2, 2]);
    expect(sizes(6, Number.NaN)).toEqual([2, 2, 2]);
    // 3.6 rounds to 4 (two groups of 4 and 4 from 8), where 3 would make three groups.
    expect(sizes(8, 3.6)).toEqual([4, 4]);
    // 2.4 rounds to 2.
    expect(sizes(8, 2.4)).toEqual([2, 2, 2, 2]);
  });

  it("an odd field in twos holds exactly one three-ball", () => {
    expect(groupByStandings(field(5), board(5), 2).map((g) => g.playerIds.length)).toEqual([3, 2]);
  });

  it("uses the id maker it is given, from zero", () => {
    const out = groupByStandings(field(4), board(4), 2, (i) => `tee-${i * 10}`);
    expect(out.map((g) => g.id)).toEqual(["tee-0", "tee-10"]);
  });
});

describe("groupBySides", () => {
  const sets = (gs: Group[]) => gs.map((g) => g.playerIds);

  it("packs whole sides: two pairs make a four-ball, the odd pair goes out alone", () => {
    expect(sets(groupBySides([["a", "b"], ["c", "d"], ["e", "f"]], [], 4))).toEqual([["a", "b", "c", "d"], ["e", "f"]]);
  });

  it("a side that will not fit beside the group being built starts the next group", () => {
    expect(sets(groupBySides([["a", "b", "c"], ["d", "e"]], [], 4))).toEqual([["a", "b", "c"], ["d", "e"]]);
  });

  it("a side that exactly fills the group closes it, with no empty group left behind", () => {
    expect(sets(groupBySides([["a", "b"], ["c", "d"]], [], 4))).toEqual([["a", "b", "c", "d"]]);
    expect(sets(groupBySides([["a"], ["b"], ["c"]], [], 3))).toEqual([["a", "b", "c"]]);
  });

  it("a side larger than the size goes out whole, and alone, never cut", () => {
    expect(sets(groupBySides([["a", "b", "c", "d", "e"], ["f"]], [], 4))).toEqual([["a", "b", "c", "d", "e"], ["f"]]);
    expect(sets(groupBySides([["f"], ["a", "b", "c", "d", "e"]], [], 4))).toEqual([["f"], ["a", "b", "c", "d", "e"]]);
  });

  it("an empty side is skipped", () => {
    expect(sets(groupBySides([[], ["a", "b"], []], [], 4))).toEqual([["a", "b"]]);
    expect(groupBySides([[]], [], 4)).toEqual([]);
  });

  it("players on no side follow, in groups of the size asked, nobody dropped", () => {
    expect(sets(groupBySides([["a", "b"]], ["x", "y", "z", "w", "v"], 2))).toEqual([["a", "b"], ["x", "y"], ["z", "w"], ["v"]]);
  });

  it("no sides and no others is no groups", () => {
    expect(groupBySides([], [], 4)).toEqual([]);
  });

  it("a size below two or not a number is read as twos; a fraction rounds", () => {
    expect(sets(groupBySides([["a"], ["b"], ["c"]], [], 0))).toEqual([["a", "b"], ["c"]]);
    expect(sets(groupBySides([["a"], ["b"], ["c"]], [], 1))).toEqual([["a", "b"], ["c"]]);
    expect(sets(groupBySides([["a"], ["b"], ["c"]], [], Number.NaN))).toEqual([["a", "b"], ["c"]]);
    expect(sets(groupBySides([["a"], ["b"], ["c"], ["d"]], [], 3.6))).toEqual([["a", "b", "c", "d"]]);
    expect(sets(groupBySides([["a"], ["b"], ["c"]], [], 2.4))).toEqual([["a", "b"], ["c"]]);
  });

  it("names and ids run through the sides and the others alike, from zero", () => {
    const out = groupBySides([["a", "b"]], ["x"], 2, (i) => `id${i}`);
    expect(out.map((g) => [g.id, g.name])).toEqual([
      ["id0", "Group 1"],
      ["id1", "Group 2"],
    ]);
    expect(groupBySides([["a", "b"]], ["x"], 2).map((g) => g.id)).toEqual(["group-0", "group-1"]);
  });

  it("does not hand back the sides' own arrays", () => {
    const side = ["a", "b"];
    const [g] = groupBySides([side], [], 2);
    g.playerIds.push("zz");
    expect(side).toEqual(["a", "b"]);
  });
});

describe("sidesByMatch", () => {
  const sides = [
    { id: "T1", playerIds: ["a", "b"] },
    { id: "T2", playerIds: ["c", "d"] },
    { id: "T3", playerIds: ["e", "f"] },
    { id: "T4", playerIds: ["g", "h"] },
  ];

  it("a match is one unit of both its sides, side A first; sides in no match follow in their order", () => {
    expect(sidesByMatch(sides, [{ teamAId: "T4", teamBId: "T2" }])).toEqual([["g", "h", "c", "d"], ["a", "b"], ["e", "f"]]);
  });

  it("a side already in a match is not placed twice, whichever seat it has", () => {
    const m = [
      { teamAId: "T1", teamBId: "T2" },
      { teamAId: "T1", teamBId: "T3" }, // T1 already placed
      { teamAId: "T4", teamBId: "T2" }, // T2 already placed, as the second seat
      { teamAId: "T3", teamBId: "T4" },
    ];
    expect(sidesByMatch(sides, m)).toEqual([
      ["a", "b", "c", "d"],
      ["e", "f", "g", "h"],
    ]);
  });

  it("a match naming a side that does not exist, in either seat, is skipped and places nothing", () => {
    const out = sidesByMatch(sides, [
      { teamAId: "T1", teamBId: "ghost" },
      { teamAId: "ghost", teamBId: "T2" },
    ]);
    expect(out).toEqual([["a", "b"], ["c", "d"], ["e", "f"], ["g", "h"]]);
  });

  it("no matches leaves every side as its own unit; no sides, no units", () => {
    expect(sidesByMatch(sides, [])).toEqual([["a", "b"], ["c", "d"], ["e", "f"], ["g", "h"]]);
    expect(sidesByMatch([], [{ teamAId: "T1", teamBId: "T2" }])).toEqual([]);
  });

  it("hands back copies, so changing a unit never changes a side", () => {
    const own = [{ id: "T1", playerIds: ["a", "b"] }];
    const out = sidesByMatch(own, []);
    out[0].push("zz");
    expect(own[0].playerIds).toEqual(["a", "b"]);
  });
});

describe("addMinutes", () => {
  it("writes the 12-hour clock the way a club does: no leading zero, AM or PM", () => {
    expect(addMinutes("08:00", 10)).toBe("8:10 AM");
    expect(addMinutes("8:00", 0)).toBe("8:00 AM");
    expect(addMinutes("09:05", 0)).toBe("9:05 AM");
    expect(addMinutes("13:30", 45)).toBe("2:15 PM");
  });

  it("noon is 12 PM and midnight is 12 AM", () => {
    expect(addMinutes("11:59", 1)).toBe("12:00 PM");
    expect(addMinutes("12:00", 0)).toBe("12:00 PM");
    expect(addMinutes("00:00", 0)).toBe("12:00 AM");
    expect(addMinutes("00:30", 0)).toBe("12:30 AM");
    expect(addMinutes("23:59", 1)).toBe("12:00 AM");
    expect(addMinutes("11:00", 0)).toBe("11:00 AM");
  });

  it("the 24-hour club is written 08:10, two digits each side, and midnight is 00:00", () => {
    expect(addMinutes("08:00", 10, true)).toBe("08:10");
    expect(addMinutes("7:05", 0, true)).toBe("07:05");
    expect(addMinutes("12:00", 0, true)).toBe("12:00");
    expect(addMinutes("13:30", 45, true)).toBe("14:15");
    expect(addMinutes("23:59", 1, true)).toBe("00:00");
  });

  it("goes round the clock, forwards and backwards", () => {
    expect(addMinutes("23:30", 90)).toBe("1:00 AM");
    expect(addMinutes("08:00", 24 * 60)).toBe("8:00 AM");
    expect(addMinutes("08:00", -60)).toBe("7:00 AM");
    // 08:00 less a day and 25 hours: 480 - 1500 = -1020, plus a day is 420 = 7:00.
    expect(addMinutes("08:00", -1500)).toBe("7:00 AM");
    expect(addMinutes("00:10", -20, true)).toBe("23:50");
  });

  it("a clock it cannot read is 08:00, and it reads only a whole clock", () => {
    expect(addMinutes("", 10)).toBe("8:10 AM");
    expect(addMinutes("soon", 0)).toBe("8:00 AM");
    expect(addMinutes("x09:30", 0)).toBe("8:00 AM");
    expect(addMinutes("09:30x", 0)).toBe("8:00 AM");
    expect(addMinutes("123:00", 0)).toBe("8:00 AM");
    expect(addMinutes("9:5", 0)).toBe("8:00 AM");
    expect(addMinutes("9:300", 0)).toBe("8:00 AM");
    expect(addMinutes("0930", 0)).toBe("8:00 AM");
  });

  it("ignores spaces around a clock", () => {
    expect(addMinutes("  09:30 ", 0)).toBe("9:30 AM");
  });
});

describe("startSlots", () => {
  const five = ["g1", "g2", "g3", "g4", "g5"].map((id) => grp(id));
  const view = (s: ReturnType<typeof startSlots>) => s.map((x) => [x.groupId, x.time, x.startHole]);

  it("one tee: a group every interval off the 1st, from 8:00 and ten minutes unless told", () => {
    expect(view(startSlots(five.slice(0, 3), "tee"))).toEqual([
      ["g1", "8:00 AM", 1],
      ["g2", "8:10 AM", 1],
      ["g3", "8:20 AM", 1],
    ]);
    expect(startSlots(five.slice(0, 1), "tee")[0]).not.toHaveProperty("half");
  });

  it("one tee honours the first tee, the interval and the 24-hour clock", () => {
    expect(view(startSlots(five.slice(0, 3), "tee", { firstTee: "07:30", interval: 8, hour24: true }))).toEqual([
      ["g1", "07:30", 1],
      ["g2", "07:38", 1],
      ["g3", "07:46", 1],
    ]);
  });

  it("an interval under a minute is a minute", () => {
    expect(view(startSlots(five.slice(0, 3), "tee", { interval: 0 })).map((r) => r[1])).toEqual(["8:00 AM", "8:01 AM", "8:02 AM"]);
    expect(view(startSlots(five.slice(0, 2), "tee", { interval: -5 })).map((r) => r[1])).toEqual(["8:00 AM", "8:01 AM"]);
  });

  it("split: two groups a time, off the 1st and the 10th", () => {
    expect(view(startSlots(five, "split", { interval: 8 }))).toEqual([
      ["g1", "8:00 AM", 1],
      ["g2", "8:00 AM", 10],
      ["g3", "8:08 AM", 1],
      ["g4", "8:08 AM", 10],
      ["g5", "8:16 AM", 1],
    ]);
  });

  it("split on nine holes goes off the 1st and the 5th", () => {
    expect(startSlots(five.slice(0, 4), "split", { holes: 9 }).map((s) => s.startHole)).toEqual([1, 5, 1, 5]);
    expect(startSlots(five.slice(0, 2), "split", { holes: 18 }).map((s) => s.startHole)).toEqual([1, 10]);
    expect(startSlots(five.slice(0, 2), "split", { holes: undefined }).map((s) => s.startHole)).toEqual([1, 10]);
  });

  it("split honours the first tee and the 24-hour clock", () => {
    expect(startSlots(five.slice(0, 3), "split", { firstTee: "13:00", hour24: true }).map((s) => s.time)).toEqual(["13:00", "13:00", "13:10"]);
  });

  it("shotgun: everyone at once, one group a hole; no half while the course holds the field", () => {
    const eighteen = Array.from({ length: 18 }, (_, i) => grp(`g${i + 1}`));
    const slots = startSlots(eighteen, "shotgun");
    expect(slots.map((s) => s.startHole)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
    expect(new Set(slots.map((s) => s.time))).toEqual(new Set(["8:00 AM"]));
    for (const s of slots) expect("half" in s).toBe(false);
  });

  it("shotgun past the course doubles up as A and B, the second wave beginning again at hole 1", () => {
    const twenty = Array.from({ length: 20 }, (_, i) => grp(`g${i + 1}`));
    const slots = startSlots(twenty, "shotgun");
    expect(slots[0]).toEqual({ groupId: "g1", time: "8:00 AM", startHole: 1, half: "A" });
    expect(slots[17]).toMatchObject({ startHole: 18, half: "A" });
    expect(slots[18]).toMatchObject({ groupId: "g19", startHole: 1, half: "B" });
    expect(slots[19]).toMatchObject({ groupId: "g20", startHole: 2, half: "B" });
  });

  it("shotgun on nine holes: the tenth group is the second on the 1st", () => {
    const ten = Array.from({ length: 10 }, (_, i) => grp(`g${i + 1}`));
    const slots = startSlots(ten, "shotgun", { holes: 9 });
    expect(slots.map((s) => s.startHole)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 1]);
    expect(slots.map((s) => s.half)).toEqual(["A", "A", "A", "A", "A", "A", "A", "A", "A", "B"]);
    // Nine groups on nine holes: nobody doubles up.
    expect(startSlots(ten.slice(0, 9), "shotgun", { holes: 9 }).some((s) => "half" in s)).toBe(false);
  });

  it("shotgun time ignores the interval, takes the first tee, and the 24-hour clock", () => {
    const slots = startSlots(five.slice(0, 2), "shotgun", { firstTee: "14:15", interval: 30, hour24: true });
    expect(slots.map((s) => s.time)).toEqual(["14:15", "14:15"]);
    expect(startSlots(five.slice(0, 1), "shotgun", { firstTee: "14:15" })[0].time).toBe("2:15 PM");
  });

  it("no groups, no slots", () => {
    expect(startSlots([], "tee")).toEqual([]);
    expect(startSlots([], "split")).toEqual([]);
    expect(startSlots([], "shotgun")).toEqual([]);
  });
});

describe("sidesByStandings", () => {
  it("orders whole sides by their best-placed member, ties in the order they came", () => {
    const of = pos({ a: 6, b: 2, c: 4, d: 4, e: 9, f: 1 });
    const sides = [["a", "e"], ["c", "d"], ["b", "x"], ["d", "e"], ["f"]];
    // bests: 6, 4, 2, 4, 1 -> f, [b x], [c d], [d e], [a e]
    expect(sidesByStandings(sides, of)).toEqual([["f"], ["b", "x"], ["c", "d"], ["d", "e"], ["a", "e"]]);
  });

  it("a side nobody has a place for follows the placed ones, in the order given", () => {
    const of = pos({ a: 3 });
    expect(sidesByStandings([["u", "v"], ["a", "w"], ["y", "z"]], of)).toEqual([["a", "w"], ["u", "v"], ["y", "z"]]);
  });

  it("hands back copies of the sides", () => {
    const side = ["a", "b"];
    const [out] = sidesByStandings([side], pos({ a: 1, b: 2 }));
    out.push("zz");
    expect(side).toEqual(["a", "b"]);
  });

  it("no sides, no units", () => {
    expect(sidesByStandings([], pos({}))).toEqual([]);
  });
});
