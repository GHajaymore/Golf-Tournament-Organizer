import { describe, expect, it } from "vitest";
import { PLANS, effectivePrice, parsePricingOverrides } from "@/lib/plans";

/**
 * A PRICE IS CONFIGURABLE WITHOUT A CODE EDIT, and cannot be broken by a bad
 * config value.
 *
 * `priceMonthly` in `PLANS` is the default; `effectivePrice` quotes an override
 * when there is a valid one, else that default. The env supplies the override
 * today and the owner console will supply the same shape later, so the resolver
 * takes it as a parameter and this test drives it that way — no `process.env`
 * mutation, so the cases are deterministic and independent.
 *
 * The parse REFUSES TO THROW, the same contract as `featureOverrides`: every
 * malformed shape falls back to the plan's own price. The control is the one
 * case that must CHANGE the number — without it, a resolver that ignored
 * overrides entirely would pass every other assertion here.
 */

describe("subscription prices are configurable and fail safe", () => {
  it("quotes the plan's own price when nothing overrides it", () => {
    expect(effectivePrice(PLANS.club, { plans: {} })).toBe(PLANS.club.priceMonthly);
    expect(effectivePrice(PLANS.free, { plans: {} })).toBe(0);
  });

  it("CONTROL: a valid override changes the quoted price", () => {
    const overrides = parsePricingOverrides('{"plans":{"club":{"monthly":39}}}');
    expect(overrides.plans.club?.monthly).toBe(39);
    expect(effectivePrice(PLANS.club, overrides)).toBe(39);
    // A plan the override does not name still quotes its own default.
    expect(effectivePrice(PLANS.free, overrides)).toBe(0);
  });

  it("a price of zero is a real override, not a missing one", () => {
    const overrides = parsePricingOverrides('{"plans":{"club":{"monthly":0}}}');
    expect(effectivePrice(PLANS.club, overrides)).toBe(0);
  });

  it("falls back to the default on every malformed shape", () => {
    const bad = [
      "", // nothing set
      "not json", // unparseable
      "[]", // array, not an object
      "null",
      '{"plans":"nope"}', // plans not an object
      '{"plans":{"club":{"monthly":"39"}}}', // string, not a number
      '{"plans":{"club":{"monthly":-1}}}', // negative
      '{"plans":{"club":{"monthly":true}}}', // boolean
      '{"plans":{"nosuchtier":{"monthly":5}}}', // unknown plan key
      '{"club":{"monthly":39}}', // missing the `plans` wrapper
    ];
    for (const raw of bad) {
      expect(effectivePrice(PLANS.club, parsePricingOverrides(raw)), raw).toBe(
        PLANS.club.priceMonthly,
      );
    }
  });

  it("NaN and Infinity are not prices", () => {
    // These cannot come from JSON.parse directly, but a future caller could
    // hand them in; the guard is `Number.isFinite`, so prove it holds.
    expect(effectivePrice(PLANS.club, { plans: { club: { monthly: NaN } } })).toBe(
      PLANS.club.priceMonthly,
    );
  });

  it("reads the override from the environment when none is passed", () => {
    // The end-to-end path the deployment actually uses: set the env value, and
    // `effectivePrice` with no explicit overrides quotes it. Env restored in a
    // finally so the case cannot leak into another test's run.
    const prev = process.env.TOURNEYHQ_PRICING;
    try {
      process.env.TOURNEYHQ_PRICING = '{"plans":{"club":{"monthly":49}}}';
      expect(effectivePrice(PLANS.club)).toBe(49);
    } finally {
      if (prev === undefined) delete process.env.TOURNEYHQ_PRICING;
      else process.env.TOURNEYHQ_PRICING = prev;
    }
    // And it is back to the default once the env value is gone.
    expect(effectivePrice(PLANS.club)).toBe(PLANS.club.priceMonthly);
  });
});
