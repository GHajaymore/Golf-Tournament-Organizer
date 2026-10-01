import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { applySwaps, editionFor, editionSwaps } from "@/lib/landing/edition";
import { inDialect } from "@/lib/landing/dialect";
import { landingPrices } from "@/lib/landing/pricing";
import { FAQ, FAQ_COUNT } from "@/lib/landing/faq";
import { faqStructuredData, nodeText, scriptJson } from "@/lib/landing/faq-structured-data";
import { pageShareMeta } from "@/lib/landing/share-meta";
import { parsePricingOverrides } from "@/lib/plans";

/**
 * /faq's FAQPage structured data says exactly what the page says (Ajay,
 * 2026-09-30: "fix it"). A search result quoting an answer the page does not
 * give — a different price, "organizers" to a British visitor — is worse than
 * no rich result at all.
 */

const none = parsePricingOverrides(undefined);
const ctxFor = (country: string) => ({ prices: landingPrices(editionFor(country), none), email: "zz@example.invalid" });

/** What a visitor reads in the rendered answer: tags out, entities decoded, spaces tidied. */
function shown(html: string): string {
  return html
    // Two tags touching are two elements (chips, paragraphs): a gap. Any
    // other tag sits inside a sentence ("the home page</a>:") and joins.
    .replace(/>(\s*)</g, "> <")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

describe("FAQPage structured data", () => {
  for (const country of ["US", "GB"]) {
    const edition = editionFor(country);
    const swaps = editionSwaps(edition);
    const ctx = ctxFor(country);
    const data = faqStructuredData(FAQ, ctx, swaps);
    const items = FAQ.flatMap((g) => g.items);

    it(`${country}: carries every question once, in the page's order`, () => {
      expect(data["@type"]).toBe("FAQPage");
      expect(data.mainEntity).toHaveLength(FAQ_COUNT);
      expect(data.mainEntity.map((q) => q.name)).toEqual(items.map((i) => applySwaps(i.q.replace(/\s+/g, " ").trim(), swaps)));
    });

    it(`${country}: each answer is the text the page renders, prices and words included`, () => {
      items.forEach((item, i) => {
        const page = shown(renderToStaticMarkup(<>{inDialect(item.a(ctx), swaps)}</>));
        expect(page.length, `${item.id} rendered empty`).toBeGreaterThan(10);
        expect(data.mainEntity[i].acceptedAnswer.text, item.id).toBe(page);
      });
    });
  }

  it("CONTROL: the editions really differ, so the comparison above can fail", () => {
    const us = JSON.stringify(faqStructuredData(FAQ, ctxFor("US"), editionSwaps(editionFor("US"))));
    const gb = JSON.stringify(faqStructuredData(FAQ, ctxFor("GB"), editionSwaps(editionFor("GB"))));
    expect(gb).not.toBe(us);
  });

  it("reads nested text and separates blocks", () => {
    expect(nodeText(<div><p>One <b>two</b></p><p>three</p></div>).replace(/\s+/g, " ").trim()).toBe("One two three");
  });

  it("can never close its own <script> tag", () => {
    expect(scriptJson({ a: "</script><b>" })).not.toContain("<");
  });
});

describe("a public page's link preview is its own", () => {
  it("names the page and points at it, not at the landing", () => {
    const m = pageShareMeta({ path: "/privacy", title: "Privacy", description: "zz" });
    expect(m.openGraph).toMatchObject({ url: "/privacy", title: "Privacy · TourneyHQ", siteName: "TourneyHQ", type: "website" });
    expect(m.twitter).toMatchObject({ card: "summary_large_image", title: "Privacy · TourneyHQ" });
  });

  it("keeps the picture — overriding openGraph drops the file-based image otherwise", () => {
    const m = pageShareMeta({ path: "/faq", title: "Questions", description: "zz" });
    expect(m.openGraph?.images).toEqual([expect.objectContaining({ url: "/opengraph-image", width: 1200, height: 630 })]);
    expect(m.twitter?.images).toEqual(["/opengraph-image"]);
  });
});
