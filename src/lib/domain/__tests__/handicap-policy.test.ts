import { describe, it, expect } from "vitest";
import {
  handicapPolicyOf,
  handicapStanding,
  mayEditHandicapByHand,
  refuseHandByHand,
  STALE_AFTER_DAYS,
} from "../handicap-policy";

/**
 * What a club plays off when the association cannot be reached.
 *
 * Every case here is really the same question asked from a different angle:
 * a round is starting, eighteen people are on the first tee, and the app has
 * to produce a handicap for each of them. The wrong answer is not an error
 * message — it is a competition that looks perfectly normal, is settled, and
 * is paid out before anybody works out why the results were absurd.
 */

const AT = (iso: string) => new Date(iso);
const NOW = AT("2026-08-25T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const ghinClub = (over: Partial<Parameters<typeof handicapStanding>[0]> = {}) =>
  handicapStanding({
    policy: "ghin",
    index: 12.4,
    syncedAt: daysAgo(1),
    ghin: "1234567",
    now: NOW,
    ...over,
  });

describe("which policy a club is on", () => {
  it("defaults to the club's own record, because saying nothing is not opting in", () => {
    expect(handicapPolicyOf(undefined)).toBe("club");
    expect(handicapPolicyOf("")).toBe("club");
    expect(handicapPolicyOf("nonsense")).toBe("club");
  });

  it("reads the setting when a club has actually made one", () => {
    expect(handicapPolicyOf("ghin")).toBe("ghin");
    expect(handicapPolicyOf("  GHIN  ")).toBe("ghin");
  });

  it("stops an organizer typing an index when the club plays off GHIN", () => {
    // "Just use GHIN and no manual" is the whole point of the setting. A club
    // that has said the association is the authority does not want a figure
    // somebody typed sitting alongside it looking equally official.
    expect(mayEditHandicapByHand("ghin")).toBe(false);
    expect(mayEditHandicapByHand("club")).toBe(true);
  });
});

describe("what a GHIN club plays off when GHIN is not answering", () => {
  it("uses the last index actually received, and says how old it is", () => {
    const s = ghinStandingAt(9);
    expect(s.usable).toBe(true);
    if (!s.usable) return;
    expect(s.index).toBe(12.4);
    expect(s.staleDays).toBe(9);
    expect(s.stale).toBe(true);
    expect(s.note).toContain("9 days ago");
  });

  it("does not nag about a figure that is only a day or two old", () => {
    const s = ghinStandingAt(2);
    expect(s.usable).toBe(true);
    if (!s.usable) return;
    expect(s.stale).toBe(false);
    expect(s.note).toBe("");
  });

  it("NEVER produces zero for a player whose index is unknown", () => {
    /**
     * THE FAILURE THIS WHOLE FILE EXISTS TO PREVENT.
     *
     * A 24-handicapper playing off scratch does not look like an outage. It
     * looks like a competition, and the money is settled before anybody works
     * out why the results made no sense. So "unknown" is a STATE, not a
     * number, and nothing downstream can mistake it for one.
     */
    const noNumber = ghinClub({ ghin: "", index: 0 });
    expect(noNumber.usable).toBe(false);
    if (noNumber.usable) return;
    expect(noNumber.reason).toBe("no-ghin-number");
    expect(noNumber).not.toHaveProperty("index");

    const neverFetched = ghinClub({ syncedAt: null, index: 0 });
    expect(neverFetched.usable).toBe(false);
    if (neverFetched.usable) return;
    expect(neverFetched.reason).toBe("never-synced");
    expect(neverFetched).not.toHaveProperty("index");
  });

  it("treats a missing number as an unfinished roster row, not a scratch player", () => {
    // Even with a plausible index sitting on the row, no GHIN number under a
    // GHIN policy means nobody has established where that figure came from.
    const s = ghinClub({ ghin: "   ", index: 18.2 });
    expect(s.usable).toBe(false);
  });

  it("becomes stale exactly at the stated threshold, not around it", () => {
    expect(ghinStandingAt(STALE_AFTER_DAYS - 1).usable && ghinStandingAt(STALE_AFTER_DAYS - 1)).toMatchObject({ stale: false });
    expect(ghinStandingAt(STALE_AFTER_DAYS)).toMatchObject({ stale: true });
  });
});

describe("a club on its own record is not affected by any of this", () => {
  it("uses the figure on the row, with nothing to be stale about", () => {
    // The club's record IS the authority here, and it is as current as the
    // last card. Borrowing GHIN's staleness language would invent a doubt
    // that does not exist.
    const s = handicapStanding({
      policy: "club",
      index: 8.1,
      syncedAt: null,
      ghin: "",
      now: NOW,
    });
    expect(s).toEqual({ usable: true, index: 8.1, staleDays: 0, stale: false, note: "" });
  });
});

/** A GHIN member whose index arrived `days` ago. */
function ghinStandingAt(days: number) {
  return ghinClub({ syncedAt: daysAgo(days) }) as Extract<
    ReturnType<typeof handicapStanding>,
    { usable: true }
  >;
}

describe("no manual, enforced rather than displayed", () => {
  const CURRENT = { handicap: 12.4 };

  it("lets a club on its own record type whatever it likes", () => {
    expect(refuseHandByHand("club", { handicap: 9, handicapSource: "manual" }, CURRENT)).toBeNull();
  });

  it("refuses a typed index when the club plays off GHIN", () => {
    // A greyed-out box is a suggestion. The action behind it is a public HTTP
    // endpoint and will be called with whatever the caller likes.
    const r = refuseHandByHand("ghin", { handicap: 9 }, CURRENT);
    expect(r).toBeTruthy();
    expect(r).toContain("GHIN number");
  });

  it("refuses an attempt to mark the source manual, even at the same figure", () => {
    expect(refuseHandByHand("ghin", { handicap: 12.4, handicapSource: "manual" }, CURRENT)).toBeTruthy();
  });

  it("ALLOWS changing the GHIN number under a GHIN policy", () => {
    // Otherwise the policy is impossible to adopt: connecting a member is
    // exactly the edit a club has to make after switching.
    expect(refuseHandByHand("ghin", { handicapSource: "ghin" }, CURRENT)).toBeNull();
    expect(refuseHandByHand("ghin", {}, CURRENT)).toBeNull();
  });

  it("allows an edit that leaves the figure exactly where it was", () => {
    // Saving a member after correcting their phone number must not be refused
    // because the form posted the handicap it was showing.
    expect(refuseHandByHand("ghin", { handicap: 12.4 }, CURRENT)).toBeNull();
  });

  it("refuses any figure at all when there is nothing to compare to", () => {
    // A member being created has no current handicap, so under a GHIN policy
    // every typed index is a hand-entered one.
    expect(refuseHandByHand("ghin", { handicap: 0 }, { handicap: Number.NaN })).toBeTruthy();
    expect(refuseHandByHand("ghin", { handicap: 18 }, { handicap: Number.NaN })).toBeTruthy();
  });
});

describe("hybrid — the policy most clubs are actually on", () => {
  const WITH = { handicap: 12.4, ghin: "1234567" };
  const WITHOUT = { handicap: 18.0, ghin: "" };

  it("lets the club set a handicap for a member with no GHIN number", () => {
    // A society visitor, or a member who has never held an index. Under
    // "both", these people are ordinary — not an unfinished roster row.
    expect(mayEditHandicapByHand("hybrid", { ghin: "" })).toBe(true);
    expect(refuseHandByHand("hybrid", { handicap: 20, handicapSource: "manual" }, WITHOUT)).toBeNull();
  });

  it("refuses a hand-typed figure for a member who HAS one", () => {
    // Their index belongs to the association. The message names the fix —
    // clear the number — because a rule an organizer cannot act on reads as
    // arbitrary.
    expect(mayEditHandicapByHand("hybrid", { ghin: "1234567" })).toBe(false);
    const r = refuseHandByHand("hybrid", { handicap: 9 }, WITH);
    expect(r).toBeTruthy();
    expect(r).toContain("Clear their GHIN number");
  });

  it("does not flag a member without a number as a problem", () => {
    /**
     * THE BRANCH THAT MAKES HYBRID WORTH HAVING. The same roster row that
     * blocks a round at a GHIN-only club is perfectly ordinary here, so it
     * must not be decorated with a warning — a club that deliberately chose
     * "both" would otherwise see half its roster flagged forever.
     */
    const s = handicapStanding({
      policy: "hybrid",
      index: 18,
      syncedAt: null,
      ghin: "",
      now: NOW,
    });
    expect(s).toEqual({ usable: true, index: 18, staleDays: 0, stale: false, note: "" });
  });

  it("still ages an association figure for a member who has one", () => {
    const s = handicapStanding({
      policy: "hybrid",
      index: 12.4,
      syncedAt: daysAgo(30),
      ghin: "1234567",
      now: NOW,
    });
    expect(s.usable).toBe(true);
    if (!s.usable) return;
    expect(s.stale).toBe(true);
    expect(s.note).toContain("30 days ago");
  });

  it("still blocks a member with a number that has never been fetched", () => {
    // They are on the association's side of the roster, and nothing has come
    // back for them — so there is no figure to play off, and zero is not one.
    const s = handicapStanding({
      policy: "hybrid",
      index: 0,
      syncedAt: null,
      ghin: "1234567",
      now: NOW,
    });
    expect(s.usable).toBe(false);
  });
});
