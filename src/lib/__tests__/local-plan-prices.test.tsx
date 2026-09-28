import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PLANS,
  PLAN_CURRENCIES,
  ANNUAL_MONTHS_CHARGED,
  planCurrency,
  effectivePrice,
  effectiveAnnualPrice,
  parsePricingOverrides,
  type PlanCurrency,
  type PricingOverrides,
} from "@/lib/plans";
import { siteStructuredData } from "@/lib/domain/structured-data";
import { wholeMoney } from "@/lib/domain/money-format";
import { PlanPanel } from "@/components/PlanPanel";

/**
 * LOCAL PLAN PRICES ARE SET, NOT CONVERTED — Ajay, 2026-09-27.
 *
 * A club in Britain is quoted £39, a price somebody chose. It is never $49
 * run through this week's exchange rate. These pin the approved numbers, the
 * fallback for a currency with no price, and every surface that quotes them.
 */

const NONE: PricingOverrides = { plans: {} };

/** The approved monthly prices, Season / Club. Free is 0 everywhere. */
const APPROVED: Record<PlanCurrency, { society: number; club: number }> = {
  USD: { society: 49, club: 175 },
  GBP: { society: 39, club: 139 },
  EUR: { society: 45, club: 159 },
  CAD: { society: 65, club: 239 },
  AUD: { society: 75, club: 269 },
  NZD: { society: 79, club: 289 },
  ZAR: { society: 899, club: 3199 },
};

describe("every plan has a set price in every plan currency", () => {
  it("covers exactly the approved currencies", () => {
    expect([...PLAN_CURRENCIES].sort()).toEqual(Object.keys(APPROVED).sort());
  });

  for (const c of PLAN_CURRENCIES) {
    it(`${c}: the approved prices, and Free is free`, () => {
      expect(effectivePrice(PLANS.free, NONE, c)).toBe(0);
      expect(effectivePrice(PLANS.society, NONE, c)).toBe(APPROVED[c].society);
      expect(effectivePrice(PLANS.club, NONE, c)).toBe(APPROVED[c].club);
    });

    it(`${c}: a year is ${ANNUAL_MONTHS_CHARGED} months`, () => {
      for (const plan of Object.values(PLANS)) {
        expect(effectiveAnnualPrice(plan, NONE, c)).toBe(effectivePrice(plan, NONE, c) * 10);
      }
    });
  }

  it("leaves every existing caller on USD", () => {
    // The landing page calls these with no currency at all.
    expect(effectivePrice(PLANS.club, NONE)).toBe(175);
    expect(effectiveAnnualPrice(PLANS.society, NONE)).toBe(490);
  });
});

describe("a currency with no price point is quoted in dollars", () => {
  it("normalises what a club row might hold", () => {
    expect(planCurrency("gbp")).toBe("GBP");
    expect(planCurrency(" GBP ")).toBe("GBP");
    expect(planCurrency("ZAR")).toBe("ZAR");
  });

  it("sends anything unsupported to USD, never to a converted figure", () => {
    for (const raw of ["JPY", "CHF", "", "  ", "pounds", "GB", null, undefined]) {
      expect(planCurrency(raw), String(raw)).toBe("USD");
    }
    expect(effectivePrice(PLANS.club, NONE, "JPY")).toBe(175);
  });
});

describe("the owner can override a local price", () => {
  it("a byCurrency override wins in its own currency", () => {
    const o = parsePricingOverrides('{"plans":{"club":{"byCurrency":{"GBP":129}}}}');
    expect(effectivePrice(PLANS.club, o, "GBP")).toBe(129);
    expect(effectiveAnnualPrice(PLANS.club, o, "GBP")).toBe(1290);
    // CONTROL: the other currencies and the USD price are untouched.
    expect(effectivePrice(PLANS.club, o, "EUR")).toBe(159);
    expect(effectivePrice(PLANS.club, o)).toBe(175);
  });

  it("the USD override still works, and does not move a local price", () => {
    const o = parsePricingOverrides('{"plans":{"club":{"monthly":150,"byCurrency":{"GBP":129}}}}');
    expect(effectivePrice(PLANS.club, o)).toBe(150);
    expect(effectivePrice(PLANS.club, o, "GBP")).toBe(129);
    // Set, not converted: there is no rate for a dollar change to travel by.
    const usdOnly = parsePricingOverrides('{"plans":{"club":{"monthly":150}}}');
    expect(effectivePrice(PLANS.club, usdOnly, "GBP")).toBe(139);
  });

  it("ignores junk rather than throwing or quoting it", () => {
    const junk = parsePricingOverrides(
      JSON.stringify({
        plans: {
          club: {
            byCurrency: { gbp: 1, USD: 2, JPY: 3, EUR: -5, CAD: "99", AUD: null, NZD: Number.NaN, ZAR: 999 },
          },
          society: { byCurrency: [1, 2] },
          gold: { byCurrency: { GBP: 10 } },
        },
      }),
    );
    // Only the one well-formed entry survives.
    expect(junk).toEqual({ plans: { club: { byCurrency: { ZAR: 999 } } } });
    expect(effectivePrice(PLANS.club, junk, "GBP")).toBe(139);
    expect(effectivePrice(PLANS.club, junk, "EUR")).toBe(159);
    expect(effectivePrice(PLANS.club, junk, "ZAR")).toBe(999);
  });

  it("validates at the sink too, for a caller that skipped the parser", () => {
    const handBuilt = {
      plans: { club: { byCurrency: { GBP: Number.NaN, EUR: -1, CAD: Infinity } } },
    } as unknown as PricingOverrides;
    expect(effectivePrice(PLANS.club, handBuilt, "GBP")).toBe(139);
    expect(effectivePrice(PLANS.club, handBuilt, "EUR")).toBe(159);
    expect(effectivePrice(PLANS.club, handBuilt, "CAD")).toBe(239);
  });
});

describe("a crawler reads the price the page shows", () => {
  const offers = (currency?: string) => {
    const graph = siteStructuredData({ origin: "https://example.invalid", overrides: NONE, currency })[
      "@graph"
    ] as Array<Record<string, unknown>>;
    return graph.find((n) => n["@type"] === "SoftwareApplication")!.offers as Array<Record<string, unknown>>;
  };

  it("carries the currency and the price set in it", () => {
    const club = offers("GBP").find((o) => o.name === PLANS.club.name)!;
    expect(club.priceCurrency).toBe("GBP");
    expect(club.price).toBe("139");
    expect((club.priceSpecification as Record<string, unknown>).priceCurrency).toBe("GBP");
  });

  it("stays USD with no currency, and for one without a price", () => {
    for (const c of [undefined, "JPY"]) {
      const club = offers(c).find((o) => o.name === PLANS.club.name)!;
      expect(club.priceCurrency).toBe("USD");
      expect(club.price).toBe("175");
    }
  });
});

describe("a price is written in whole units", () => {
  it("never shows minor units for a price somebody set", () => {
    expect(wholeMoney(39, "GBP", "en-GB")).toBe("£39");
    expect(wholeMoney(1750, "USD")).toBe("$1,750");
    expect(wholeMoney(899, "ZAR", "en-ZA")).toMatch(/^R\s?899$/);
  });

  it("falls back to dollars on a code Intl refuses", () => {
    expect(wholeMoney(49, "NOT-A-CODE")).toBe("$49");
  });
});

describe("the club's plan panel quotes in the club's currency", () => {
  /** React's SSR separators sit between text nodes; strip them before matching. */
  const text = (html: string) => html.replace(/<!--[^>]*-->/g, "").replace(/<[^>]+>/g, " ");

  it("a GBP club reads pounds, at the set price", () => {
    const body = text(renderToStaticMarkup(<PlanPanel planKey="free" overrides={NONE} currency="GBP" locale="en-GB" />));
    expect(body).toContain("£139/mo · £1,390/yr");
    expect(body).toContain("£39/mo · £390/yr");
    expect(body, "a dollar price reached a sterling club").not.toContain("$");
  });

  it("a club in a currency with no price point reads dollars", () => {
    const body = text(renderToStaticMarkup(<PlanPanel planKey="free" overrides={NONE} currency="JPY" />));
    expect(body).toContain("$175/mo · $1,750/yr");
    expect(body).not.toContain("¥");
  });
});
