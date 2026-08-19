import { describe, it, expect } from "vitest";
import { orgProfile, isOrgKind, ORG_KINDS, type OrgKind } from "@/lib/domain/org-profile";
import { moneyLayoutFor, roundMoneyIsFinal } from "@/lib/domain/money-layout";

describe("what each kind of organization means", () => {
  it("gives a club no shared-cost ledger", () => {
    // Nobody splits a cart fee with the club — they pay the shop. A ledger
    // there is a feature from somebody else's outing, and it invites a member
    // to think the club owes them for the buggy.
    expect(orgProfile("club").ledger).toBe(false);
  });

  it("gives a society and a personal organizer one", () => {
    // They share real costs somebody fronted, which is what it is for.
    expect(orgProfile("community").ledger).toBe(true);
    expect(orgProfile("personal").ledger).toBe(true);
  });

  it("keeps the roster shared for everyone but a personal organizer", () => {
    // The existing `kind === "club"` comparisons were really asking this.
    for (const k of ["club", "community"] as OrgKind[]) {
      expect(orgProfile(k).sharedRoster, k).toBe(true);
    }
    expect(orgProfile("personal").sharedRoster).toBe(false);
  });

  it("leaves the cash to the shop at a club", () => {
    // The shop takes the entry fee, the 2s pot comes out of it, and the pro
    // pays the winner. Recording "Halloran still owes 5" would invent a debt
    // the club is not chasing and cannot see.
    expect(orgProfile("club").tracksCash).toBe(false);
    // A society has no shop to arbitrate: one person fronted it, nine owe.
    expect(orgProfile("community").tracksCash).toBe(true);
    expect(orgProfile("personal").tracksCash).toBe(true);
  });

  it("ties tracking cash to having a ledger", () => {
    // Not a coincidence worth leaving implicit: the kinds that track who paid
    // are exactly the kinds with shared costs to settle.
    for (const k of ORG_KINDS) {
      expect(orgProfile(k).tracksCash, k).toBe(orgProfile(k).ledger);
    }
  });

  it("falls back to personal, which is the permissive answer", () => {
    // A typo in a column must never be the reason somebody is not told they
    // owe forty pounds, so the fallback SHOWS the ledger.
    expect(orgProfile("wheelbarrow").kind).toBe("personal");
    expect(orgProfile(null).ledger).toBe(true);
    expect(orgProfile(undefined).ledger).toBe(true);
    expect(orgProfile("").ledger).toBe(true);
  });

  it("keeps the two original kinds working exactly as they did", () => {
    // club and personal are the values already in the database.
    expect(orgProfile("club").sharedRoster).toBe(true);
    expect(orgProfile("personal").sharedRoster).toBe(false);
  });

  it("answers every question for every kind", () => {
    // The point of declaring them in one table: a new kind cannot be added
    // without deciding what it means for each capability.
    for (const k of ORG_KINDS) {
      const p = orgProfile(k);
      expect(p.label.length, k).toBeGreaterThan(0);
      expect(p.blurb.length, k).toBeGreaterThan(0);
      expect(typeof p.ledger, k).toBe("boolean");
      expect(typeof p.sharedRoster, k).toBe("boolean");
      expect(typeof p.seasonPlay, k).toBe("boolean");
      expect(typeof p.ownsCourse, k).toBe("boolean");
      expect(typeof p.tracksCash, k).toBe("boolean");
    }
  });

  it("validates a stored kind", () => {
    expect(isOrgKind("club")).toBe(true);
    expect(isOrgKind("community")).toBe(true);
    expect(isOrgKind("society")).toBe(false);
    // Dropped on 2026-08-18 — it answered every flag exactly as `club` did, so
    // it was a label rather than a kind. No row has ever held it: nothing
    // writes `kind` but the hard-coded "personal" in services/organization.ts.
    expect(isOrgKind("course")).toBe(false);
  });
});

describe("what the money screen shows", () => {
  it("is round-based for everyone", () => {
    // Money is won on a given day by a given card. A season-long running total
    // is meaningless to a league that settles every Thursday.
    for (const k of ORG_KINDS) expect(moneyLayoutFor(k).rounds, k).toBe(true);
  });

  it("adds the ledger only where the kind has one", () => {
    expect(moneyLayoutFor("club").ledger).toBe(false);
    expect(moneyLayoutFor("community").ledger).toBe(true);
  });

  it("says what the screen covers in each case", () => {
    expect(moneyLayoutFor("club").blurb).not.toMatch(/shared costs/);
    expect(moneyLayoutFor("personal").blurb).toMatch(/shared costs/);
  });
});

describe("when a round's money can be shown", () => {
  it("waits for the round to finish", () => {
    // Final only, never live. The carry is the whole character of skins — one
    // hole can take the lot — so a running position is not an early view of
    // the answer, it is a different number that looks like one.
    expect(roundMoneyIsFinal({ holesReturned: 14, holeCount: 18, roundComplete: false })).toBe(false);
    expect(roundMoneyIsFinal({ holesReturned: 18, holeCount: 18, roundComplete: false })).toBe(true);
  });

  it("accepts the organizer closing the round early", () => {
    // Weather, darkness, a walk-off. If the committee says it is done, it is.
    expect(roundMoneyIsFinal({ holesReturned: 11, holeCount: 18, roundComplete: true })).toBe(true);
  });

  it("shows nothing for a round with no holes", () => {
    expect(roundMoneyIsFinal({ holesReturned: 0, holeCount: 0, roundComplete: true })).toBe(false);
  });

  it("leaves an abandoned round unreported rather than settling it", () => {
    // Its pot has not been won and must not read as if it had.
    expect(roundMoneyIsFinal({ holesReturned: 6, holeCount: 18, roundComplete: false })).toBe(false);
  });
});
