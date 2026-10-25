import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import { signInsHeld } from "@/lib/services/signins-switch";
import { editionSwaps, landingEdition, US_OVERRIDE_COOKIE } from "@/lib/landing/edition";
import { inDialect } from "@/lib/landing/dialect";
import { LANDING_CSS } from "@/lib/landing/styles";
import { LandingEffects } from "@/components/LandingEffects";
import { editionNote, iconSprite, landingFooter, landingNav } from "@/components/landing/chrome";
import { NOINDEX } from "@/lib/site";
import { DEMO_CLUB, DEMO_EVENTS, DEMO_LABEL, DEMO_LABEL_NOTE, DEMO_WATCH_LINE } from "@/lib/domain/demo-club";
import { demoMark, demoStatus } from "@/lib/services/demo-club";

export const metadata: Metadata = { title: "A demo club's day", robots: NOINDEX };
export const dynamic = "force-dynamic";

/**
 * A DEMO CLUB'S DAY (2026-10-24; docs/claude/demo-club.md) — where the front
 * door's "See a demo club's day" lands: the invented club's two tournaments and
 * every page a club's members and visitors see of them. Each link is a
 * `/demo/<door>` address, so this page and the landing name the same places.
 *
 * Drawn in the front door's chrome, with its edition's words, and never
 * indexed — it is a demo, not a page about TourneyHQ for a search engine.
 */
const CSS = `
.dm-grid { display: grid; gap: 18px; grid-template-columns: minmax(0, 1fr); }
@media (min-width: 900px) { .dm-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } }
.dm-card { display: grid; gap: 12px; align-content: start; padding: 22px; border-radius: var(--r, 16px); background: var(--card); border: 1px solid var(--line); color: var(--ink); min-width: 0; }
.dm-card h2 { margin: 0; font-size: 22px; line-height: 1.2; }
.dm-card p { margin: 0; line-height: 1.55; }
.dm-kick { font: 600 13px/1 var(--mono); letter-spacing: 0.12em; text-transform: uppercase; color: var(--brass-ui); }
.dm-links { display: flex; flex-wrap: wrap; gap: 10px; }
.dm-links a { display: inline-flex; align-items: center; min-height: 44px; padding: 0 16px; border-radius: 999px; border: 1.5px solid var(--ink); color: var(--ink); font-weight: 600; text-decoration: none; }
.dm-label { display: inline-flex; flex-wrap: wrap; gap: 6px 10px; align-items: baseline; padding: 10px 14px; border: 1px dashed var(--line); border-radius: 10px; margin: 0 0 18px; }
`;

export default async function DemoPage() {
  const [h, jar] = await Promise.all([headers(), cookies()]);
  const { local, shown, overridden } = landingEdition(h.get("x-vercel-ip-country"), jar.get(US_OVERRIDE_COOKIE)?.value === "1");
  const status = await demoStatus(demoMark()).catch(() => null);

  const page = (
    <div className="thq" lang={shown.locale}>
      <style dangerouslySetInnerHTML={{ __html: LANDING_CSS + CSS }} />
      <LandingEffects />
      {iconSprite()}
      {landingNav("demo", await signInsHeld())}

      <main className="legal">
        <section className="fq-hero">
          <div className="wrap">
            <span className="label">A demo club&rsquo;s day</span>
            <h1 className="h1">{DEMO_CLUB.name}, today.</h1>
            <p className="lead">{DEMO_WATCH_LINE}</p>
          </div>
        </section>
        <div className="wrap lg-body">
          <p className="dm-label" data-demo-club="">
            <strong>{DEMO_LABEL}</strong>
            <span>{DEMO_LABEL_NOTE}</span>
          </p>
          {status?.built ? (
            <div className="dm-grid">
              <section className="dm-card" aria-labelledby="dm-today">
                <span className="dm-kick">Playing now</span>
                <h2 id="dm-today">{DEMO_EVENTS.today}</h2>
                <p>
                  Groups go off from eight o&rsquo;clock at the club, and the board fills in hole by hole through the day
                  by the club&rsquo;s own clock. It starts again each morning.
                </p>
                <div className="dm-links">
                  <a href="/demo/board">The board</a>
                  <a href="/demo/event">The event page</a>
                  <a href="/demo/clubhouse">The clubhouse screen</a>
                  <a href="/demo/card">A player&rsquo;s card</a>
                </div>
              </section>
              <section className="dm-card" aria-labelledby="dm-finished">
                <span className="dm-kick">Finished</span>
                <h2 id="dm-finished">{DEMO_EVENTS.finished}</h2>
                <p>Two rounds, played earlier in the week. What the club sends round afterwards: the result first, then the whole report.</p>
                <div className="dm-links">
                  <a href="/demo/finished">The event page</a>
                  <a href="/demo/report">The final report</a>
                </div>
              </section>
            </div>
          ) : (
            <p className="lead">The demo club is being set up. Come back soon, or see a player&rsquo;s view with a round code at <Link href="/play">/play</Link>.</p>
          )}
          <p className="lg-back">
            <Link href="/">Back to TourneyHQ</Link>
          </p>
        </div>
      </main>

      {landingFooter("demo", editionNote(local, overridden))}
    </div>
  );

  return inDialect(page, editionSwaps(shown));
}
