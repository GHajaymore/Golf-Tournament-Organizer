import { describe, it, expect } from "vitest";
import { potMembership, isPotEntryMode, type PotDecision } from "@/lib/domain/pot-entry";

const field = ["a", "b", "c", "d"];
const d = (playerId: string, over: Partial<PotDecision> = {}): PotDecision => ({
  playerId,
  confirmed: true,
  excluded: false,
  ...over,
});

describe("opt-in — a name is in because somebody put it there", () => {
  it("counts only the rows that exist", () => {
    const m = potMembership("opt-in", field, [d("a"), d("b")]);
    expect(m.entrants).toEqual(["a", "b"]);
    expect(m.pending).toEqual([]);
  });

  it("holds an unpaid signup out of the pot", () => {
    const m = potMembership("opt-in", field, [d("a"), d("b", { confirmed: false })]);
    expect(m.entrants).toEqual(["a"]);
    expect(m.pending).toEqual(["b"]);
  });

  it("drops a signup who is no longer in the field", () => {
    // Withdrawn after putting their name down. A stake in a pot they are not
    // playing for would be paid out to somebody who went home.
    const m = potMembership("opt-in", field, [d("a"), d("gone")]);
    expect(m.entrants).toEqual(["a"]);
  });
});

describe("opt-out — everyone playing is in", () => {
  it("takes the whole field with no rows at all", () => {
    // The case this exists for: a weekly league, or a closest-to-the-pin that
    // is simply on. Nobody ticks forty names.
    const m = potMembership("opt-out", field, []);
    expect(m.entrants).toEqual(field);
    expect(m.pending).toEqual([]);
  });

  it("takes out whoever said otherwise", () => {
    const m = potMembership("opt-out", field, [d("c", { excluded: true })]);
    expect(m.entrants).toEqual(["a", "b", "d"]);
    expect(m.excluded).toEqual(["c"]);
  });

  it("picks up a player entered after the pot was set up", () => {
    // The silent failure under opt-in: a Thursday entrant is out of a pot they
    // believe they are in, and nothing says so.
    const m = potMembership("opt-out", [...field, "late"], [d("c", { excluded: true })]);
    expect(m.entrants).toContain("late");
  });

  it("still lets the organizer say somebody has not paid", () => {
    // The escape hatch that keeps opt-out honest. Marked unpaid, they are in
    // the audience and owe the stake — exactly an opt-in signup's position.
    const m = potMembership("opt-out", field, [d("b", { confirmed: false })]);
    expect(m.entrants).toEqual(["a", "c", "d"]);
    expect(m.pending).toEqual(["b"]);
  });

  it("treats excluded as out even when the row says paid", () => {
    // Refunded, or ticked in by mistake and taken back out. Playing and paying
    // are separate decisions and out wins.
    const m = potMembership("opt-out", field, [d("a", { confirmed: true, excluded: true })]);
    expect(m.entrants).not.toContain("a");
    expect(m.pending).not.toContain("a");
  });
});

describe("the two modes over the same rows", () => {
  it("disagree only about what silence means", () => {
    // The whole design in one assertion: identical rows, and the difference is
    // whether a player with no row is in.
    const rows = [d("a"), d("b", { confirmed: false }), d("c", { excluded: true })];
    const optIn = potMembership("opt-in", field, rows);
    const optOut = potMembership("opt-out", field, rows);

    expect(optIn.entrants).toEqual(["a"]);
    expect(optOut.entrants).toEqual(["a", "d"]); // d never said anything

    // And they agree about everyone who DID say something.
    expect(optIn.pending).toEqual(optOut.pending);
    expect(optIn.excluded).toEqual(optOut.excluded);
  });

  it("never counts one player twice or in two places", () => {
    const rows = [d("a"), d("b", { confirmed: false }), d("c", { excluded: true })];
    for (const mode of ["opt-in", "opt-out"] as const) {
      const m = potMembership(mode, field, rows);
      const all = [...m.entrants, ...m.pending, ...m.excluded];
      expect(all.length).toBe(new Set(all).size);
    }
  });
});

describe("the stored mode", () => {
  it("accepts only the two it knows", () => {
    // It arrives from the database as free text; an unknown value must not
    // fall through to whichever branch happens to be the else.
    expect(isPotEntryMode("opt-in")).toBe(true);
    expect(isPotEntryMode("opt-out")).toBe(true);
    expect(isPotEntryMode("everyone")).toBe(false);
    expect(isPotEntryMode("")).toBe(false);
  });
});
