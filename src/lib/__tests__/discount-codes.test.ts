import { describe, it, expect } from "vitest";
import { normalizeDiscountCode, isValidPercentOff, discountedPrice } from "@/lib/plans";

/**
 * The pure half of discount codes — the normalisation a redemption will match
 * on and the arithmetic a discounted price is quoted from. Both are defensive
 * at the sink, because a bad code or a bad percent must never become a wrong
 * price on a screen.
 */

describe("normalizeDiscountCode", () => {
  it("upper-cases, trims and strips spaces so entry is forgiving", () => {
    expect(normalizeDiscountCode("  run-20 ")).toBe("RUN-20");
    expect(normalizeDiscountCode("a b c")).toBe("ABC");
    expect(normalizeDiscountCode("launch")).toBe("LAUNCH");
  });
  it("is empty for empty input", () => {
    expect(normalizeDiscountCode("")).toBe("");
    expect(normalizeDiscountCode(null)).toBe("");
    expect(normalizeDiscountCode(undefined)).toBe("");
  });
});

describe("isValidPercentOff accepts only a whole 1–100", () => {
  it("accepts the ends and the middle", () => {
    for (const p of [1, 20, 50, 99, 100]) expect(isValidPercentOff(p)).toBe(true);
  });
  it("rejects zero, over 100, negatives and fractions", () => {
    for (const p of [0, 101, -5, 3.5, NaN, Infinity]) expect(isValidPercentOff(p)).toBe(false);
  });
});

describe("discountedPrice applies a whole percent, rounded, never negative", () => {
  it("takes the percent off and rounds to whole units", () => {
    expect(discountedPrice(100, 20)).toBe(80);
    expect(discountedPrice(175, 50)).toBe(88); // 87.5 rounds to 88
    expect(discountedPrice(49, 25)).toBe(37); // 36.75 rounds to 37
  });
  it("100% off is free, and it never goes below zero or above the price", () => {
    expect(discountedPrice(49, 100)).toBe(0);
    expect(discountedPrice(0, 50)).toBe(0);
    expect(discountedPrice(100, 1)).toBe(99);
  });
  it("an out-of-range or fractional percent leaves the price untouched", () => {
    // The defensive sink: a bad discount quotes the real price, not a wrong one.
    expect(discountedPrice(100, 0)).toBe(100);
    expect(discountedPrice(100, 150)).toBe(100);
    expect(discountedPrice(100, -10)).toBe(100);
    expect(discountedPrice(100, 3.5)).toBe(100);
  });
});
