import { describe, it, expect } from "vitest";
import { earlyListBatch, owedCodes, resendDailyLimit, DEFAULT_DAILY_LIMIT } from "@/lib/domain/early-list";

/**
 * WHO IS OWED AN EARLY-LIST CODE, AND HOW MANY GO TODAY (2026-10-23).
 *
 * The early list was promised, while held, "25% off … One code per club, emailed at launch". So:
 * one code per ADDRESS (a person may have written three notes), only for notes written BEFORE the
 * switch went live (after that, /interest promised nothing), never twice — and never more in a day
 * than the mail service allows (`RESEND_DAILY_LIMIT`), the rest waiting for the owner's next press.
 */

const at = (iso: string) => new Date(iso);
const LIVE = at("2026-11-01T09:00:00Z");
const notes = [
  { email: "zz-a@example.invalid", name: "Zz Ann", createdAt: at("2026-10-22T10:00:00Z") },
  { email: "ZZ-A@Example.invalid", name: "Zz Ann again", createdAt: at("2026-10-23T10:00:00Z") },
  { email: "zz-b@example.invalid", name: "Zz Bo", createdAt: at("2026-10-21T10:00:00Z") },
  { email: "zz-late@example.invalid", name: "Zz Late", createdAt: at("2026-11-02T10:00:00Z") },
];

describe("who is owed a code", () => {
  it("one per address, whatever its case, under the name of its first note, oldest first", () => {
    expect(owedCodes(notes, new Set(), LIVE)).toEqual([
      { email: "zz-b@example.invalid", name: "Zz Bo" },
      { email: "zz-a@example.invalid", name: "Zz Ann" },
    ]);
  });
  it("not somebody who wrote after go-live — they were promised no code", () => {
    expect(owedCodes(notes, new Set(), LIVE).map((o) => o.email)).not.toContain("zz-late@example.invalid");
    // CONTROL: with no go-live time known (live by the environment), every note stood under the offer.
    expect(owedCodes(notes, new Set(), null).map((o) => o.email)).toContain("zz-late@example.invalid");
  });
  it("never twice", () => {
    expect(owedCodes(notes, new Set(["zz-a@example.invalid"]), LIVE)).toEqual([{ email: "zz-b@example.invalid", name: "Zz Bo" }]);
  });
});

describe("the mail service's daily limit", () => {
  it("is RESEND_DAILY_LIMIT, a whole number of one or more, or the free plan's 100", () => {
    expect(resendDailyLimit({ RESEND_DAILY_LIMIT: "3000" })).toBe(3000);
    for (const v of [undefined, "", "0", "-5", "lots", "2.5"]) expect(resendDailyLimit({ RESEND_DAILY_LIMIT: v }), String(v)).toBe(DEFAULT_DAILY_LIMIT);
    expect(DEFAULT_DAILY_LIMIT).toBe(100);
  });

  it("sends what fits in the last 24 hours now, and says when the rest can go", () => {
    const now = at("2026-11-01T12:00:00Z");
    expect(earlyListBatch({ owed: 30, sentInLastDay: 0, oldestInLastDay: null, limit: 100, now })).toEqual({ now: 30, later: 0, nextAt: null });
    const over = earlyListBatch({ owed: 140, sentInLastDay: 0, oldestInLastDay: null, limit: 100, now });
    expect(over).toEqual({ now: 100, later: 40, nextAt: at("2026-11-02T12:00:00Z") });
    // A second press the same day: what was sent at 12:00 still fills the window until 12:00 tomorrow.
    const again = earlyListBatch({ owed: 40, sentInLastDay: 100, oldestInLastDay: now, limit: 100, now: at("2026-11-01T15:00:00Z") });
    expect(again).toEqual({ now: 0, later: 40, nextAt: at("2026-11-02T12:00:00Z") });
  });
});
