import { describe, expect, it } from "vitest";
import {
  PLANS,
  PLAN_CURRENCIES,
  WORLD_REGION_ID,
  annualMonthsCharged,
  effectiveAnnualPrice,
  effectivePrice,
  effectiveRegions,
  parsePricingOverrides,
  planQuote,
  quoteCountryFor,
  quoteCurrency,
  regionFor,
  yearlyFreeWords,
  type PlanKey,
  type PricingOverrides,
} from "@/lib/plans";
import { cleanAnnualMonths, cleanRegionInputs } from "@/lib/domain/plan-edit";

/**
 * PRICE BY REGION (Ajay, 2026-11-10).
 *
 * The migration is the part that cannot be allowed to be wrong: a region is new, a club's price is not.
 * So the ORACLE here is the pre-region rule written out by hand (a price is chosen by CURRENCY: the USD
 * override or the plan's own USD price, a `byCurrency` override or the plan's own local price) and every
 * club's quote must equal it, for every plan x every currency x with and without an override.
 */

const NONE: PricingOverrides = { plans: {} };

/** A country that trades in each plan currency (the default regions' own countries). */
const COUNTRY_OF: Record<string, string> = { USD: "US", GBP: "GB", EUR: "DE", CAD: "CA", AUD: "AU", NZD: "NZ", ZAR: "ZA" };

/** The rule before regions, from the row's own fields. */
function oldPrice(plan: (typeof PLANS)[PlanKey], o: PricingOverrides, currency: string): number {
  const entry = o.plans[plan.key];
  if (currency === "USD") return typeof entry?.monthly === "number" ? entry.monthly : plan.priceMonthly;
  const local = entry?.byCurrency?.[currency as "GBP"];
  return typeof local === "number" ? local : plan.localMonthly[currency as "GBP"];
}

const ROWS: Record<string, string> = {
  "no row": "",
  "a dollar price": '{"plans":{"club":{"monthly":150}}}',
  "a sterling price": '{"plans":{"club":{"byCurrency":{"GBP":129}}}}',
  "every kind at once": '{"plans":{"club":{"monthly":150,"byCurrency":{"GBP":129,"ZAR":2999}},"society":{"monthly":55,"byCurrency":{"EUR":49,"CAD":70}}}}',
  "a zero price": '{"plans":{"society":{"monthly":0,"byCurrency":{"NZD":0}}}}',
};

describe("moving to regions changes no price a club sees today", () => {
  for (const [label, raw] of Object.entries(ROWS)) {
    const o = parsePricingOverrides(raw);
    it(`${label}: every plan, every currency, monthly and yearly`, () => {
      for (const plan of Object.values(PLANS)) {
        for (const currency of PLAN_CURRENCIES) {
          const country = COUNTRY_OF[currency];
          expect(effectivePrice(plan, o, country), `${plan.key} ${currency}`).toBe(oldPrice(plan, o, currency));
          expect(effectiveAnnualPrice(plan, o, country), `${plan.key} ${currency} yearly`).toBe(oldPrice(plan, o, currency) * 10);
          expect(quoteCurrency(o, country)).toBe(currency);
        }
      }
    });

    it(`${label}: a currency with no price point is still quoted in dollars`, () => {
      for (const plan of Object.values(PLANS)) {
        expect(effectivePrice(plan, o, "JP")).toBe(oldPrice(plan, o, "USD"));
        expect(effectivePrice(plan, o, "")).toBe(oldPrice(plan, o, "USD"));
      }
      expect(quoteCurrency(o, "JP")).toBe("USD");
    });
  }

  it("the whole Eurozone, and Ireland, are quoted in euros", () => {
    for (const c of ["DE", "FR", "IE", "ES", "IT", "NL", "BG"]) expect(quoteCurrency(NONE, c), c).toBe("EUR");
  });

  it("a country is found by code, by name, and UK means GB", () => {
    expect(regionFor(NONE, "United Kingdom").id).toBe("gb");
    expect(regionFor(NONE, "UK").id).toBe("gb");
    expect(regionFor(NONE, "gb").id).toBe("gb");
    expect(regionFor(NONE, "Atlantis").id).toBe(WORLD_REGION_ID);
  });

  it("a club with no country is quoted by its currency, as it was before", () => {
    expect(quoteCurrency(NONE, quoteCountryFor(NONE, { country: "", currency: "GBP" }))).toBe("GBP");
    expect(quoteCurrency(NONE, quoteCountryFor(NONE, { country: "", currency: "JPY" }))).toBe("USD");
    // CURRENT BEHAVIOUR (COUNTRY_BEATS_CURRENCY = true; the owner is deciding): a club that has said where it is is quoted by where it is, whatever its money. Flipping that one constant restores currency-first.
    expect(quoteCurrency(NONE, quoteCountryFor(NONE, { country: "GB", currency: "USD" }))).toBe("GBP");
  });
});

describe("a club's free-text country never moves its quote", () => {
  const CURRENCIES = [...PLAN_CURRENCIES, "JPY", "SEK", ""];
  /** Before regions: by currency alone. */
  const before = (cur: string) => (PLAN_CURRENCIES as readonly string[]).includes(cur.toUpperCase()) ? cur.toUpperCase() : "USD";
  const quoted = (country: string, currency: string) => quoteCurrency(NONE, quoteCountryFor(NONE, { country, currency }));

  it("a name that maps to no region falls to the currency rule, exactly as before", () => {
    for (const country of ["Deutschland", "Narnia", "", "  ", "Unknown", "Japan", "Sweden"]) {
      for (const cur of CURRENCIES) expect(quoted(country, cur), `${country || "(blank)"} x ${cur || "(none)"}`).toBe(before(cur));
    }
  });

  it("a name whose country trades in the club's currency is the same quote either way", () => {
    const pairs: [string, string][] = [["Germany", "EUR"], ["germany", "EUR"], ["Ireland", "EUR"], ["Spain", "EUR"], ["England", "GBP"], ["Scotland", "GBP"], ["United Kingdom", "GBP"], ["Canada", "CAD"], ["Australia", "AUD"], ["New Zealand", "NZD"], ["South Africa", "ZAR"], ["United States", "USD"], ["USA", "USD"]];
    for (const [country, cur] of pairs) {
      expect(quoted(country, cur), `${country} x ${cur}`).toBe(cur);
      expect(effectivePrice(PLANS.club, NONE, quoteCountryFor(NONE, { country, currency: cur }))).toBe(oldPrice(PLANS.club, NONE, cur));
    }
  });

  it("a known country that is in no region does not drop a club's euros to dollars", () => {
    expect(quoted("SE", "EUR")).toBe("EUR");
  });

  it("CONTROL: a mapped country in a region that differs from the currency is quoted by its country (the rule)", () => {
    expect(quoted("Germany", "GBP")).toBe("EUR");
  });
});

describe("the owner's regions", () => {
  const india = { name: "India", currency: "INR", countries: ["IN"], monthly: { society: 2999, club: 9999 }, annualMonths: null };

  it("a region the owner adds quotes its own currency and prices", () => {
    const made = cleanRegionInputs([india]);
    expect(Array.isArray(made)).toBe(true);
    const o = parsePricingOverrides(JSON.stringify({ plans: {}, regions: made }));
    expect(quoteCurrency(o, "IN")).toBe("INR");
    expect(effectivePrice(PLANS.club, o, "IN")).toBe(9999);
    expect(effectiveAnnualPrice(PLANS.club, o, "IN")).toBe(99990);
    // CONTROL: a country in no region is still Rest of world, in dollars.
    expect(quoteCurrency(o, "BR")).toBe("USD");
    expect(effectivePrice(PLANS.club, o, "BR")).toBe(175);
    // The defaults stay when the owner adds one beside them? No: the list is the owner's, and Rest of world is always there.
    expect(effectiveRegions(o).some((r) => r.id === WORLD_REGION_ID)).toBe(true);
  });

  it("a currency with no default price needs every paid tier priced, or it is refused", () => {
    expect(cleanRegionInputs([{ ...india, monthly: { society: 2999, club: null } }])).toMatch(/India: INR has no default price/);
  });

  it("a country is in at most one region, and the refusal says where it already is", () => {
    const refused = cleanRegionInputs([
      { name: "Scotland", currency: "GBP", countries: ["GB"], monthly: {}, annualMonths: null },
      { name: "Also Britain", currency: "GBP", countries: ["GB"], monthly: {}, annualMonths: null },
    ]);
    expect(refused).toBe("United Kingdom is already in Scotland.");
  });

  it("refuses the junk a public endpoint can be handed", () => {
    const base = { name: "X", currency: "GBP", countries: ["GB"], monthly: {}, annualMonths: null };
    expect(cleanRegionInputs("nope")).toMatch(/list/);
    expect(cleanRegionInputs([{ ...base, name: " " }])).toMatch(/needs a name/);
    expect(cleanRegionInputs([{ ...base, currency: "pounds" }])).toMatch(/not a currency code/);
    expect(cleanRegionInputs([{ ...base, countries: ["Narnia"] }])).toMatch(/not a country code/);
    expect(cleanRegionInputs([{ ...base, countries: [] }])).toMatch(/at least one country/);
    expect(cleanRegionInputs([{ ...base, monthly: { club: -1 } }])).toMatch(/a price is a number, zero or more/);
    expect(cleanRegionInputs([{ ...base, annualMonths: 13 }])).toMatch(/1 to 12/);
    expect(cleanRegionInputs([base, { ...base, countries: ["IE"] }])).toMatch(/share a name/);
    expect(cleanRegionInputs([{ ...base, name: "Rest of world" }])).toMatch(/share a name/);
  });

  it("a price that is the default is stored as no override, so a later change of the default still reaches it", () => {
    const made = cleanRegionInputs([{ name: "Britain", currency: "GBP", countries: ["GB"], monthly: { club: PLANS.club.localMonthly.GBP, society: 41 }, annualMonths: null }]);
    expect(made).toEqual([expect.objectContaining({ monthly: { society: 41 } })]);
  });

  it("Rest of world cannot be given countries or another currency, even by a hand-edited row", () => {
    const o = parsePricingOverrides(JSON.stringify({ plans: {}, regions: [{ id: "world", name: "Rest of world", countries: ["FR"], currency: "EUR", monthly: {} }] }));
    const world = effectiveRegions(o).find((r) => r.id === WORLD_REGION_ID)!;
    expect(world.countries).toEqual([]);
    expect(world.currency).toBe("USD");
  });

  it("a hand-edited row cannot put one country in two regions", () => {
    const o = parsePricingOverrides(
      JSON.stringify({ plans: {}, regions: [
        { id: "a", name: "A", countries: ["GB"], currency: "GBP", monthly: {} },
        { id: "b", name: "B", countries: ["GB", "IE"], currency: "EUR", monthly: {} },
      ] }),
    );
    expect(regionFor(o, "GB").id).toBe("a");
    expect(regionFor(o, "IE").id).toBe("b");
  });

  it("Free stays free and Let's talk stays unpriced, whatever a row holds", () => {
    // Every way a row could carry a price for the two tiers that have none: the old shape, a region, Rest of world.
    const o = parsePricingOverrides(
      JSON.stringify({
        plans: { free: { monthly: 9, byCurrency: { GBP: 9 } }, enterprise: { monthly: 999 } },
        regions: [
          { id: "gb", name: "UK", countries: ["GB"], currency: "GBP", monthly: { free: 9, enterprise: 999 } },
          { id: "in", name: "India", countries: ["IN"], currency: "INR", monthly: { society: 2999, club: 9999, free: 500 } },
          { id: "world", name: "Rest of world", countries: [], currency: "USD", monthly: { free: 9, enterprise: 999 } },
        ],
      }),
    );
    for (const country of ["US", "GB", "IN", "JP", ""]) {
      expect(effectivePrice(PLANS.free, o, country), `Par in ${country || "no country"}`).toBe(0);
      expect(effectiveAnnualPrice(PLANS.free, o, country), `Par yearly in ${country || "no country"}`).toBe(0);
      expect(effectivePrice(PLANS.enterprise, o, country), `Albatross in ${country || "no country"}`).toBe(0);
    }
    // CONTROL: the same row's paid prices are read, so the zeros above are the rule and not a row nobody read.
    expect(effectivePrice(PLANS.club, o, "IN")).toBe(9999);
  });

  it("once regions are saved they are the truth: an older row's byCurrency no longer applies", () => {
    const o = parsePricingOverrides(JSON.stringify({ plans: { club: { byCurrency: { GBP: 1 } } }, regions: [{ id: "gb", name: "UK", countries: ["GB"], currency: "GBP", monthly: {} }] }));
    expect(effectivePrice(PLANS.club, o, "GB")).toBe(PLANS.club.localMonthly.GBP);
  });
});

describe("months billed for a year", () => {
  it("the all-regions figure moves every yearly price and the words", () => {
    const o = parsePricingOverrides('{"plans":{},"annualMonths":9}');
    expect(annualMonthsCharged(o)).toBe(9);
    expect(effectiveAnnualPrice(PLANS.club, o, "US")).toBe(175 * 9);
    expect(effectiveAnnualPrice(PLANS.club, o, "GB")).toBe(PLANS.club.localMonthly.GBP * 9);
    expect(yearlyFreeWords(o, "US")).toBe("three months are free");
  });

  it("a region's own figure beats the all-regions one, and only in that region", () => {
    const made = cleanRegionInputs([{ name: "Britain", currency: "GBP", countries: ["GB"], monthly: {}, annualMonths: 11 }]) as never;
    const o = parsePricingOverrides(JSON.stringify({ plans: {}, annualMonths: 9, regions: made }));
    expect(planQuote(PLANS.club, o, "GB").months).toBe(11);
    expect(planQuote(PLANS.club, o, "US").months).toBe(9);
    expect(yearlyFreeWords(o, "GB")).toBe("one month is free");
  });

  it("twelve months saves nothing and the words go", () => {
    expect(yearlyFreeWords(parsePricingOverrides('{"plans":{},"annualMonths":12}'), "US")).toBeNull();
    expect(yearlyFreeWords(NONE, "US")).toBe("two months are free");
  });

  it("is a whole number from 1 to 12 or it is ignored / refused", () => {
    for (const bad of [0, 13, 9.5, "9", -1, null]) expect(parsePricingOverrides(JSON.stringify({ plans: {}, annualMonths: bad })).annualMonths, String(bad)).toBeUndefined();
    expect(cleanAnnualMonths(0)).toMatch(/1 to 12/);
    expect(cleanAnnualMonths(null)).toBeNull();
    expect(cleanAnnualMonths(10)).toBe(10);
  });
});
