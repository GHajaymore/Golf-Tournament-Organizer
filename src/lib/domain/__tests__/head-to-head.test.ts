import { describe, it, expect } from "vitest";
import { recordAgainst, recordLine, recordVerdict, yourHistory, type Meeting } from "../head-to-head";

const meet = (over: Partial<Meeting>): Meeting => ({
  eventId: "e",
  eventName: "Summer Matchplay",
  where: "Round 1",
  date: "2026-06-01",
  a: "ann",
  b: "bea",
  winner: "ann",
  margin: "3&2",
  ...over,
});

describe("counting a member's meetings", () => {
  it("counts from THIS member's side, whichever seat they sat in", () => {
    const ms = [
      meet({}),
      meet({ a: "bea", b: "ann", winner: "bea", margin: "1 UP", date: "2026-07-01" }),
      meet({ winner: null, margin: "AS", date: "2026-05-01" }),
    ];
    const [vsBea] = recordAgainst("ann", ms);
    expect(vsBea).toMatchObject({ opponentId: "bea", won: 1, lost: 1, halved: 1 });
    expect(vsBea.meetings.map((m) => m.date)).toEqual(["2026-07-01", "2026-06-01", "2026-05-01"]);
    // …and the mirror from Bea's side is the same meetings, the other way round.
    expect(recordAgainst("bea", ms)[0]).toMatchObject({ opponentId: "ann", won: 1, lost: 1, halved: 1 });
  });

  it("never counts a meeting whose winner is neither player", () => {
    expect(recordAgainst("ann", [meet({ winner: "cal" })])).toEqual([]);
  });

  it("puts the most-met opponent first", () => {
    const ms = [meet({ b: "cal" }), meet({}), meet({ date: "2026-06-02" })];
    expect(recordAgainst("ann", ms).map((r) => r.opponentId)).toEqual(["bea", "cal"]);
  });
});

describe("saying it", () => {
  const rec = (won: number, lost: number, halved: number, last: Partial<Meeting> = {}) => ({
    opponentId: "bea",
    won,
    lost,
    halved,
    meetings: [meet(last)],
  });

  it("names every figure, and leads/trails from the member's side", () => {
    expect(recordLine(rec(2, 1, 1))).toBe("Won 2 · Lost 1 · Halved 1");
    expect(recordLine(rec(0, 1, 0))).toBe("Won 0 · Lost 1");
    expect(recordVerdict(rec(2, 1, 0))).toBe("Leads 2–1");
    expect(recordVerdict(rec(0, 1, 0))).toBe("Trails 0–1");
    expect(recordVerdict(rec(1, 1, 0))).toBe("All square 1–1");
  });

  it("tells the player where they stand and how it went last time", () => {
    expect(yourHistory(rec(2, 1, 1))).toBe("You've met before: you lead 2–1, 1 halved. Last time: won 3&2 in Summer Matchplay.");
    expect(yourHistory(rec(0, 1, 0, { winner: "bea", margin: "2&1" }))).toBe(
      "You've met before: you trail 0–1. Last time: lost 2&1 in Summer Matchplay.",
    );
    expect(yourHistory(rec(0, 0, 1, { winner: null, margin: "AS" }))).toBe(
      "You've met before: all square 0–0, 1 halved. Last time: halved in Summer Matchplay.",
    );
  });

  it("says where in THIS tournament when they met in its group stage", () => {
    expect(yourHistory(rec(0, 1, 0, { winner: "bea", margin: "2&1" }), "e")).toBe(
      "You've met before: you trail 0–1. Last time: lost 2&1 in Round 1 of this one.",
    );
    // CONTROL: another tournament is still named.
    expect(yourHistory(rec(0, 1, 0, { winner: "bea", margin: "2&1" }), "other")).toMatch(/in Summer Matchplay\.$/);
  });
});
