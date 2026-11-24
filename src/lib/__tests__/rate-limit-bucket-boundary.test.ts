import { describe, it, expect } from "vitest";
import { RATE_LIMITS, bucketKeyFor } from "../domain/rate-limit";

/**
 * B109: the window bucket turns over on the epoch-aligned quarter hour. A spec that seeds counter rows for "now" and presses a
 * second later can land on the far side of that line, so e2e/guest-mint-refused.spec.ts seeds this window and the next. These
 * pin the line itself, worked from the clock (not from the formula): 04:14:59.999 UTC and 04:15:00.000 UTC on 2026-11-23.
 */
const WINDOW = RATE_LIMITS["guest-mint-slow"].windowMs;
const ROLL = Date.UTC(2026, 10, 23, 4, 15, 0, 0);

describe("the guest-mint-slow window boundary", () => {
  it("is fifteen minutes", () => {
    expect(WINDOW).toBe(15 * 60_000);
  });
  it("a press 1 ms before the quarter hour and one at it count in different buckets", () => {
    expect(bucketKeyFor("guest-mint-slow", "who", ROLL - 1)).not.toBe(bucketKeyFor("guest-mint-slow", "who", ROLL));
  });
  it("the whole quarter hour shares one key, and the seed for 'next' is the key a rolled-over press uses", () => {
    const first = bucketKeyFor("guest-mint-slow", "who", ROLL);
    expect(bucketKeyFor("guest-mint-slow", "who", ROLL + WINDOW - 1)).toBe(first);
    expect(bucketKeyFor("guest-mint-slow", "who", ROLL - 1 + WINDOW)).toBe(first);
    expect(bucketKeyFor("guest-mint-slow", "who", ROLL - 1 + 1)).toBe(first);
  });
  it("the hourly alarm turns over on the hour, not the quarter", () => {
    expect(bucketKeyFor("guest-mint-alarm", "who", ROLL)).toBe(bucketKeyFor("guest-mint-alarm", "who", ROLL - 1));
    const hour = Date.UTC(2026, 10, 23, 5, 0, 0, 0);
    expect(bucketKeyFor("guest-mint-alarm", "who", hour)).not.toBe(bucketKeyFor("guest-mint-alarm", "who", hour - 1));
  });
});
