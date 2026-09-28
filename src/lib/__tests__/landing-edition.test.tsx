import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { applySwaps, editionFor, editionSwaps, landingEdition } from "@/lib/landing/edition";
import { inDialect } from "@/lib/landing/dialect";
import { landingPrices } from "@/lib/landing/pricing";
import { FAQ, FAQ_COUNT, LANDING_FAQ_IDS, faqItem } from "@/lib/landing/faq";
import { parsePricingOverrides } from "@/lib/plans";

/**
 * The front door's country editions (Ajay, 2026-09-27: "local by default and
 * overridden option for USD and US terminologies … including currency and golf
 * terminologies", US the default).
 */
describe("which edition a visitor gets", () => {
  it("is US for the US, for anywhere unlisted, and when the country is unknown", () => {
    for (const c of ["US", "", null, undefined, "JP", "BR"]) {
      const e = editionFor(c);
      expect(e.key, String(c)).toBe("US");
      expect(e.currency).toBe("USD");
      expect(e.register).toBe("us");
    }
  });

  it("is local for the countries with a set price", () => {
    expect(editionFor("GB")).toMatchObject({ key: "GB", currency: "GBP", register: "uk", shots: "uk" });
    expect(editionFor("UK")).toMatchObject({ key: "GB", currency: "GBP" });
    expect(editionFor("IE")).toMatchObject({ key: "IE", currency: "EUR", register: "uk" });
    expect(editionFor("AU")).toMatchObject({ key: "AU", currency: "AUD" });
    expect(editionFor("NZ")).toMatchObject({ key: "NZ", currency: "NZD" });
    expect(editionFor("ZA")).toMatchObject({ key: "ZA", currency: "ZAR" });
  });

  it("puts the eurozone on euros and UK golf, from golf-terms' own list", () => {
    for (const c of ["DE", "FR", "ES", "NL", "IT"]) {
      expect(editionFor(c)).toMatchObject({ key: "EU", currency: "EUR", register: "uk" });
    }
  });

  it("gives Canada dollars of its own, US golf words and Canadian spelling", () => {
    expect(editionFor("CA")).toMatchObject({ key: "CA", currency: "CAD", register: "us", spelling: "ca", shots: "us" });
  });

  it("switches to US $ and US terms on request, and remembers the way back", () => {
    const r = landingEdition("GB", true);
    expect(r.shown.key).toBe("US");
    expect(r.local.key).toBe("GB");
    expect(r.overridden).toBe(true);
    // A US visitor has nothing to switch to.
    expect(landingEdition("US", true).overridden).toBe(false);
  });
});

describe("the words, per edition", () => {
  const say = (country: string, text: string) => applySwaps(text, editionSwaps(editionFor(country)));

  it("changes nothing for the US — the page is written in US English", () => {
    expect(editionSwaps(editionFor("US"))).toEqual([]);
  });

  it("speaks UK golf from golf-terms.ts", () => {
    expect(say("GB", "carts and a cart for the foursome")).toBe("buggies and a buggy for the fourball");
    expect(say("GB", "Invite organizers")).toBe("Invite organisers");
    expect(say("GB", "the organizer's ledger")).toBe("the organiser's ledger");
    expect(say("GB", "Leagues & golf groups")).toBe("Leagues & societies");
  });

  it("never touches a FORMAT name — UK foursomes is alternate shot", () => {
    expect(say("GB", "Foursomes")).toBe("Foursomes");
    expect(say("GB", "Stroke Play")).toBe("Stroke Play");
  });

  it("spells colour in Canada without changing its golf", () => {
    expect(say("CA", "your colors, the cart")).toBe("your colours, the cart");
  });

  it("reaches alt text and skips anything marked data-no-dialect", () => {
    const tree = (
      <div>
        <p>The Saturday foursome</p>
        {/* eslint-disable-next-line @next/next/no-img-element -- a bare img, to prove the alt swap on the plainest element */}
        <img alt="A cart path" src="/x.webp" />
        <span data-no-dialect="">foursomes and greensomes</span>
      </div>
    );
    const html = renderToStaticMarkup(<>{inDialect(tree, editionSwaps(editionFor("GB")))}</>);
    expect(html).toContain("The Saturday fourball");
    expect(html).toContain('alt="A buggy path"');
    expect(html).toContain("foursomes and greensomes");
  });
});

describe("the prices, per edition", () => {
  const none = parsePricingOverrides(undefined);

  it("quotes the set local price in the local currency, whole", () => {
    const gb = landingPrices(editionFor("GB"), none);
    expect(gb.society.monthly).toBe("£39");
    expect(gb.club.yearly).toBe("£1,390");
    expect(gb.zero).toBe("£0");
    expect(landingPrices(editionFor("US"), none).society.monthly).toBe("$49");
  });

  it("keeps a competitor's US-dollar figure in US dollars, and says so outside the US", () => {
    expect(landingPrices(editionFor("US"), none).usd(1425)).toBe("$1,425");
    expect(landingPrices(editionFor("GB"), none).usd(1425)).toBe("US$1,425");
    expect(landingPrices(editionFor("CA"), none).usd(500)).toBe("US$500");
  });
});

describe("the questions", () => {
  it("has every question once, and the landing's eight among them", () => {
    const ids = FAQ.flatMap((g) => g.items.map((i) => i.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(FAQ_COUNT).toBe(ids.length);
    expect(LANDING_FAQ_IDS).toHaveLength(8);
    for (const id of LANDING_FAQ_IDS) expect(ids).toContain(id);
  });

  it("answers the price question in the visitor's currency", () => {
    const prices = landingPrices(editionFor("GB"), parsePricingOverrides(undefined));
    const html = renderToStaticMarkup(<>{faqItem("cost").a({ prices, email: "x@example.invalid" })}</>);
    expect(html).toContain("£39/mo");
    expect(html).toContain("£1,390 a year");
    expect(html).not.toContain("$");
  });
});

describe("the contact address", () => {
  it("is not published while its domain cannot receive mail", async () => {
    const { CONTACT_EMAIL_LIVE, contactEmail } = await import("@/components/landing/chrome");
    // tourneyhq.club has no MX yet (2026-09-27): a dead address is worse than none.
    expect(CONTACT_EMAIL_LIVE ? contactEmail : null).toBe(contactEmail);
    if (!CONTACT_EMAIL_LIVE) expect(contactEmail).toBeNull();
    const prices = landingPrices(editionFor("US"), parsePricingOverrides(undefined));
    const html = renderToStaticMarkup(<>{faqItem("several-clubs").a({ prices, email: contactEmail })}</>);
    if (!CONTACT_EMAIL_LIVE) expect(html).not.toContain("mailto:");
  });
});
