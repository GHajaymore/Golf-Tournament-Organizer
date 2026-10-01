import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import { storedPricingOverrides } from "@/lib/services/platform-pricing";
import { editionSwaps, landingEdition, US_OVERRIDE_COOKIE } from "@/lib/landing/edition";
import { inDialect } from "@/lib/landing/dialect";
import { landingPrices } from "@/lib/landing/pricing";
import { FAQ, FAQ_COUNT } from "@/lib/landing/faq";
import { faqStructuredData, scriptJson } from "@/lib/landing/faq-structured-data";
import { pageShareMeta } from "@/lib/landing/share-meta";
import { LANDING_CSS } from "@/lib/landing/styles";
import { LandingEffects } from "@/components/LandingEffects";
import { FaqSearch } from "@/components/landing/FaqSearch";
import { contactEmail, editionNote, iconSprite, landingFooter, landingNav } from "@/components/landing/chrome";

const FAQ_DESCRIPTION =
  "How TourneyHQ scores every format, what players need, how the money is handled and what it costs — answered plainly.";

export const metadata: Metadata = {
  // The root layout appends the product name with its title template.
  title: "Questions",
  description: FAQ_DESCRIPTION,
  // Its own, so a crawler does not read this page as a duplicate of the landing page.
  alternates: { canonical: "/faq" },
  // And its own link preview, or it is shared as the landing page (share-meta.ts).
  ...pageShareMeta({ path: "/faq", title: "Questions", description: FAQ_DESCRIPTION }),
};

/**
 * Every question the front door answers, on a page of its own (Ajay,
 * 2026-09-27: "go with a separate page", "add more questions", "get these
 * collapsed").
 *
 * The answers come from `lib/landing/faq.tsx` — the same module the landing's
 * eight read — so the two pages cannot answer one question two ways. Prices
 * and words follow the visitor's edition exactly as `/` does. Topics are
 * collapsed <details>, so the page reads and opens without JavaScript; the
 * search is the one part that needs a script.
 *
 * Public and indexable: it describes the product and carries nobody's data.
 */
export default async function FaqPage() {
  const overrides = await storedPricingOverrides();
  const [h, jar] = await Promise.all([headers(), cookies()]);
  const { local, shown, overridden } = landingEdition(
    h.get("x-vercel-ip-country"),
    jar.get(US_OVERRIDE_COOKIE)?.value === "1",
  );
  const ctx = { prices: landingPrices(shown, overrides), email: contactEmail };
  const swaps = editionSwaps(shown);

  const page = (
    <div className="thq" lang={shown.locale}>
      <style dangerouslySetInnerHTML={{ __html: LANDING_CSS }} />
      {/* The questions and answers in schema.org terms, built from the same
          list, prices and edition words as the page, so search shows what a
          visitor opens. inDialect skips <script>, hence the swaps passed in. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: scriptJson(faqStructuredData(FAQ, ctx, swaps)) }}
      />
      <LandingEffects />
      {iconSprite()}
      {landingNav("faq")}

      <main>
        <section className="fq-hero">
          <div className="wrap">
            <span className="label">Questions</span>
            <h1 className="h1">
              Everything organizers <span className="o">ask us.</span>
            </h1>
            <p className="lead">
              How the scoring works, what players need, how the money is handled and what it costs — answered plainly.
            </p>
            <FaqSearch total={FAQ_COUNT} />
          </div>
        </section>

        <nav className="topics" aria-label="Topics">
          <div className="wrap">
            {FAQ.map((g) => (
              <a key={g.id} href={`#${g.id}`}>
                {g.title}
                <b>{g.items.length}</b>
              </a>
            ))}
          </div>
        </nav>

        <section className="fq-body">
          <div className="wrap">
            {FAQ.map((g) => (
              <details className="fq-group" id={g.id} key={g.id}>
                <summary className="fq-head">
                  <span className="fq-title">
                    <span className="fq-h2">{g.title}</span>
                    <span className="fq-desc">{g.desc}</span>
                  </span>
                  <span className="fq-n">{g.items.length === 1 ? "1 question" : `${g.items.length} questions`}</span>
                  <span className="fq-chev" aria-hidden="true" />
                </summary>
                <div className="faq">
                  {g.items.map((item) => (
                    <details className="q" key={item.id} id={`q-${item.id}`}>
                      <summary>{item.q}<span className="pm" aria-hidden="true">+</span></summary>
                      <div className="ans">{item.a(ctx)}</div>
                    </details>
                  ))}
                </div>
              </details>
            ))}

            {/* No address until the domain receives mail (CONTACT_EMAIL_LIVE). */}
            <div className="fq-cta">
              {contactEmail ? (
                <>
                  <div>
                    <h2>Still have a question?</h2>
                    <p>Send it to us and we&rsquo;ll answer it.</p>
                  </div>
                  <a className="btn" href={`mailto:${contactEmail}`}>Email TourneyHQ</a>
                </>
              ) : (
                <>
                  <div>
                    <h2>The quickest answer is to try it.</h2>
                    <p>Free for up to ten players, with no card and no setup fee.</p>
                  </div>
                  <Link className="btn" href="/#signup">Start free</Link>
                </>
              )}
            </div>
          </div>
        </section>
      </main>

      {landingFooter("faq", editionNote(local, overridden))}
    </div>
  );

  return inDialect(page, swaps);
}
