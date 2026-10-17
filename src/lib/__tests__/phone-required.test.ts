import { describe, it, expect } from "vitest";
import { phoneRequiredFor, upgradeBenefits, PHONE_REQUIRED_FREE } from "@/lib/plans";

/**
 * Who has to give a mobile number.
 *
 * The rule lives in one function because four different places create an
 * entrant — the public form, the organizer's own add, the entry CSV import and
 * picking members off the club roster. Four copies of "is a phone required
 * here" is exactly how a form comes to ask for something the action does not
 * enforce, or refuse something the form said was optional.
 */

describe("whether a mobile is required", () => {
  it("always, on the free plan, where players sign in by email", () => {
    expect(phoneRequiredFor("free", false, "email")).toBe(true);
    expect(phoneRequiredFor("free", true, "email")).toBe(true);
  });

  it("never, on the free plan, where players use round codes (Ajay, 2026-10-17)", () => {
    // A code-scored tournament reaches its players by the code; a mobile it
    // insisted on refused thirteen guests of a real cup the day before.
    expect(phoneRequiredFor("free", false, "code")).toBe(false);
    expect(phoneRequiredFor("free", true, "both")).toBe(false);
  });

  it("is the organizer's own per-tournament choice on a paid plan, codes or not", () => {
    expect(phoneRequiredFor("club", false, "email")).toBe(false);
    expect(phoneRequiredFor("club", true, "email")).toBe(true);
    expect(phoneRequiredFor("club", true, "code")).toBe(true);
    expect(phoneRequiredFor("club", false, "code")).toBe(false);
  });

  it("falls back to the strict side for an unknown or missing plan", () => {
    // An unknown plan key resolves to free everywhere else in this file, and
    // free is the stricter answer — so a bad key asks for more, never less.
    // Failing open here would let a typo'd plan key quietly drop a
    // requirement an organizer was relying on.
    expect(phoneRequiredFor(null, false, "email")).toBe(true);
    expect(phoneRequiredFor(undefined, false, "email")).toBe(true);
    expect(phoneRequiredFor("enterprise-typo", false, "email")).toBe(true);
    // And an unknown sign-in is the strict side too.
    expect(phoneRequiredFor("free", false, "")).toBe(true);
    expect(phoneRequiredFor("free", false, undefined)).toBe(true);
  });
});

describe("what a free club is told", () => {
  it("is offered the choice as a reason to upgrade", () => {
    const benefits = upgradeBenefits("free");
    expect(benefits.some((b) => /mobile number/.test(b))).toBe(true);
  });

  it("is not offered it once they already have it", () => {
    // A benefits list that includes what you already bought reads as a mistake.
    expect(upgradeBenefits("club").some((b) => /whether each tournament asks/.test(b))).toBe(false);
  });

  it("explains the lock in terms of what upgrading buys", () => {
    expect(PHONE_REQUIRED_FREE).toMatch(/free plan/i);
    expect(PHONE_REQUIRED_FREE).toMatch(/upgrade/i);
  });
});
