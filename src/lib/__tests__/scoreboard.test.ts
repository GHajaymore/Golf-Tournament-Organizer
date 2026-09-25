import { describe, it, expect } from "vitest";
import { boardNames, positionLabel, thruTile, leadersWithYou, tileMark } from "@/lib/domain/scoreboard";

describe("the hand-hung scoreboard", () => {
  it("paints surnames, and tells two of the same surname apart", () => {
    expect(boardNames(["Marcus Webb", "Sang-woo Kim", "Ji-ho Kim", "Pelé"])).toEqual([
      "WEBB",
      "S. KIM",
      "J. KIM",
      "PELÉ",
    ]);
  });

  it("puts a T on a shared position, counted over the whole field", () => {
    const all = [
      { rank: 1, ranked: true, started: true },
      { rank: 2, ranked: true, started: true },
      { rank: 2, ranked: true, started: true },
      { rank: 0, ranked: false, started: false },
    ];
    expect(positionLabel(all[0], all)).toBe("1");
    expect(positionLabel(all[1], all)).toBe("T2");
    expect(positionLabel(all[3], all)).toBe("–");
  });

  it("gives no position to a match player who has not teed off, and does not count them in a tie", () => {
    // A match row is always `ranked`, so before it started this painted a
    // position the hero on `/me` refused. Now the board agrees: no result yet,
    // no place — and the not-started row is not counted toward the tie either.
    const all = [
      { rank: 1, ranked: true, started: true },
      { rank: 1, ranked: true, started: false },
    ];
    expect(positionLabel(all[0], all)).toBe("1");
    expect(positionLabel(all[1], all)).toBe("–");
  });

  it("hangs holes played, F when the card is in, and a dash before a shot", () => {
    expect(thruTile({ thru: 9, holesOwed: 18 }, 18)).toBe("9");
    expect(thruTile({ thru: 18, holesOwed: 18 }, 18)).toBe("F");
    expect(thruTile({ thru: 9, holesOwed: 0 }, 9)).toBe("F");
    expect(thruTile({ thru: 0, holesOwed: 18 }, 18)).toBe("–");
    expect(thruTile({ thru: 5, holesOwed: 18, absent: true }, 18)).toBe("–");
  });

  it("shows the leaders, and the player below a break when they are further down", () => {
    const rows = ["a", "b", "c", "d", "e", "f", "g"].map((id) => ({ id }));
    expect(leadersWithYou(rows, "c", 5).map((x) => [x.row.id, x.gap])).toEqual([
      ["a", false],
      ["b", false],
      ["c", false],
      ["d", false],
      ["e", false],
    ]);
    const low = leadersWithYou(rows, "g", 5);
    expect(low.map((x) => x.row.id)).toEqual(["a", "b", "c", "d", "e", "g"]);
    expect(low[5].gap).toBe(true);
    expect(leadersWithYou(rows, "zz", 3).map((x) => x.row.id)).toEqual(["a", "b", "c"]);
  });

  it("marks a hole against its par, and never without one", () => {
    expect(tileMark(3, 4)).toBe("under");
    expect(tileMark(5, 4)).toBe("over");
    expect(tileMark(4, 4)).toBe("par");
    expect(tileMark(null, 4)).toBe("blank");
    expect(tileMark(3, undefined)).toBe("par");
  });
});
