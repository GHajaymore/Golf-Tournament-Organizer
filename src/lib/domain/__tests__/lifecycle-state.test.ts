import { describe, it, expect } from "vitest";
import { lifecycleMismatch } from "@/lib/domain/lifecycle-state";

const facts = (over: Partial<Parameters<typeof lifecycleMismatch>[0]> = {}) => ({
  status: "draft",
  matchesScored: 0,
  playersEntered: 32,
  ...over,
});

describe("when the status disagrees with the tournament", () => {
  it("says nothing about a draft that has not started", () => {
    // The ordinary case, and the reason this checks results rather than
    // status alone: a draft with no scores is exactly what a draft is.
    expect(lifecycleMismatch(facts())).toBeNull();
  });

  it("flags results recorded before the tournament was launched", () => {
    const w = lifecycleMismatch(facts({ matchesScored: 40 }));
    expect(w?.title).toMatch(/40 results are in/);
    expect(w?.offerLaunch).toBe(true);
  });

  it("flags it from any of the pre-launch statuses, not just draft", () => {
    // Launch is the gate on player access, so "registration" and "ready" leave
    // the field just as locked out as "draft" does.
    for (const status of ["draft", "registration", "ready"]) {
      expect(lifecycleMismatch(facts({ status, matchesScored: 1 })), status).not.toBeNull();
    }
  });

  it("says nothing once the tournament is live or finished", () => {
    for (const status of ["live", "completed"]) {
      expect(lifecycleMismatch(facts({ status, matchesScored: 40 })), status).toBeNull();
    }
  });

  it("explains the consequence rather than just naming the mismatch", () => {
    // The point of the warning. "Status is draft" is a fact about a database
    // column; "your 32 players cannot see the tournament they are playing" is
    // the thing an organizer needs to know.
    const w = lifecycleMismatch(facts({ matchesScored: 40 }));
    expect(w?.detail).toMatch(/can’t see their matches/);
    expect(w?.detail).toMatch(/32 in the field/);
    // And that nothing is broken meanwhile — scoring works either way.
    expect(w?.detail).toMatch(/Scoring still works/);
  });

  it("reads properly for a single result", () => {
    expect(lifecycleMismatch(facts({ matchesScored: 1 }))?.title).toMatch(/1 result is in/);
  });

  it("copes with results but no field, without claiming a player count", () => {
    // Possible with placeholder entries removed after scoring. Saying "the 0
    // in the field have no way to follow it" would be nonsense.
    const w = lifecycleMismatch(facts({ matchesScored: 3, playersEntered: 0 }));
    expect(w?.detail).toMatch(/the field has no way/);
    expect(w?.detail).not.toMatch(/\b0 in the field\b/);
  });
});
