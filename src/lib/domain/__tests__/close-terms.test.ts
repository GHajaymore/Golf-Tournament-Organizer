import { describe, it, expect } from "vitest";
import { wipesOnClose, golfBeganAt, closesAtFrom, roundWindowRefusal, PLANS_THAT_DELETE } from "../close-terms";

/**
 * Which completions delete. The rule's every branch, each against the one
 * case that DOES delete, so a branch that stopped protecting shows up as a
 * true where a false belongs. The real action is exercised in
 * `free-tournament-deleted-on-close.audit.test.ts`.
 */
const NOW = new Date("2026-09-29T12:00:00Z");
const deletes = { planTermsApply: true, plan: "free", shape: "series", retainUntil: null };

describe("what completing deletes", () => {
  it("a Free tournament in a club on the published terms", () => {
    expect(wipesOnClose(deletes, NOW)).toBe(true);
  });

  it("never a club that predates the terms, or one with no subscription row at all", () => {
    expect(wipesOnClose({ ...deletes, planTermsApply: false }, NOW)).toBe(false);
    expect(wipesOnClose({ ...deletes, planTermsApply: null }, NOW)).toBe(false);
    expect(wipesOnClose({ ...deletes, planTermsApply: undefined }, NOW)).toBe(false);
  });

  it("never a plan that keeps its data", () => {
    expect(wipesOnClose({ ...deletes, plan: "society" }, NOW)).toBe(false);
    expect(wipesOnClose({ ...deletes, plan: "club" }, NOW)).toBe(false);
  });

  it("never a casual round, which has its own 24-hour expiry", () => {
    expect(wipesOnClose({ ...deletes, shape: "match" }, NOW)).toBe(false);
  });

  it("never while a hold runs — and again once it has lapsed", () => {
    expect(wipesOnClose({ ...deletes, retainUntil: new Date("2026-10-29T00:00:00Z") }, NOW)).toBe(false);
    expect(wipesOnClose({ ...deletes, retainUntil: new Date("2026-09-01T00:00:00Z") }, NOW)).toBe(true);
  });

  it("names exactly the plans that do not keep data", () => {
    expect(PLANS_THAT_DELETE).toEqual(["free"]);
  });
});

describe("when a Par tournament's golf began", () => {
  it("is nothing while no round has come and nothing is recorded", () => {
    expect(golfBeganAt([], null, NOW)).toBeNull();
    expect(golfBeganAt(["", "not a date"], null, NOW)).toBeNull();
    // A round dated next week has not begun.
    expect(golfBeganAt(["2026-10-06"], null, NOW)).toBeNull();
  });

  it("is the earliest round whose day has come, or the first result seen, whichever is first", () => {
    expect(golfBeganAt(["2026-09-27", "2026-09-28"], null, NOW)).toEqual(new Date("2026-09-27T00:00:00Z"));
    expect(golfBeganAt(["2026-10-06"], NOW, NOW)).toEqual(NOW);
    expect(golfBeganAt(["2026-09-20"], NOW, NOW)).toEqual(new Date("2026-09-20T00:00:00Z"));
  });

  it("closes fourteen days after it began", () => {
    expect(closesAtFrom(new Date("2026-09-20T00:00:00Z"))).toEqual(new Date("2026-10-04T00:00:00Z"));
  });
});

describe("a Par tournament's rounds fall within seven days", () => {
  it("takes a weekend, a rain delay and a two-day outing", () => {
    expect(roundWindowRefusal("2026-10-04", ["2026-10-03"])).toBeNull();
    expect(roundWindowRefusal("2026-10-10", ["2026-10-03"])).toBeNull(); // exactly seven
  });

  it("refuses the eighth day, naming the plan that takes a season", () => {
    const r = roundWindowRefusal("2026-10-11", ["2026-10-03"]);
    expect(r).toMatch(/within 7 days/);
    expect(r).toMatch(/Birdie/);
    // Before the others counts as much as after them.
    expect(roundWindowRefusal("2026-09-25", ["2026-10-03"])).not.toBeNull();
  });

  it("does not refuse a round with no date, or the first date of all", () => {
    expect(roundWindowRefusal("", ["2026-10-03"])).toBeNull();
    expect(roundWindowRefusal("2026-10-03", ["", ""])).toBeNull();
  });
});
