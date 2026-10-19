import { describe, expect, it } from "vitest";
import { playerRecords, stars, pointsTrack, marginWords, type ReportSession } from "@/lib/domain/final-report";

/**
 * Worked by hand from a cup shaped like the first real one: five four-balls
 * and ten singles, invented names. Side A is the left team, B the right.
 */
const W = (a: string[], b: string[], winner: "A" | "B" | "H", label: string) => ({
  a,
  b,
  points: (winner === "A" ? [1, 0] : winner === "B" ? [0, 1] : [0.5, 0.5]) as [number, number],
  final: true,
  label,
});
const sessions: ReportSession[] = [
  {
    name: "Four-balls",
    matches: [
      W(["A1", "A2"], ["B1", "B2"], "B", "2&1"),
      W(["A3", "A4"], ["B3", "B4"], "B", "3&2"),
      W(["A5", "A6"], ["B5", "B6"], "A", "3&2"),
    ],
  },
  {
    name: "Singles",
    matches: [
      W(["A1"], ["B2"], "A", "1 UP"),
      W(["A2"], ["B1"], "B", "2&1"),
      W(["A5"], ["B5"], "H", "A/S"),
      W(["A6"], ["B6"], "A", "1 UP"),
      { a: ["A3"], b: ["B3"], points: [0, 0] as [number, number], final: false, label: "2 UP thru 5" },
    ],
  },
];

describe("the final report's arithmetic", () => {
  it("credits every player on the side with the match's points, decided matches only", () => {
    const r = new Map(playerRecords(sessions).map((p) => [`${p.side}:${p.name}`, p]));
    expect(r.get("B:B1")).toMatchObject({ played: 2, points: 2 });
    expect(r.get("A:A5")).toMatchObject({ played: 2, points: 1.5 });
    expect(r.get("B:B5")).toMatchObject({ played: 2, points: 0.5 });
    // A3's singles is still on the course: one match played, not two.
    expect(r.get("A:A3")).toMatchObject({ played: 1, points: 0 });
  });

  it("lists the best first, then by name", () => {
    expect(playerRecords(sessions).slice(0, 2).map((p) => p.name)).toEqual(["A6", "B1"]);
  });

  it("a star won every one of at least two matches, and says how", () => {
    expect(stars(sessions)).toEqual([
      { name: "A6", side: "A", played: 2, how: ["Four-ball 3&2", "Singles 1 up"] },
      { name: "B1", side: "B", played: 2, how: ["Four-ball 2&1", "Singles 2&1"] },
    ]);
  });

  it("a halve is not unbeaten-and-won, and one match is not enough", () => {
    const names = stars(sessions).map((s) => s.name);
    expect(names).not.toContain("A5");
    expect(names).not.toContain("B3");
  });

  it("the points track: 16 points, CVC 5½, CDG 9½ in the matches and the 16th point to CDG", () => {
    expect(pointsTrack({ a: 5.5, b: 10.5, outside: [{ side: "B", points: 1 }], inPlay: 16 })).toEqual({
      a: 11,
      b: 19,
      outside: 2,
      open: 0,
      cells: 32,
    });
  });

  it("an undecided point outside the matches is an open cell, in nobody's colour", () => {
    expect(pointsTrack({ a: 7.5, b: 7.5, outside: [{ side: null, points: 1 }], inPlay: 16 })).toEqual({
      a: 15,
      b: 15,
      outside: 0,
      open: 2,
      cells: 32,
    });
  });

  it("writes a margin as it reads in a sentence", () => {
    expect(marginWords("1 UP")).toBe("1 up");
    expect(marginWords("A/S")).toBe("halved");
    expect(marginWords("3&2")).toBe("3&2");
  });
});
