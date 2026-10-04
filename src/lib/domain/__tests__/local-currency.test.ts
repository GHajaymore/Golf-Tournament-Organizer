import { describe, it, expect } from "vitest";
import { localCurrency, requestCountry, stakeMinorUnits } from "../local-currency";
import { planMatch } from "../quick-match";
import { readSource } from "../../__tests__/source";

/**
 * A CASUAL ROUND'S CURRENCY: where it is set up, with US dollars one tap away
 * (Ajay, 2026-10-04). Each cell is built so the wrong answer differs from the
 * right one — a country that is not the US, a currency that is not dollars.
 */
describe("localCurrency", () => {
  it("is the currency of the country the round is set up in", () => {
    expect(localCurrency("GB")).toBe("GBP");
    expect(localCurrency("UK")).toBe("GBP");
    expect(localCurrency("IE")).toBe("EUR");
    expect(localCurrency("FR")).toBe("EUR");
    expect(localCurrency("CA")).toBe("CAD");
    expect(localCurrency("AU")).toBe("AUD");
    expect(localCurrency("JP")).toBe("JPY");
    expect(localCurrency("IN")).toBe("INR");
    expect(localCurrency("CH")).toBe("CHF");
  });

  it("is US dollars in the US and anywhere it cannot tell", () => {
    for (const c of ["US", "", null, undefined, "ZZ", "Unknown"]) expect(localCurrency(c), String(c)).toBe("USD");
  });
});

describe("requestCountry", () => {
  it("trusts Vercel's reading of the connection first", () => {
    expect(requestCountry("gb", "en-US,en;q=0.9")).toBe("GB");
  });

  it("falls back to the region of the browser's first language", () => {
    expect(requestCountry(null, "en-GB,en;q=0.9")).toBe("GB");
    expect(requestCountry("", "ja-JP")).toBe("JP");
    expect(requestCountry(undefined, "fr")).toBe("");
    expect(requestCountry(undefined, "")).toBe("");
  });
});

describe("stakeMinorUnits", () => {
  it("counts in the currency's own minor units — a yen has none", () => {
    expect(stakeMinorUnits("5", "USD")).toBe(500);
    expect(stakeMinorUnits("£5.50", "GBP")).toBe(550);
    expect(stakeMinorUnits("500", "JPY")).toBe(500);
  });

  it("is nothing for nothing", () => {
    for (const t of ["", "abc", "0", "-3"]) expect(stakeMinorUnits(t, "USD"), t).toBe(0);
  });
});

describe("the round keeps the currency it was set up in", () => {
  const base = {
    format: "Match Play",
    players: [
      { name: "zz-Ann", handicap: 0 },
      { name: "zz-Bob", handicap: 0 },
    ],
  };

  it("plans a valid code, upper-cased, and ignores anything else", () => {
    const plan = (currency: unknown) => {
      const r = planMatch({ ...base, currency: currency as string });
      if (!r.ok) throw new Error(r.error);
      return r.plan.currency;
    };
    expect(plan("gbp")).toBe("GBP");
    expect(plan("JPY")).toBe("JPY");
    // A public endpoint: a bad code costs nobody their round, it is just not used.
    expect(plan("XYZ")).toBe("");
    expect(plan("")).toBe("");
    expect(plan(undefined)).toBe("");
  });

  it("is written to the round, and the setup screen starts from the request's country", () => {
    expect(readSource("src", "app", "actions", "match-setup.ts")).toContain("currencyOverride: plan.currency");
    const page = readSource("src", "app", "match", "new", "page.tsx");
    expect(page).toContain('localCurrency(requestCountry(h.get("x-vercel-ip-country"), h.get("accept-language")))');
    const form = readSource("src", "components", "NewMatchForm.tsx");
    expect(form).toContain("useState(localCurrency)");
    expect(form).toContain("setCurrency(DEFAULT_CURRENCY)");
  });
});
