import { describe, it, expect } from "vitest";
import { wipesOnClose } from "../close-terms";

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
});
