import { describe, it, expect } from "vitest";
import { siteStructuredData } from "@/lib/domain/structured-data";
import { PLANS } from "@/lib/plans";
import { readSource } from "./source";

const DATA = siteStructuredData({ origin: "https://tourneyhq.club" });
const graph = DATA["@graph"] as Array<Record<string, unknown>>;
const node = (t: string) => graph.find((g) => g["@type"] === t)!;

/**
 * What the site tells a crawler about itself.
 *
 * The page had a title, a description and Open Graph tags, and nothing that
 * said what KIND of thing it is — so "software with a free tier and a paid one"
 * had to be inferred from prose, which is what structured data exists to stop.
 */
describe("the site describes itself to a crawler", () => {
  it("declares the three things a product page should", () => {
    expect(graph.map((g) => g["@type"]).sort()).toEqual([
      "Organization",
      "SoftwareApplication",
      "WebSite",
    ]);
  });

  it("uses absolute URLs, which is the only kind a crawler can follow", () => {
    // A relative URL here is the same fault `metadataBase` exists to prevent
    // for Open Graph: silently emitted, silently useless.
    for (const g of graph) {
      for (const [k, v] of Object.entries(g)) {
        if (typeof v === "string" && (k === "url" || k === "logo" || k === "@id")) {
          expect(v, `${g["@type"]}.${k}`).toMatch(/^https:\/\//);
        }
      }
    }
  });
});

describe("the prices come from the plans, not from a second copy", () => {
  it("offers exactly the plans that exist, at the plans' prices", () => {
    /**
     * A stale price in structured data is the number Google shows beside the
     * product while the site shows another — worse than no markup, because a
     * club arrives expecting the old one.
     */
    const offers = node("SoftwareApplication").offers as Array<Record<string, unknown>>;
    expect(offers).toHaveLength(Object.keys(PLANS).length);

    for (const plan of Object.values(PLANS)) {
      const offer = offers.find((o) => o.name === plan.name);
      expect(offer, `no offer for the ${plan.name} plan`).toBeTruthy();
      expect(offer!.price).toBe(String(plan.priceMonthly));
      expect(offer!.priceCurrency).toBe("USD");
    }
  });

  it("moves when a plan's price moves", () => {
    // The discriminating check: reading the constant rather than repeating it
    // is only demonstrated if the assertion is derived from the constant too.
    const paid = Object.values(PLANS).find((p) => p.priceMonthly > 0)!;
    const offers = node("SoftwareApplication").offers as Array<Record<string, unknown>>;
    const offer = offers.find((o) => o.name === paid.name)!;
    expect(offer.price).toBe(String(paid.priceMonthly));
    expect(offer.price).not.toBe("0");
  });
});

describe("nothing here is invented", () => {
  it("claims no rating and no reviews", () => {
    /**
     * This product has no reviews. Marking up an `aggregateRating` for one that
     * does not exist has been a manual action from Google since 2023 — a rich
     * result won on fabricated data is one that vanishes taking the domain's
     * standing with it. Asserted rather than trusted, because it is precisely
     * the field somebody adds later to win a star in the results.
     */
    const json = JSON.stringify(DATA);
    expect(json).not.toMatch(/aggregateRating|ratingValue|reviewCount|"review"/i);
  });

  it("is emitted by the page, not merely written here", () => {
    // A module nobody renders is the fault this codebase keeps finding. The
    // landing page must actually put it in the document.
    const page = readSource("src/app/page.tsx");
    expect(page).toMatch(/application\/ld\+json/);
    expect(page).toMatch(/siteStructuredData\(/);
  });
});
