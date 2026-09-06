import { PLANS } from "@/lib/plans";

/**
 * What the site tells a search engine about itself, in schema.org terms.
 *
 * There was none. The page carried a good title, a description and Open Graph
 * tags, and nothing that said WHAT KIND OF THING this is — so a crawler had to
 * infer "software with a free tier and a paid one" from prose, which is exactly
 * the inference structured data exists to remove.
 *
 * WHAT IS DELIBERATELY ABSENT is as much the point as what is here. No
 * `aggregateRating`, no `review`, no `ratingValue`: this product has no reviews,
 * and inventing them is both a lie and, since 2023, a manual action from Google
 * for exactly this markup. A rich result won on fabricated data is a rich result
 * that disappears with the domain's standing attached to it.
 *
 * The prices come from `PLANS`, not from a literal here. The pricing page reads
 * the same constant, so the two cannot disagree — which matters more than usual
 * for this file, because a stale price in structured data is the number Google
 * shows next to the product while the site itself shows another.
 */

/** ISO 4217. The page formats with a `$`, so the offers must say USD. */
const CURRENCY = "USD";

export interface StructuredDataOptions {
  /** Absolute site origin, e.g. https://tourneyhq.club — no trailing slash. */
  origin: string;
}

export function siteStructuredData({ origin }: StructuredDataOptions): Record<string, unknown> {
  const org = `${origin}/#organization`;

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": org,
        name: "TourneyHQ",
        url: origin,
        logo: `${origin}/icon-512.png`,
      },
      {
        "@type": "WebSite",
        "@id": `${origin}/#website`,
        url: origin,
        name: "TourneyHQ",
        publisher: { "@id": org },
        inLanguage: "en",
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${origin}/#app`,
        name: "TourneyHQ",
        url: origin,
        applicationCategory: "SportsApplication",
        /**
         * Named rather than "Any": the app ships on the web and is packaged for
         * iOS and Android, and a crawler that believes it is web-only will not
         * surface it where somebody is looking for an app to run a competition
         * on a phone at the course.
         */
        operatingSystem: "Web, iOS, Android",
        publisher: { "@id": org },
        description:
          "Run a golf club's whole competition: flights, handicaps, brackets, live standings, " +
          "season tables and the settle-up at the end.",
        offers: Object.values(PLANS).map((plan) => ({
          "@type": "Offer",
          name: plan.name,
          price: String(plan.priceMonthly),
          priceCurrency: CURRENCY,
          /** Per month, which the price on the page also means. */
          ...(plan.priceMonthly > 0
            ? {
                priceSpecification: {
                  "@type": "UnitPriceSpecification",
                  price: String(plan.priceMonthly),
                  priceCurrency: CURRENCY,
                  unitCode: "MON",
                },
              }
            : {}),
        })),
      },
    ],
  };
}
