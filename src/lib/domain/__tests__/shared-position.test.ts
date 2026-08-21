import { describe, it, expect } from "vitest";
import { positionLabel, type PositionRow } from "../shared-position";

/**
 * The number a player quotes in the bar.
 *
 * `/me` showed a bare rank taken from the standings. Three players level on 2
 * are all correctly rank 2, but on the player's own screen that number is
 * addressed to ONE person — and telling them they are second when two others
 * are equally second is not what the results sheet says.
 */

const row = (id: string, rank: number, thru = 18): PositionRow => ({ id, rank, thru });

describe("a player's own position", () => {
  it("is bare when nobody shares it", () => {
    expect(positionLabel([row("a", 1), row("b", 2)], "a")).toBe("1");
    expect(positionLabel([row("a", 1), row("b", 2)], "b")).toBe("2");
  });

  it("is marked T when it is shared", () => {
    const rows = [row("a", 1), row("b", 2), row("c", 2), row("d", 4)];
    expect(positionLabel(rows, "b")).toBe("T2");
    expect(positionLabel(rows, "c")).toBe("T2");
    // And the player below a tie is not marked.
    expect(positionLabel(rows, "d")).toBe("4");
  });

  it("marks a tie for the lead", () => {
    expect(positionLabel([row("a", 1), row("b", 1)], "a")).toBe("T1");
  });

  it("says nothing for a player who has not started", () => {
    // "Position –" is what the screen already renders for them; a rank they
    // have not earned would be worse than a dash.
    expect(positionLabel([row("a", 1, 0)], "a")).toBe("");
  });

  it("does not count a player who has not started as sharing", () => {
    // Two rows on rank 2 where only one has teed off is not a tie, and saying
    // joint would tell somebody they are level with a player who has not begun.
    const rows = [row("a", 1), row("b", 2), row("c", 2, 0)];
    expect(positionLabel(rows, "b")).toBe("2");
  });

  it("says nothing for somebody not in the standings", () => {
    // An organizer who does not play. The screen shows them no card either.
    expect(positionLabel([row("a", 1)], "ghost")).toBe("");
    expect(positionLabel([], "a")).toBe("");
  });

  it("marks every member of a bigger tie", () => {
    const rows = [row("a", 1), row("b", 1), row("c", 1), row("d", 4)];
    for (const id of ["a", "b", "c"]) expect(positionLabel(rows, id)).toBe("T1");
    expect(positionLabel(rows, "d")).toBe("4");
  });

  it("holds on a one-player field", () => {
    expect(positionLabel([row("a", 1)], "a")).toBe("1");
  });

  it("never marks a player as sharing with only themselves", () => {
    // The off-by-one: counting the player's own row and comparing > 0 rather
    // than > 1 would mark every single position as tied.
    for (const size of [1, 2, 3, 4, 8, 28]) {
      const rows = Array.from({ length: size }, (_, i) => row(`p${i}`, i + 1));
      for (const r of rows) expect(positionLabel(rows, r.id)).toBe(`${r.rank}`);
    }
  });
});
