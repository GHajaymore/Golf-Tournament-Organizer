import { describe, it, expect } from "vitest";
import { positions, movementBetween } from "../week-movement";
import { readSource } from "@/lib/__tests__/source";

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

/**
 * THE WEEK SHEET AND THE LEADERBOARD DISAGREED ABOUT THE SAME NIGHT.
 *
 * Read off Demo Cup on 2026-09-11. Four players all on 10.5 points, all
 * 3 played, 2 won, 1 halved, 0 lost, all +7 holes:
 *
 *     /leaderboard   3 Diego Alvarez   4 Tom Halloran   5 Grace Okafor   6 Lucia Romano
 *     /week          3 Diego Alvarez   3 Tom Halloran   3 Grace Okafor   3 Lucia Romano
 *
 * The leaderboard is the right one. `rankPlayers` breaks a tie on points with
 * the club's own chain — head-to-head, holes-won ratio, fewest holes lost,
 * lower handicap — and shares a place only when every link comes back level.
 *
 * The week sheet was handed exactly that ranking by `chainRoundStandings`,
 * under a comment promising "the same math the leaderboard uses, so the two
 * cannot disagree", and then passed nothing but `totalPoints` into
 * `positions`, which worked the place out again from that one column.
 *
 * The ORDER was never wrong — the rows arrive sorted and `Array.sort` is
 * stable — so the sheet listed the four in the correct tiebroken order and
 * numbered all of them 3rd. The number is the half a player reads.
 */
const r = (playerId: string, value: number, rank: number) => ({ playerId, value, rank });

describe("a place the ranker already decided", () => {
  it("keeps a tie the tiebreakers broke", () => {
    // Four level on points, split by the club's chain. 3, 4, 5, 6.
    const got = positions(
      [r("diego", 10.5, 3), r("tom", 10.5, 4), r("grace", 10.5, 5), r("lucia", 10.5, 6)],
      "desc",
    );
    expect([got.get("diego"), got.get("tom"), got.get("grace"), got.get("lucia")]).toEqual([3, 4, 5, 6]);
  });

  it("keeps a tie the tiebreakers could NOT break", () => {
    /**
     * The other direction, and the one that matters most. `rankPlayers` shares
     * a rank when every configured tiebreaker returns zero — a genuine dead
     * heat — and the sheet has to print that as a dead heat too. Deriving from
     * points happens to get this case right, which is exactly why the bug
     * survived: it was correct whenever nothing separated anybody.
     */
    const got = positions([r("a", 12, 1), r("b", 10.5, 2), r("c", 10.5, 2), r("d", 9, 4)], "desc");
    expect([got.get("a"), got.get("b"), got.get("c"), got.get("d")]).toEqual([1, 2, 2, 4]);
  });

  it("still derives the place when nobody supplies one", () => {
    /**
     * A stroke league passes no rank, and must not start behaving differently:
     * equal net strokes really are equal, and there is no chain to consult.
     */
    const got = positions([p("a", 34), p("b", 34), p("c", 30)], "desc");
    expect([got.get("a"), got.get("b"), got.get("c")]).toEqual([1, 1, 3]);
  });

  it("derives for everybody rather than mixing two answers", () => {
    /**
     * All-or-nothing. A half-ranked list would put two different answers to
     * the same question in one column, which is the fault being fixed rather
     * than a smaller version of it.
     */
    const got = positions([r("a", 34, 1), p("b", 34), p("c", 30)], "desc");
    expect([got.get("a"), got.get("b"), got.get("c")]).toEqual([1, 1, 3]);
  });

  it("measures movement between two supplied rankings", () => {
    /**
     * Movement is the difference between two positions, so both weeks have to
     * be counted the same way. One derived and one supplied would invent an
     * arrow out of the change in method.
     */
    const rows = movementBetween(
      [r("tom", 10.5, 3), r("diego", 10.5, 4)],
      [r("diego", 6, 3), r("tom", 6, 4)],
      "desc",
    );
    // Tom was 4th and is 3rd: one place up. Diego the reverse.
    expect(rows.find((x) => x.playerId === "tom")?.change).toBe(1);
    expect(rows.find((x) => x.playerId === "diego")?.change).toBe(-1);
  });
});

/**
 * And the week sheet has to actually SEND it.
 *
 * The tests above hand the rank in, so they cannot see the service going back
 * to passing points alone — which is precisely the shape the bug had, under a
 * comment already claiming the two screens could not disagree.
 */
describe("what the week sheet hands to the ranker", () => {
  const src = () => readSource("src/lib/services/week-view.ts");

  it("carries the rank for both weeks, not just the one on screen", () => {
    const s = src();
    const branch = s.slice(s.indexOf("if (!state.isStroke)"), s.indexOf("const through ="));
    // `after` and `before`, because movement is the difference between them.
    expect(branch.split("rank: r.rank").length - 1).toBe(2);
  });

  it("still sends no rank from the stroke branch", () => {
    /**
     * Equal net strokes are equal, there is no chain to consult, and
     * `positions` deriving the place is the right answer there. Sending a
     * rank would be inventing one.
     */
    const s = src();
    const stroke = s.slice(s.indexOf("const through ="));
    expect(stroke).not.toMatch(/rank:/);
  });
});
