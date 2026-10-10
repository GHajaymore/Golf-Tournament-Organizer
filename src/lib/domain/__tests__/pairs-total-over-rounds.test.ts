import { describe, it, expect } from "vitest";
import { pairTotals, type PairRoundRow } from "../pair-totals";
import { compareTeamRows, teamPlaceValue } from "../week-basis";
import { placesByValue } from "../flight-places";

/**
 * A 36-HOLE PAIRS EVENT IS WON ON THE TOTAL, AND A LIVE TEAM BOARD READS
 * RELATIVE TO PAR (2026-10-10).
 *
 * Two defects, one board. The team board offered one round at a time, so a
 * two-round better-ball's champion pair was on no screen. And it ranked raw
 * totals, so while a round was being played a side through 9 led a side
 * through 18 — the individual board has always ranked relative to par.
 */

const row = (over: Partial<PairRoundRow> & { memberIds: string[]; name: string }): PairRoundRow => ({
  teamId: over.name,
  members: over.memberIds,
  playingHandicap: 10,
  gross: 0,
  net: 0,
  points: 0,
  played: 18,
  toPar: 0,
  ...over,
});

describe("a team board while the round is on", () => {
  // Par 36 out, 72 round. Ash & Bo are through 9 in 33 net (three under);
  // Cy & Di are round in 68 net (four under) — and lead.
  const out = { gross: 38, net: 33, points: 0, toPar: -3 };
  const round = { gross: 75, net: 68, points: 0, toPar: -4 };

  it("ranks the side four under ahead of the side three under, whatever holes they have played", () => {
    expect(compareTeamRows("net", round, out)).toBeLessThan(0);
  });

  it("CONTROL: two sides both round still finish in net order", () => {
    const a = { gross: 75, net: 68, points: 0, toPar: -4 };
    const b = { gross: 70, net: 69, points: 0, toPar: -3 };
    expect(compareTeamRows("net", a, b)).toBeLessThan(0);
  });

  it("places on the figure it ranks on: four under through 9 shares the place with four under round", () => {
    const outIn32 = { gross: 37, net: 32, points: 0, toPar: -4 };
    expect(placesByValue([round, outIn32], (r) => teamPlaceValue("net", r), () => true)).toEqual([1, 1]);
  });
});

describe("a two-round pairs event", () => {
  // Round 1 leaders Ann & Ben (-6) fade to +2 in round 2; Cal & Dee go -2 then
  // -5 and win on the total, -7 against -4. Round 2's sides are drawn again, so
  // they carry new ids, new names and the members in another order.
  const r1 = [
    row({ name: "Ann & Ben", memberIds: ["ann", "ben"], net: 66, gross: 80, toPar: -6 }),
    row({ name: "Cal & Dee", memberIds: ["cal", "dee"], net: 70, gross: 74, toPar: -2 }),
  ];
  const r2 = [
    row({ teamId: "t9", name: "Dee & Cal", memberIds: ["dee", "cal"], net: 67, gross: 71, toPar: -5 }),
    row({ teamId: "t8", name: "Ben & Ann", memberIds: ["ben", "ann"], net: 74, gross: 88, toPar: 2 }),
  ];

  it("puts the pair with the lower total first, with both rounds and the sum", () => {
    const totals = pairTotals([r1, r2], "net");
    expect(totals.map((t) => [t.name, t.rounds, t.net, t.toPar])).toEqual([
      ["Dee & Cal", [70, 67], 137, -7],
      ["Ben & Ann", [66, 74], 140, -4],
    ]);
  });

  it("offers no total when the partners changed between rounds", () => {
    const swapped = [
      row({ name: "Ann & Cal", memberIds: ["ann", "cal"] }),
      row({ name: "Ben & Dee", memberIds: ["ben", "dee"] }),
    ];
    expect(pairTotals([r1, swapped], "net")).toEqual([]);
  });

  it("totals Stableford points, most first", () => {
    const p1 = [row({ name: "A", memberIds: ["a"], points: 44 }), row({ name: "B", memberIds: ["b"], points: 40 })];
    const p2 = [row({ name: "A", memberIds: ["a"], points: 36 }), row({ name: "B", memberIds: ["b"], points: 43 })];
    expect(pairTotals([p1, p2], "stableford").map((t) => [t.name, t.points])).toEqual([["B", 83], ["A", 80]]);
  });

  it("CONTROL: one round is not a total", () => {
    expect(pairTotals([r1], "net")).toEqual([]);
  });
});
