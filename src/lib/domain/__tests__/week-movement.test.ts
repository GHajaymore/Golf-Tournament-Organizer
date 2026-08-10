import { describe, it, expect } from "vitest";
import { positions, movementBetween } from "../week-movement";

/**
 * The movement column is the reason the weekly view is worth building, and a
 * wrong arrow is worse than no arrow — a member reads it as the app telling
 * them they dropped when they didn't.
 */

const p = (playerId: string, value: number) => ({ playerId, value });

describe("positions share across ties", () => {
  it("gives equal values the same place and skips the next", () => {
    // 34, 34, 30 is 1st, 1st, 3rd — not 1st, 2nd, 3rd.
    const got = positions([p("a", 34), p("b", 34), p("c", 30)], "desc");
    expect(got.get("a")).toBe(1);
    expect(got.get("b")).toBe(1);
    expect(got.get("c")).toBe(3);
  });

  it("ranks net strokes the other way up", () => {
    const got = positions([p("a", 72), p("b", 68)], "asc");
    expect(got.get("b")).toBe(1);
    expect(got.get("a")).toBe(2);
  });

  it("handles a three-way tie at the top", () => {
    const got = positions([p("a", 40), p("b", 40), p("c", 40), p("d", 39)], "desc");
    expect([got.get("a"), got.get("b"), got.get("c")]).toEqual([1, 1, 1]);
    expect(got.get("d")).toBe(4);
  });
});

describe("what last night changed", () => {
  it("reports a climb as a positive number", () => {
    const after = [p("a", 50), p("b", 40)];
    const before = [p("b", 30), p("a", 20)];
    const rows = movementBetween(after, before, "desc");
    // a was 2nd, is now 1st.
    expect(rows.find((r) => r.playerId === "a")?.change).toBe(1);
    expect(rows.find((r) => r.playerId === "b")?.change).toBe(-1);
  });

  it("reports no change when the order held", () => {
    const rows = movementBetween([p("a", 50), p("b", 40)], [p("a", 25), p("b", 20)], "desc");
    expect(rows.every((r) => r.change === 0)).toBe(true);
  });

  it("does not call week one a climb", () => {
    // Nobody has moved yet, and nobody is "new" against an empty table —
    // that would flag the entire field.
    const rows = movementBetween([p("a", 10), p("b", 8)], [], "desc");
    expect(rows.every((r) => r.change === 0)).toBe(true);
    expect(rows.every((r) => r.isNew === false)).toBe(true);
  });

  it("flags a first-timer as new rather than as having climbed", () => {
    // Somebody joining in week six has not overtaken anyone. A green arrow
    // here is the app inventing an achievement.
    const rows = movementBetween([p("a", 50), p("new", 45), p("b", 40)], [p("a", 25), p("b", 20)], "desc");
    const row = rows.find((r) => r.playerId === "new");
    expect(row?.isNew).toBe(true);
    expect(row?.change).toBe(0);
  });

  it("gives tied players the same movement", () => {
    // Both were 3rd, both are now 1st. Neither moved more than the other.
    const after = [p("a", 50), p("b", 50)];
    const before = [p("c", 40), p("a", 10), p("b", 10)];
    const rows = movementBetween(after, before, "desc");
    expect(rows.find((r) => r.playerId === "a")?.change).toBe(1);
    expect(rows.find((r) => r.playerId === "b")?.change).toBe(1);
  });

  it("returns the table already in order", () => {
    const rows = movementBetween([p("b", 30), p("a", 50)], [], "desc");
    expect(rows.map((r) => r.playerId)).toEqual(["a", "b"]);
  });

  it("copes with an empty week", () => {
    expect(movementBetween([], [p("a", 5)], "desc")).toEqual([]);
    expect(() => movementBetween([], [], "asc")).not.toThrow();
  });
});
