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

  it("drops a row for somebody who is not a player in this event at all", () => {
    /**
     * `ContestEntry` has no foreign key to `Player`, so a hard-deleted player
     * leaves an orphan row behind. This filter is what keeps it out of a pot,
     * and it is the reason the filter cannot simply be removed.
     *
     * With no wider list given, "is a player" defaults to "is in the field",
     * which is how it has always behaved.
     */
    const m = potMembership("opt-in", field, [d("a"), d("orphan")]);
    expect(m.entrants).toEqual(["a"]);
  });
});

/**
 * A stake the organizer has already taken, from somebody who later withdrew.
 *
 * `removeSignup` keeps a player with playing history as `withdrawn` rather
 * than deleting them, so a confirmed row outlives their place in the field.
 * Filtered against the confirmed field alone that row landed in NO bucket —
 * not entrant, not pending, not excluded — so a four-stake pot showed three,
 * the winner was paid £30 of £40, and the player who paid showed as square.
 *
 * `skinsPotFor` has loaded every status since it was written, and says why:
 * "a stake is paid or it is not. Withdrawing from a tournament is not a
 * refund." Rule 7 makes the record the only thing there is. The two pot
 * families disagreed about the same fact; these pin the agreement.
 */
describe("a paid stake outlives its payer withdrawing", () => {
  // Still on the roster, no longer in the field.
  const roster = [...field, "gone"];

  it("keeps a confirmed stake in an opt-in pot", () => {
    const m = potMembership("opt-in", field, [d("a"), d("gone")], roster);
    expect(m.entrants).toEqual(["a", "gone"]);
    // Four stakes collected, four in the pot.
    expect(m.entrants).toHaveLength(2);
  });

  it("keeps it in an opt-out pot too", () => {
    // Opt-out reaches this by another route: the withdrawal removes them from
    // the field list the opt-out branch walks, so the row was orphaned there
    // as well.
    const m = potMembership("opt-out", field, [d("gone")], roster);
    expect(m.entrants).toContain("gone");
    expect(m.entrants).toHaveLength(field.length + 1);
  });

  it("does not chase somebody who left without paying", () => {
    // An unpaid ask is not money the organizer holds, and a departed player on
    // the "take their money" list is a bill nobody will collect.
    const m = potMembership("opt-in", field, [d("gone", { confirmed: false })], roster);
    expect(m.entrants).toEqual([]);
    expect(m.pending).toEqual([]);
  });

  it("still refuses an orphan row, even a confirmed one", () => {
    // The whole reason the filter stays. "orphan" is on no roster.
    const m = potMembership("opt-in", field, [d("a"), d("orphan")], roster);
    expect(m.entrants).toEqual(["a"]);
  });

  it("still lets the organizer take a withdrawn player out", () => {
    // Excluded beats paid, in both modes, exactly as before.
    const optIn = potMembership("opt-in", field, [d("gone", { excluded: true })], roster);
    const optOut = potMembership("opt-out", field, [d("gone", { excluded: true })], roster);
    expect(optIn.entrants).not.toContain("gone");
    expect(optOut.entrants).not.toContain("gone");
    expect(optIn.excluded).toContain("gone");
  });

  it("puts each player in exactly one bucket", () => {
    // The invariant the fault broke: the withdrawn payer was in none of them.
    for (const mode of ["opt-in", "opt-out"] as const) {
      const m = potMembership(mode, field, [d("gone"), d("b", { confirmed: false })], roster);
      const all = [...m.entrants, ...m.pending, ...m.excluded];
      expect(all).toContain("gone");
      expect(all.length, mode).toBe(new Set(all).size);
    }
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
