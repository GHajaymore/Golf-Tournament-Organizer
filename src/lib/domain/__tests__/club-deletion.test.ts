import { describe, it, expect } from "vitest";
import { clubDeletionRefusal, paidPlanRunning, type ClubDeletionInput } from "../club-deletion";

const base: ClubDeletionInput = {
  role: "owner",
  clubName: "ZZ Fairway Society",
  typedName: "ZZ Fairway Society",
  subscription: { plan: "free", status: "active", provider: "", providerSubscriptionId: null },
};

describe("who may delete a club", () => {
  it("the owner, typing its name, with no paid plan running", () => {
    expect(clubDeletionRefusal(base)).toBeNull();
  });

  it("never an admin, a member, or somebody with no membership at all", () => {
    for (const role of ["admin", "member", "guest", null]) {
      expect(clubDeletionRefusal({ ...base, role }), String(role)).toMatch(/Only the club's owner/);
    }
  });

  it("not while Stripe is still billing it — in any billing state", () => {
    for (const status of ["active", "trialing", "past_due"]) {
      const sub = { plan: "club", status, provider: "stripe", providerSubscriptionId: "sub_zz" };
      expect(clubDeletionRefusal({ ...base, subscription: sub }), status).toMatch(/paid plan running/);
    }
  });

  it("once the paid plan has ended, it can go", () => {
    const ended = { plan: "free", status: "canceled", provider: "stripe", providerSubscriptionId: "sub_zz" };
    expect(clubDeletionRefusal({ ...base, subscription: ended })).toBeNull();
  });

  it("a plan arranged by hand is not a Stripe bill and does not block it", () => {
    expect(paidPlanRunning({ plan: "club", status: "active", provider: "", providerSubscriptionId: null })).toBe(false);
  });

  it("the name must be typed exactly — not nearly, and not empty", () => {
    for (const typed of ["", "zz fairway society", "ZZ Fairway", "ZZ Fairway Society."]) {
      expect(clubDeletionRefusal({ ...base, typedName: typed }), typed).toMatch(/Type the club's name/);
    }
    // Surrounding spaces are forgiven; the name itself is not.
    expect(clubDeletionRefusal({ ...base, typedName: "  ZZ Fairway Society " })).toBeNull();
  });

  it("speaks of a society as a society", () => {
    expect(clubDeletionRefusal({ ...base, role: "admin", noun: "society" })).toBe("Only the society's owner can delete it.");
  });

  it("a club with no name cannot be confirmed by typing nothing", () => {
    expect(clubDeletionRefusal({ ...base, clubName: "", typedName: "" })).toMatch(/Type the club's name/);
  });
});
