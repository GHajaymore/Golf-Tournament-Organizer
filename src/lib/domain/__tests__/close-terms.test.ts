import { describe, it, expect } from "vitest";
import { wipesOnClose, golfBeganAt, closesAtFrom, closesAtOnComplete, reopenRefusal, KEPT_AFTER_COMPLETE_DAYS, roundWindowRefusal, holesEntered, casualKeepRefusal, PLANS_THAT_DELETE } from "../close-terms";

describe("a Par tournament completed is kept, read-only, for 15 days (Ajay, 2026-10-21)", () => {
  const DAY = 24 * 3600 * 1000;
  const at = (d: number) => new Date(Date.UTC(2026, 9, 1) + d * DAY);
  it("is fifteen days", () => expect(KEPT_AFTER_COMPLETE_DAYS).toBe(15));
  it("completed with no clock yet: closes fifteen days on", () => {
    expect(closesAtOnComplete(null, at(3))).toEqual(at(18));
  });
  it("completed the day after the golf (14-day clock running): fifteen days from completing", () => {
    // golf day 1 → clock day 15; completed day 2 → 17, later than the clock, inside the cap (30)
    expect(closesAtOnComplete(at(15), at(2))).toEqual(at(17));
  });
  it("completed late: still fifteen days from completing", () => {
    expect(closesAtOnComplete(at(15), at(13))).toEqual(at(28));
  });
  it("never earlier than a clock already running", () => {
    expect(closesAtOnComplete(at(20), at(1))).toEqual(at(20));
  });
  it("a completed Par tournament cannot be reopened — so completing cannot be repeated to buy time", () => {
    const par = { planTermsApply: true, plan: "free", shape: "stroke", archivedAt: null };
    expect(reopenRefusal(par, "Mon 19 Oct")).toMatch(/kept read-only until Mon 19 Oct, then deleted/);
    // a paid club, a grandfathered club, and a casual round may reopen as before
    expect(reopenRefusal({ ...par, plan: "society" }, "Mon 19 Oct")).toBeNull();
    expect(reopenRefusal({ ...par, planTermsApply: false }, "Mon 19 Oct")).toBeNull();
    expect(reopenRefusal({ ...par, shape: "match" }, "Mon 19 Oct")).toBeNull();
    // a lapsed club's archived tournament follows the archive, never Par's fifteen days
    expect(reopenRefusal({ ...par, archivedAt: new Date("2026-10-01T00:00:00Z") }, "Mon 19 Oct")).toBeNull();
  });
});

describe("whether a casual round may be kept", () => {
  it("not on the Par terms", () => {
    expect(casualKeepRefusal({ plan: "free", planTermsApply: true })).toMatch(/kept for 24 hours/);
  });
  it("yes for a club that predates them, a paying club, or a club with no row", () => {
    expect(casualKeepRefusal({ plan: "free", planTermsApply: false })).toBeNull();
    expect(casualKeepRefusal({ plan: "society", planTermsApply: true })).toBeNull();
    expect(casualKeepRefusal(null)).toBeNull();
  });
});

describe("what counts as golf having been played", () => {
  it("any stroke on a card", () => {
    expect(holesEntered("[4,null,null]")).toBe(true);
    expect(holesEntered("[null,null]")).toBe(false);
    expect(holesEntered("[]")).toBe(false);
  });

  it("any hole of a match — which is stored as a LETTER, not a number", () => {
    // The loophole this closes: a digit test missed every match-play result.
    expect(holesEntered('["A",null]')).toBe(true);
    expect(holesEntered('[null,"H"]')).toBe(true);
    expect(holesEntered('["B"]')).toBe(true);
  });

  it("never throws on a stored value it cannot read", () => {
    expect(holesEntered("not json")).toBe(false);
    expect(holesEntered('{"a":1}')).toBe(false);
  });
});

/**
 * Which completions delete. The rule's every branch, each against the one
 * case that DOES delete, so a branch that stopped protecting shows up as a
 * true where a false belongs. The real action is exercised in
 * `free-tournament-deleted-on-close.audit.test.ts`.
 */
const NOW = new Date("2026-09-29T12:00:00Z");
const deletes = { planTermsApply: true, plan: "free", shape: "series", retainUntil: null, archivedAt: null };

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

  it("never a tournament in a lapsed paid club's archive, which keeps its own twelve months", () => {
    expect(wipesOnClose({ ...deletes, archivedAt: new Date("2026-09-01T00:00:00Z") }, NOW)).toBe(false);
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
