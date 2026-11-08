import { describe, it, expect } from "vitest";
import { tournamentStatus, locksFor, scopeLockOf, lockRefusalWords, LOCK_SCOPES } from "../tournament-status";
import { FAMILY_FIXTURES, FAMILIES, facts, launched, completed } from "./tournament-facts-fixtures";

/**
 * THE SCOPED LOCKS, AS AN ACTION AND A BANNER READ THEM (state machine PR 5a).
 *
 * `locksFor` is the setup-side read of the one `locksOf` the whole status uses,
 * so an action asking whether it may write (`refuseIfLocked`) and the banner on
 * the screen (`ScopeLockBanner`) give the dashboard's answer. Worked by hand from
 * the panel's rulings (proposal 3 Nov, section 3 and 8.3 Q3), never by calling
 * `configurationLocked`, the reader the scopes replace.
 */

describe("the setup side of the facts is enough to know a lock", () => {
  for (const family of FAMILIES) {
    it(`${family}: the actions' locks are the dashboard's, set up, launched, unlocked and completed`, () => {
      const base = FAMILY_FIXTURES[family]();
      for (const f of [base, launched(base), { ...launched(base), configUnlocked: true }, completed(base), { ...base, flightsConfirmed: true }]) {
        expect(locksFor(f)).toEqual(tournamentStatus(f).locks);
      }
    });
  }
});

describe("one locked scope, as plain values a screen is handed", () => {
  it("open is null — a draft locks no side", () => {
    const st = tournamentStatus(facts());
    for (const scope of LOCK_SCOPES) expect(scopeLockOf(st.locks, scope), scope).toBeNull();
  });

  it("a live tournament's sides: locked by launch, its reason, its way out, and correctable", () => {
    expect(scopeLockOf(locksFor(launched(facts())), "sides")).toEqual({
      scope: "sides",
      by: "launch",
      because: "Locked because the tournament is live.",
      wayOut: { says: "Unlock it on the dashboard", href: "/dashboard" },
      correctable: true,
    });
  });

  it("unlocked on the day, the sides open again (today's blanket Unlock, read until PR 9)", () => {
    expect(scopeLockOf(locksFor({ ...launched(facts()), configUnlocked: true }), "sides")).toBeNull();
  });

  it("completed: Reopen is the way out, and no correction opens it (TD Q2)", () => {
    const lock = scopeLockOf(locksFor(completed(facts())), "rounds");
    expect(lock?.by).toBe("completed");
    expect(lock?.wayOut).toEqual({ says: "Reopen it on the dashboard", href: "/dashboard" });
    expect(lock?.correctable).toBe(false);
  });

  it("money and the tee sheet were never under the blanket lock, and are not now", () => {
    const locks = locksFor(launched(facts()));
    expect(scopeLockOf(locks, "money")).toBeNull();
    expect(scopeLockOf(locks, "teeSheet")).toBeNull();
  });
});

describe("a refusal says the reason, then the way out with what the press was for", () => {
  it("each way out the machine gives reads as one sentence", () => {
    const live = scopeLockOf(locksFor(launched(facts())), "sides")!;
    expect(lockRefusalWords(live, "change teams")).toBe("Locked because the tournament is live. Unlock it on the dashboard to change teams.");
    const done = scopeLockOf(locksFor(completed(facts())), "rounds")!;
    expect(lockRefusalWords(done, "add rounds")).toBe("Locked because the tournament is completed. Reopen it on the dashboard to add rounds.");
    const drawn = scopeLockOf(locksFor({ ...facts(), flightsConfirmed: true }), "flights")!;
    expect(lockRefusalWords(drawn, "move a player")).toBe("Locked because the draw is confirmed. Reopen the draw on Flights to move a player.");
  });

  it("never the words that leave the app (TD Q2): not “Configuration is locked”", () => {
    const live = scopeLockOf(locksFor(launched(facts())), "rounds")!;
    expect(lockRefusalWords(live, "change the handicap split")).not.toMatch(/Configuration is locked/);
  });
});
