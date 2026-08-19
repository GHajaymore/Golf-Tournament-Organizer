import { describe, it, expect } from "vitest";
import { orgProfile, isOrgKind, ORG_KINDS, type OrgKind } from "@/lib/domain/org-profile";
import { roundMoneyIsFinal } from "@/lib/domain/money-layout";

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

  it("scopes the ledger to costs somebody fronted, not to counting money", () => {
    // There was a second flag here, `tracksCash`, and a test asserting it
    // equalled `ledger` on every kind — so it was a second name for one rule,
    // which is this codebase's recurring defect. It was also read by nothing,
    // and its claim ("the app does not track who has paid at a club")
    // became false once a club's players could see their pots: a member who
    // stakes in the skins and wins nothing is shown a negative number.
    //
    // What survives is the true distinction. A stake in a pot is a RESULT,
    // settled at the bar; a share of the minibus is a DEBT. Only the second is
    // kind-dependent, and `ledger` is the one flag that says so.
    expect(orgProfile("club").ledger).toBe(false);
    expect(orgProfile("community").ledger).toBe(true);
    expect(orgProfile("personal").ledger).toBe(true);
    expect("tracksCash" in orgProfile("club")).toBe(false);
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
      expect(p.noun.length, k).toBeGreaterThan(0);
      expect(p.blurb.length, k).toBeGreaterThan(0);
      expect(typeof p.ledger, k).toBe("boolean");
      expect(typeof p.sharedRoster, k).toBe("boolean");
      expect(typeof p.seasonPlay, k).toBe("boolean");
      expect(typeof p.ownsCourse, k).toBe("boolean");
    }
  });

  it("gives every kind a noun that survives being put in a sentence", () => {
    // `label` is a chip and does not. OrgSetupChecklist rendered "Setting up
    // your personal" and "Name your personal" from lowercasing it — neither is
    // English, and nobody saw them because the component was never mounted.
    for (const k of ORG_KINDS) {
      const noun = orgProfile(k).noun;
      expect(`Setting up your ${noun}`, k).not.toMatch(/your personal$/);
      // A noun, not a title-cased label dropped in.
      expect(noun, k).toBe(noun.toLowerCase());
      expect(noun.split(" ").length, k).toBe(1);
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

/**
 * `moneyLayoutFor` was tested here and is gone — see money-layout.ts for why.
 * It decided "does this screen have a ledger?" from the org kind, which
 * `resolveMoneyMode` already owns and which disagreed with it the moment a
 * club set one tournament to split. What it used to assert now lives where the
 * rule does: money-mode.test.ts covers the ledger and the money screen, and
 * org-setup.test.ts covers what each kind is asked to set up.
 */

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
