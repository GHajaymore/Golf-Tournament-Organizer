import { describe, it, expect } from "vitest";
import {
  QUICK_ROUND_TTL_HOURS,
  expiryFrom,
  isExpired,
  hoursLeft,
  expiryNotice,
} from "../round-expiry";

/**
 * The rules behind the only scheduled DELETE in the product.
 *
 * Everything here is about one direction of failure. A round kept a few hours
 * too long is a row in a table; a tournament swept away takes its field, its
 * cards, its money and its history with it, unattended, with no way back. So
 * the null case is asserted first and hardest — a tournament has no expiry,
 * and "no expiry" must never read as "expired".
 */
describe("when a casual round runs out", () => {
  const T0 = new Date("2026-09-08T09:00:00.000Z");

  it("expires a day after it was set up", () => {
    expect(QUICK_ROUND_TTL_HOURS).toBe(24);
    // The VALUE, not "some time later". A test that only asserted the expiry
    // is after creation passes a TTL of one minute.
    expect(expiryFrom(T0).toISOString()).toBe("2026-09-09T09:00:00.000Z");
  });

  it("never expires a row that has no expiry", () => {
    /**
     * THE ONE THAT MATTERS. Every tournament in the database is this case, and
     * the failure mode is not "a bug" — it is a scheduled job deleting other
     * people's tournaments overnight.
     *
     * Asserted against a null, an undefined, and a missing key, because those
     * are three different values a row can arrive as and a null compared
     * against a date is exactly the shape that quietly answers "yes".
     */
    const distantFuture = new Date("2099-01-01T00:00:00.000Z");
    expect(isExpired({ expiresAt: null }, distantFuture)).toBe(false);
    expect(isExpired({ expiresAt: undefined }, distantFuture)).toBe(false);
    expect(isExpired({}, distantFuture)).toBe(false);
    expect(hoursLeft({ expiresAt: null }, distantFuture)).toBeNull();
  });

  it("expires exactly when its time is up, and not before", () => {
    const at = expiryFrom(T0);
    const secondBefore = new Date(at.getTime() - 1000);
    const secondAfter = new Date(at.getTime() + 1000);

    expect(isExpired({ expiresAt: at }, secondBefore)).toBe(false);
    expect(isExpired({ expiresAt: at }, at)).toBe(true);
    expect(isExpired({ expiresAt: at }, secondAfter)).toBe(true);
    // Both answers appear above, so the test cannot be satisfied by a function
    // that returns a constant.
  });

  it("counts down in whole hours, and never promises time that has gone", () => {
    const at = expiryFrom(T0);
    expect(hoursLeft({ expiresAt: at }, T0)).toBe(24);
    // Rounded DOWN: 50 minutes left is 0 hours, not 1. Rounding up is the
    // direction that loses somebody's card.
    expect(hoursLeft({ expiresAt: at }, new Date(at.getTime() - 50 * 60 * 1000))).toBe(0);
    // Floored at zero rather than going negative, so nothing renders "-3".
    expect(hoursLeft({ expiresAt: at }, new Date(at.getTime() + 99 * 60 * 60 * 1000))).toBe(0);
  });
});

describe("what the player is told", () => {
  it("says nothing at all about a round that never expires", () => {
    expect(expiryNotice(null)).toBe("");
  });

  it("uses the word that means what happens", () => {
    // "Archived" and "cleared" both read as recoverable. This is not.
    const notice = expiryNotice(7);
    expect(notice).toMatch(/deleted/i);
    expect(notice).not.toMatch(/archiv|clear|hidden|tidied/i);
  });

  it("names the way out, because a warning with no action is just bad news", () => {
    expect(expiryNotice(7)).toMatch(/keep it/i);
    expect(expiryNotice(0)).toMatch(/keep it/i);
  });

  it("does not promise an hour the sweep cannot keep", () => {
    /**
     * The sweep runs once a day, so a round that expires at 07:00 is not
     * actually removed until the next pass. The first version of this said
     * "deleted in about 7 hours", read straight off `hoursLeft`, and it would
     * have been a lie in the direction that matters — the person who believes
     * the precise version is the one who waits.
     */
    for (const h of [1, 2, 7, 23]) {
      expect(expiryNotice(h), `${h}h`).not.toMatch(/\d+\s*hour/i);
    }
    expect(expiryNotice(7)).toMatch(/about a day/i);
  });
});
