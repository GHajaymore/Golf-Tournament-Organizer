import { Fragment } from "react";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import { PLANS, effectiveAnnualPrice, onEveryPlan, planTagline, retentionNotice, retentionSummary } from "@/lib/plans";
import { DEMO_HUB, DEMO_LABEL, demoDoorHref } from "@/lib/domain/demo-club";
import { demoCardQr } from "@/lib/landing/demo-qr";
import { storedPricingOverrides } from "@/lib/services/platform-pricing";
import { siteStructuredData } from "@/lib/domain/structured-data";
import { NOINDEX, siteOrigin } from "@/lib/site";
import { editionSwaps, landingEdition, US_OVERRIDE_COOKIE } from "@/lib/landing/edition";
import { inDialect } from "@/lib/landing/dialect";
import { golfTermsFor } from "@/lib/domain/golf-terms";
import { landingPrices } from "@/lib/landing/pricing";
import { FAQ_COUNT, FORMAT_NAMES } from "@/lib/landing/faq";
import { LANDING_CSS } from "@/lib/landing/styles";
import { PRICES_READ_ON, TOP_PUBLISHED } from "@/lib/landing/compare";
import { SALES_EMAIL, SOCIAL_CHANNELS, socialChannels } from "@/lib/contact";
import { LandingAuth } from "@/components/LandingAuth";
import { launchState } from "@/lib/services/signins-switch";
import { frontDoorWords } from "@/lib/go-live";
import { contactEmail, editionNote, icon, iconSprite } from "@/components/landing/chrome";
import { plainShot } from "@/components/landing/shots";
import { Lockup } from "@/components/Lockup";
import { LOGO_SIZE } from "@/components/Logo";
import { landingScreen } from "@/lib/landing/screens";
import FACTS from "@/lib/landing/screen-facts.json";
import { NEW_CSS } from "./new-styles";
import { HeroMoment } from "./HeroMoment";
import { BoardTabs } from "./BoardTabs";
import { SocialIcon } from "./social-icons";

/**
 * THE SITE REHAUL — A PREVIEW (2026-11-01). Ajay: "I didn't like it. Show me the complete rehaul of
 * the site." Built beside today's front door so `/` is untouched: this page is never indexed and
 * nothing links to it. It says what `/` says — the same claims, the same prices read from PLANS, the
 * same held/live words from `go-live.ts` — in a new order, a new type and a new layout. The design
 * plan is in `TourneyHQ Documents\Landing concepts Nov 2026\Rehaul\Design plan.md`.
 *
 * Unlike `/`, a signed-in visitor is NOT sent on to the app: the owners judging the preview are
 * signed in.
 */
export const metadata: Metadata = {
  title: "TourneyHQ: golf tournament and league software (preview)",
  robots: NOINDEX,
  alternates: { canonical: "/" },
};

/** Draw a capture the manifest names (`src/lib/landing/screens.ts`) — and only one it names. */
function screen(id: string, alt: string, sizes: string, priority = false) {
  landingScreen(id);
  return plainShot({ name: id, alt, sizes, priority });
}

const SIZES = {
  heroDesk: "(max-width: 760px) 100vw, min(900px, 76vw)",
  heroPhone: "(max-width: 760px) min(64vw, 270px), min(270px, 22vw)",
  // The bento's windows show a laptop capture zoomed in (1.3 to 2.6 times the window), so the
  // picture is drawn wider than the tile that holds it.
  bentoXl: "(max-width: 680px) 200vw, (max-width: 1000px) 130vw, 860px",
  bentoWide: "(max-width: 680px) 230vw, (max-width: 1000px) 125vw, 860px",
  bentoPhone: "(max-width: 680px) 70vw, (max-width: 1000px) 40vw, 320px",
  day: "(max-width: 900px) min(70vw, 300px), 330px",
  watch: "(max-width: 600px) min(62vw, 250px), 300px",
  money: "(max-width: 900px) min(72vw, 310px), 310px",
  theme: "(max-width: 900px) min(56vw, 230px), 290px",
} as const;

/**
 * THE DAY, AS A HAND-HUNG BOARD: one competition at the demo club, in the order it happens. The
 * times are an example and are said to be (Ajay, 2026-10-11): a draw goes out days before the round.
 */
const DAY: Array<{ day: string; when: string; what: string; who: string; h: string; p: string; shot: string; alt: string }> = [
  { day: "Monday", when: "09:00", what: "Entries open", who: "Players", h: "Entries open.",
    p: "Players put their name down from their own phone. You see who is in, who is out and who is waiting.",
    shot: "club-enter", alt: "A player's Events screen: a tournament open for entries, 22 of 40 places left, and the button to enter." },
  { day: "Thursday", when: "18:00", what: "The draw", who: "The organizer", h: "You publish the draw.",
    p: "Drawn from who's in, then yours to adjust. Every player has their group and tee time on their phone.",
    shot: "org-teesheet", alt: "The organizer's tee sheet: two pairing requests above the published draw." },
  { day: "Saturday", when: "08:05", what: "The code", who: "Players", h: "They scan the sign.",
    p: "Each round's printed sign carries a QR code and its eight-character code. Scan or type it, tap your name, and you're on your round. No account and no password.",
    shot: "club-today", alt: "A player's Today screen: the round, a pinned notice, their card so far and their position." },
  { day: "Saturday", when: "10:50", what: "The card", who: "Players", h: "They tap the score, or say it.",
    p: "The card saves as they go, and keeps saving when there is no signal. In a match the organizer chooses how it is kept: one tap for who won each hole, or stroke cards with gross and net.",
    shot: "club-card", alt: "My card, by hole: hole 10, par 4, score buttons and a microphone." },
  { day: "Saturday", when: "11:42", what: "The board", who: "Everyone", h: "The board moves.",
    p: "Their own line first, then the field, as every card comes in.",
    shot: "club-board", alt: "The player's Board: their own position first, then the field." },
  { day: "Saturday", when: "14:00", what: "The money", who: "Everyone", h: "Everyone knows who owes what.",
    p: "Skins, pots and shared costs in one settle-up. Worked out, never collected.",
    shot: "club-money", alt: "A player's Money screen: what they are owed, and who pays whom to settle it." },
  { day: "Saturday", when: "15:30", what: "Recognition", who: "The organizer", h: "The champion is on the board.",
    p: "The final board, the prizes and the honors board, done before the prize-giving starts.",
    shot: "club-final", alt: "A player's Board for the finished championship: the result of each round, then the final order." },
];

/** Five demo clubs, each in its own money, written the way that country writes it. */
const WORLD: Array<{ shot: string; symbol: string; place: string; money: string; alt: string }> = [
  { shot: "club-money", symbol: "$", place: "United States", money: "US dollars", alt: "A player's Money screen at a club in Indiana: what they are owed, in dollars." },
  { shot: "world-gbp-money", symbol: "£", place: "United Kingdom", money: "Pounds", alt: "The same screen at a club in Harrogate, in pounds." },
  { shot: "world-eur-money", symbol: "€", place: "Ireland", money: "Euros", alt: "The same screen at a club in Kilkenny, in euros." },
  { shot: "world-zar-money", symbol: "R", place: "South Africa", money: "Rand", alt: "The same screen at a club in Stellenbosch, in rand, written with a decimal comma." },
  { shot: "world-inr-money", symbol: "₹", place: "India", money: "Rupees", alt: "The same screen at a club in Pune, in rupees." },
];

const THEMES: Array<{ shot: string; name: string; swatch: string }> = [
  { shot: "look-tournament-light", name: "Tournament", swatch: "hsl(182 68% 36%)" },
  { shot: "look-championship-dark", name: "Championship, dark", swatch: "hsl(352 62% 42%)" },
  { shot: "look-coastal-light", name: "Coastal", swatch: "hsl(205 70% 46%)" },
  { shot: "look-midnight-dark", name: "Midnight, dark", swatch: "hsl(262 72% 60%)" },
];

const AUDIENCES: Array<{ who: string; h: string; p: string; href: string; go: string }> = [
  { who: "Leagues & golf groups", h: "A season, not just a day.",
    p: "Weekly leagues, golf groups and outings: every foursome's tee time on their phone, a table across the season, and who owes whom worked out.",
    href: "/faq#q-league", go: "How a league runs" },
  { who: "Golf pros", h: "Your event, from your phone.",
    p: "A clinic day, a member-guest or a corporate day, with the field scoring from a round code and no account to make.",
    href: DEMO_HUB, go: "See a day run" },
  { who: "Clubs", h: "Every competition, in your colors.",
    p: "The medal, the championship and the knockout, any size of field, with the board on the clubhouse TV and in every member's hand.",
    href: "#pricing", go: "See the club plans" },
];

const ANSWERS: Array<{ q: string; a: string; href: string }> = [
  { q: "Do players need an app?",
    a: "No. They scan the round's sign or open a link, tap their name, and score in the browser. It saves to the home screen if they want it there.",
    href: "/faq#q-app" },
  { q: "Does it take entry fees?",
    a: "No, and that is a choice. Your club takes its entry fees the way it does today, and TourneyHQ keeps the record: every amount worked out, nothing held or moved.",
    href: "/faq#q-entry-fees" },
  { q: "What does a player pay?",
    a: "Nothing. A plan is the organizer's. A player never pays to enter scores, follow the board or see what they are owed.",
    href: "/faq#q-cost" },
];

const STORE_LINKS = {
  ios: process.env.TOURNEYHQ_IOS_URL ?? "",
  android: process.env.TOURNEYHQ_ANDROID_URL ?? "",
};

export default async function NewSitePreview() {
  const overrides = await storedPricingOverrides();
  const launch = await launchState();
  const words = frontDoorWords(launch);
  const start = words.startHref("");
  const [h, jar] = await Promise.all([headers(), cookies()]);
  const { local, shown, overridden } = landingEdition(h.get("x-vercel-ip-country"), jar.get(US_OVERRIDE_COOKIE)?.value === "1");
  const prices = landingPrices(shown, overrides);
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const origin = host ? `${h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https")}://${host}` : siteOrigin();
  const qr = await demoCardQr(origin);
  const everyPlan = onEveryPlan();
  const note = editionNote(local, overridden);
  const golf = golfTermsFor(shown.register);
  const channels = socialChannels();

  const eagleYear = effectiveAnnualPrice(PLANS.club, overrides, "USD");
  const birdieYear = effectiveAnnualPrice(PLANS.society, overrides, "USD");
  const theirYear = (name: keyof typeof TOP_PUBLISHED) => TOP_PUBLISHED[name].year + TOP_PUBLISHED[name].setup;
  const bars = [
    { name: "Golf Genius", amount: theirYear("Golf Genius"), ours: false },
    { name: "BlueGolf", amount: theirYear("BlueGolf"), ours: false },
    { name: "TourneyHQ", amount: eagleYear, ours: true },
  ];
  const widest = Math.max(...bars.map((b) => b.amount));

  // The live moment's facts, as the capture command measured them.
  const r = FACTS.rects;
  const moment = {
    player: FACTS.player, hole: FACTS.hole, score: FACTS.score, field: FACTS.field,
    holesBefore: FACTS.holesBefore, holesAfter: FACTS.holesAfter, placeBefore: FACTS.placeBefore, placeAfter: FACTS.placeAfter,
    deskBefore: r["live-desk-before"].selfRow, deskAfter: r["live-desk-after"].selfRow,
    press: r["live-card-before"].press, boardRow: r["live-board-after"].selfRow,
  };

  const page = (
    <div className="thq n-site" lang={shown.locale}>
      <style dangerouslySetInnerHTML={{ __html: LANDING_CSS }} />
      <style dangerouslySetInnerHTML={{ __html: NEW_CSS }} />
      <link rel="preload" href="/new/fonts/archivo-latin-wdth-normal.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      <link rel="preload" href="/new/fonts/atkinson-hyperlegible-next-latin-wght-normal.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(siteStructuredData({ origin: siteOrigin(), overrides, currency: shown.currency, launch, sameAs: channels.map((c) => c.url) })),
        }}
      />
      {iconSprite()}
      <a className="n-skip" href="#main">Skip to the page</a>

      <header className="n-hdr">
        <div className="n-wrap n-hdr-in">
          <a className="lockup" href="#top" aria-label="TourneyHQ — top of the page"><Lockup size={LOGO_SIZE.lg} /></a>
          <nav className="n-nav" aria-label="Sections">
            <a href="#day">How a day runs</a>
            <a href="#watch">The live board</a>
            <a href="#pricing">Pricing</a>
            <a href="/faq">Questions</a>
          </nav>
          <div className="n-hdr-act">
            <a href="/play">Playing today? <u>Enter code</u></a>
            <a href="#signin">Sign in</a>
            <a className="n-btn n-btn-go" href={start}>{words.navCta}</a>
            <details className="n-menu">
              <summary aria-label="Menu"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg></summary>
              <nav className="n-menu-panel" aria-label="Sections">
                <a href={start}>{words.navCta}</a>
                <a href="#day">How a day runs</a>
                <a href="#watch">The live board</a>
                <a href="#pricing">Pricing</a>
                <a href="/faq">Questions</a>
                <hr />
                <a href="/play">Playing today? Enter your code</a>
                <a href="#signin">Sign in</a>
              </nav>
            </details>
          </div>
        </div>
      </header>

      <main id="main">
        {/* ═════════ HERO: what it is, that it is real, what to do next ═════════ */}
        <section className="n-hero" id="top" aria-labelledby="hero-h">
          <div className="n-wrap n-hero-top">
            <div className="n-hero-head">
              <a className="n-kicker" href={words.pill.href}><i aria-hidden="true" />{words.pill.badge ? `${words.pill.badge}: ` : ""}{words.pill.text}</a>
              {/* Ajay's line (11 Oct), kept in the opening as the tagline and again as the close. */}
              <p className="n-tagline">From Registration to Recognition.</p>
              <h1 id="hero-h" className="n-display">
                <span>Run the whole competition.</span> <span className="n-h1-2">They score by phone.</span>
              </h1>
            </div>
            <div className="n-hero-side">
            <p className="n-hero-sub">
              <b>Golf tournament and league software</b><span className="n-sub-more"> for clubs, golf groups and leagues</span>.{" "}
              <span className="n-sub-more">Entries, the draw, live scoring, side games and the prize table, from one screen. </span>
              Players type a round code: no app, no account.
            </p>
            <div className="n-hero-go">
              <a className="n-btn n-btn-go" href={start}>{words.heroCta}</a>
              <a className="n-btn n-btn-line" href={demoDoorHref("card")}>Try the demo</a>
            </div>
            <ul className="n-hero-facts">
              {words.facts.map((f) => <li key={f}>{f}</li>)}
              <li>Playing today? <a className="n-link" href="/play">Enter your round code</a></li>
            </ul>
            </div>
          </div>

          <div className="n-wrap">
            <div className="n-plinth">
              <div className="n-stage">
                <HeroMoment
                  facts={moment}
                  deskBefore={screen("live-desk-before", "", SIZES.heroDesk, true)}
                  deskAfter={screen("live-desk-after", "", SIZES.heroDesk)}
                  card={screen("live-card-before", "", SIZES.heroPhone, true)}
                  board={screen("live-board-after", "", SIZES.heroPhone)}
                />
              </div>
            </div>
          </div>
          {/* On a phone the pill moves below the live moment, so the moment is in the first screen. */}
          <div className="n-wrap n-kicker-after">
            <a className="n-kicker" href={words.pill.href}><i aria-hidden="true" />{words.pill.badge ? `${words.pill.badge}: ` : ""}{words.pill.text}</a>
          </div>
          <p className="n-wrap n-caption">
            The app itself, at {FACTS.club}: a demo club with invented players. Every screen on this page is a capture of TourneyHQ, never a mock-up.
          </p>
        </section>

        {/* ═════════ THE COMMITTEE'S DESK ═════════ */}
        {/* Design B: a bento of real crops at unequal sizes. Each tile is a window onto a capture,
            cropped and shown nearer its own size; nothing in a screen is redrawn. */}
        <section className="n-sec" id="desk" aria-labelledby="desk-h">
          <div className="n-wrap">
            <div className="n-sec-head">
              <h2 id="desk-h" className="n-h2">The committee on a laptop.</h2>
              <p className="n-lead">Registration, flights, the draw, the tee sheet and the cut from one screen, in your club&rsquo;s colors. The field is on their phones.</p>
            </div>
            <div className="n-bento">
              <div className="n-tile n-tile-xl n-tile-bleed">
                <div className="n-tile-say"><span className="n-t" aria-hidden="true">1</span><b>What needs you comes first.</b><p>A disputed result, a card to approve, a player still to place.</p></div>
                <div className="n-win n-win-needs">{screen("desk-dashboard", "The organizer's dashboard during a round: what needs a decision, the tee sheet, and the pace of play group by group.", SIZES.bentoXl)}</div>
              </div>
              <div className="n-tile n-tile-tall">
                <div className="n-tile-say"><span className="n-t" aria-hidden="true">2</span><b>Nothing counts until you say so.</b><p>Cards are certified, approved or disputed. A result from the course waits for you.</p></div>
                <div className="n-tile-phone"><div className="n-phone"><div className="n-phone-screen">{screen("org-dashboard", "The organizer's dashboard on a phone: one disputed result to settle and one card to approve.", SIZES.bentoPhone)}</div></div></div>
              </div>
              <div className="n-tile n-tile-pace n-tile-bleed">
                <div className="n-tile-say"><span className="n-t" aria-hidden="true">3</span><b>Pace of play, group by group.</b><p>Which group is behind, and by how much, while the round is on.</p></div>
                <div className="n-win n-win-pace">{screen("desk-dashboard", "The pace of play on the organizer's dashboard: each group's tee time, holes played and when it is due in.", SIZES.bentoXl)}</div>
              </div>
              <div className="n-tile n-tile-128">
                <div className="n-128-say">
                  <p className="n-num-big n-num" aria-hidden="true">128</p>
                  <div>
                    <h3 className="n-h3">128 in the match play? Eight flights, eight champions.</h3>
                    <p>Divide a big field by handicap, by your own flights or at random. Each flight is its own knockout, and every player is told who they play.</p>
                  </div>
                </div>
                <div className="n-win n-win-flights">{screen("desk-matchplay", "The organizer's bracket screen for a match play of 128: eight flights of sixteen divided by handicap, and the Championship flight's draw with its first results.", SIZES.bentoWide)}</div>
              </div>
            </div>
          </div>
        </section>

        {/* ═════════ THE DAY BOARD ═════════ */}
        <section className="n-board-sec n-on-board" id="day" aria-labelledby="day-h">
          <div className="n-wrap">
            <div className="n-sec-head">
              <h2 id="day-h" className="n-h2">One competition, from the first entry to the prize table.</h2>
              <p className="n-lead">An example week at the demo club. Choose a time on the board.</p>
            </div>
            <BoardTabs
              label="The week, by time"
              idBase="day"
              layout="day"
              listClass="n-slats"
              tabClass="n-slat"
              tabs={DAY.map((d) => (
                <Fragment key={d.when}>
                  <span><span className="n-day-name">{d.day}</span><span className="n-when">{d.when}</span></span>
                  <span className="n-what">{d.what}</span>
                </Fragment>
              ))}
              panes={DAY.map((d) => (
                <Fragment key={d.when}>
                  <span className="n-who">{d.who}</span>
                  <h3>{d.h}</h3>
                  <p>{d.p}</p>
                </Fragment>
              ))}
              screens={DAY.map((d) => <Fragment key={d.when}>{screen(d.shot, d.alt, SIZES.day)}</Fragment>)}
            />
          </div>
        </section>

        {/* ═════════ THE WHOLE CLUB WATCHES ═════════ */}
        <section className="n-sec" id="watch" aria-labelledby="watch-h">
          <div className="n-wrap">
            <div className="n-watch">
              <h2 id="watch-h" className="n-watch-big"><span className="n-t">11:42.</span> A birdie on the 14th. The whole club sees it.</h2>
              <div>
                <p className="n-lead">Every card moves the board the moment it is saved: on the phone in a member&rsquo;s hand, on the laptop in the office, on the television in the bar. Anyone with the link can watch. Nobody signs in.</p>
                <div className="n-try">
                  <svg viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label="A QR code that opens a player's card at the demo club" shapeRendering="crispEdges">
                    <rect width={qr.size} height={qr.size} className="n-qr-ground" />
                    <path d={qr.d} className="n-qr-ink" />
                  </svg>
                  <p><b>Score a round yourself.</b>Scan it with your phone, or <a className="n-link" href={demoDoorHref("card")}>open a player&rsquo;s card</a> here, and watch the board take it.</p>
                </div>
                <ul className="n-doors" aria-label="The demo club's pages">
                  <li><a className="n-link" href={demoDoorHref("board")}>The board</a></li>
                  <li><a className="n-link" href={demoDoorHref("event")}>The event page</a></li>
                  <li><a className="n-link" href={demoDoorHref("clubhouse")}>The clubhouse screen</a></li>
                </ul>
              </div>
            </div>
            <div className="n-watch-row">
              <figure>
                <div className="n-phone"><div className="n-phone-screen">{screen("public-stableford", "A live public board ranked by Stableford points.", SIZES.watch)}</div></div>
                <figcaption><b>Stableford, live</b>Ranked by points as cards come in.</figcaption>
              </figure>
              <figure>
                <div className="n-phone"><div className="n-phone-screen">{screen("public-pairs", "A public board for a member-guest in foursomes: eight sides, their total over three rounds.", SIZES.watch)}</div></div>
                <figcaption><b>A member-guest</b>Foursomes sides, totalled over three rounds.</figcaption>
              </figure>
              <figure>
                <div className="n-phone"><div className="n-phone-screen">{screen("public-final", "The public board of a finished club championship: the final order, ranked by gross strokes.", SIZES.watch)}</div></div>
                <figcaption><b>The championship, final</b>The result for the whole club, with nothing to sign in to.</figcaption>
              </figure>
            </div>
            <p className="n-caption" style={{ textAlign: "left", marginLeft: 0 }}>{DEMO_LABEL}. {FACTS.club} is made up, and so is everybody on its boards.</p>
          </div>
        </section>

        {/* ═════════ ANY FORMAT, ANY FIELD ═════════ */}
        <section className="n-board-sec n-on-board" id="formats" aria-labelledby="formats-h">
          <div className="n-wrap">
            <div className="n-sec-head">
              <h2 id="formats-h" className="n-h2">{FORMAT_NAMES.length} formats. One leaderboard.</h2>
            </div>
            <div className="n-formats">
              <ul className="n-format-wall" aria-label="The formats it scores" data-no-dialect="">
                {FORMAT_NAMES.map((f) => <li key={f}>{f}</li>)}
              </ul>
              <div>
                <p className="n-lead">Each scored by its own rules, gross and net, with handicaps by the Rules. Stroke play to Stableford, match play to scramble, skins and Nassau. All on every plan.</p>
                <ul className="n-runs" aria-label="What it runs">
                  {["Weekly leagues", "Golf outings", "Club championships", "Knockouts", "Ryder-style cups", "Member-guests", "Charity scrambles", "Golf trips", "A Saturday foursome"].map((x) => <li key={x}>{x}</li>)}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ═════════ MONEY, AND WHEREVER YOU PLAY ═════════ */}
        <section className="n-sec" id="money" aria-labelledby="money-h">
          <div className="n-wrap">
            <BoardTabs
              label="The same screen in five countries"
              idBase="money"
              layout="money"
              listClass="n-coins"
              tabClass="n-coin"
              intro={
                <>
                  <h2 id="money-h" className="n-h2">Works out the money. Never holds it.</h2>
                  <p className="n-lead" style={{ marginTop: 22 }}>Skins, pots, prizes and trip costs, worked out from the cards, in your club&rsquo;s own currency and written the way your country writes it.</p>
                  <p className="n-never"><b>TourneyHQ never moves money.</b> Nothing is collected or paid through the app: it keeps the record, and your club settles the way it does today.</p>
                </>
              }
              tabs={WORLD.map((w) => (<Fragment key={w.place}><b aria-hidden="true">{w.symbol}</b><span>{w.place}</span></Fragment>))}
              panes={WORLD.map((w) => (<span key={w.place}>A club in {w.place.startsWith("United") ? `the ${w.place}` : w.place}: {w.money}.</span>))}
              screens={WORLD.map((w) => <Fragment key={w.place}>{screen(w.shot, w.alt, SIZES.money)}</Fragment>)}
            />
            <p className="n-also" data-no-dialect="">Also Canadian, Australian and New Zealand dollars, and yen. Yards or metres, carts or buggies, a Sunday or a Monday week.</p>
          </div>
        </section>

        {/* ═════════ YOUR COLOURS ═════════ */}
        <section className="n-sec" id="colors" aria-labelledby="colors-h">
          <div className="n-wrap">
            <div className="n-sec-head">
              <h2 id="colors-h" className="n-h2">Your club&rsquo;s colors, on every screen.</h2>
              <p className="n-lead">Choose a theme once and every screen wears it: the organizer&rsquo;s, the public board, every player&rsquo;s phone. Each is checked for how it reads in full sun.</p>
            </div>
            <div className="n-themes">
              {THEMES.map((t) => (
                <figure key={t.shot}>
                  <div className="n-phone"><div className="n-phone-screen">{screen(t.shot, `One board in the ${t.name} theme.`, SIZES.theme)}</div></div>
                  <figcaption data-no-dialect=""><i aria-hidden="true" style={{ background: t.swatch }} />{t.name}</figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>

        {/* ═════════ WHO IT IS FOR ═════════ */}
        <section className="n-sec" id="for" aria-labelledby="for-h">
          <div className="n-wrap">
            <h2 id="for-h" className="n-h2">Three ways in.</h2>
            <ul className="n-for">
              {AUDIENCES.map((a) => (
                <li key={a.who}>
                  <a href={a.href}>
                    <span className="n-who">{a.who}</span>
                    <p><b>{a.h}</b>{a.p}</p>
                    <span className="n-go">{a.go}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ═════════ PRICING ═════════ */}
        <section className="n-board-sec n-on-board" id="pricing" aria-labelledby="pricing-h">
          <div className="n-wrap">
            <div className="n-sec-head">
              <h2 id="pricing-h" className="n-h2">Priced on your field. Never per player.</h2>
            </div>
            <div className="n-plans">
              <div className="n-plan">
                <p className="n-tag">{planTagline(PLANS.free, golf)}</p>
                <h3>{PLANS.free.name}</h3>
                <div className="n-price">{prices.zero}</div>
                <p className="n-year">{words.freeYear}</p>
                <a className="n-btn n-btn-line" href={start}>{words.freeButton}</a>
                <ul>
                  <li>Up to {PLANS.free.limits.playersPerEvent} players</li>
                  <li>One tournament at a time</li>
                  <li>Every format, the live board, side games</li>
                </ul>
                <p className="n-term">{retentionNotice("free")}</p>
              </div>
              <div className="n-plan n-plan-pick">
                <p className="n-tag">{planTagline(PLANS.society, golf)}</p>
                <h3>{PLANS.society.name}</h3>
                <div className="n-price">{prices.society.monthly}<small>a month</small></div>
                <p className="n-year">or {prices.society.yearly} a year</p>
                <a className="n-btn n-btn-go" href={start}>{words.planButton(PLANS.society.name)}</a>
                <ul>
                  <li>Up to {PLANS.society.limits.playersPerEvent} players in a field</li>
                  <li>As many events as your season runs</li>
                  <li>A season table, and {retentionSummary(PLANS.society)}</li>
                </ul>
              </div>
              <div className="n-plan">
                <p className="n-tag">{planTagline(PLANS.club, golf)}</p>
                <h3>{PLANS.club.name}</h3>
                <div className="n-price">{prices.club.monthly}<small>a month</small></div>
                <p className="n-year">or {prices.club.yearly} a year</p>
                <a className="n-btn n-btn-line" href={start}>{words.planButton(PLANS.club.name)}</a>
                <ul>
                  <li>Any size of field</li>
                  <li>Up to {PLANS.club.limits.staffSeats} organizers and assistants</li>
                  <li>Your club&rsquo;s branding, ours removed</li>
                </ul>
              </div>
            </div>
            <p className="n-small">{words.pricingNote} Nothing is charged through the app. {note}</p>

            <div className="n-vs">
              <div>
                <h3 className="n-h3">A year on the top plan, elsewhere.</h3>
                <p>Each company&rsquo;s highest published plan for one club, with its one-time setup fee, beside ours with none. A league of up to {PLANS.society.limits.playersPerEvent} runs on {PLANS.society.name} for {prices.usd(birdieYear)}.</p>
              </div>
              <div>
                <ul className="n-bars" aria-label="A year on each company's highest published plan, setup fee included" data-no-dialect="">
                  {bars.map((b) => (
                    <li className={b.ours ? "n-us" : undefined} key={b.name}>
                      <span>{b.name}</span>
                      <span className="n-track"><span className="n-fill" style={{ width: `${((b.amount / widest) * 100).toFixed(1)}%` }} /></span>
                      <span className="n-amt">{prices.usd(b.amount)}</span>
                    </li>
                  ))}
                </ul>
                <div className="n-saved">
                  {bars.filter((b) => !b.ours).map((b) => <div key={b.name}><b className="n-num">{prices.usd(b.amount - eagleYear)}</b>less than {b.name}</div>)}
                </div>
              </div>
            </div>
            <p className="n-small">
              Golf Genius and BlueGolf prices are from each company&rsquo;s own website as of {PRICES_READ_ON}, in US dollars before tax, for
              one facility in the US or Canada with up to 36 holes. Prices change, so check with each provider. Both are trademarks of their
              owners; TourneyHQ is not affiliated with or endorsed by either.
              {contactEmail ? <> Several clubs, or a corporate golf program? {PLANS.enterprise.name} is scoped with you: write to <a href={`mailto:${SALES_EMAIL}`}>{SALES_EMAIL}</a>.</> : null}
              {" "}Coming: GHIN and WHS handicap services, and the app in the App Store and on Google Play.
            </p>
            <p className="n-more-links">
              <Link className="n-link" href="/#plans">Compare the plans</Link>
              <Link className="n-link" href="/#compare">TourneyHQ beside the two club platforms</Link>
              <Link className="n-link" href="/#features">Every feature</Link>
            </p>
          </div>
        </section>

        {/* ═════════ QUESTIONS ═════════ */}
        <section className="n-sec" id="questions" aria-labelledby="q-h">
          <div className="n-wrap">
            <h2 id="q-h" className="n-h2">Three questions first.</h2>
            <div className="n-qa">
              <div>
                <h3 className="n-h3">On every plan</h3>
                <ul className="n-every" aria-label="On every plan">
                  {everyPlan.map((item) => <li key={item.key} data-plan-term={item.key}>{item.label}</li>)}
                </ul>
              </div>
              <div className="n-answers">
                {ANSWERS.map((x) => (
                  <div className="n-answer" key={x.q}>
                    <h3>{x.q}</h3>
                    <p>{x.a}</p>
                    <a className="n-link" href={x.href}>The longer answer</a>
                  </div>
                ))}
                <p style={{ paddingTop: 22 }}><Link className="n-link" href="/faq">All {FAQ_COUNT} questions, answered</Link></p>
              </div>
            </div>
          </div>
        </section>

        {/* ═════════ FOLLOW ALONG ═════════ */}
        <section className="n-sec" id="follow" aria-labelledby="follow-h">
          <div className="n-wrap">
            <div className="n-sec-head">
              <h2 id="follow-h" className="n-h2">Follow along.</h2>
              <p className="n-lead">See TourneyHQ run before it opens: the app on the course, short walk-throughs, and the news as launch comes closer.</p>
            </div>
            <ul className="n-follow">
              {channels.map((c) => (
                <li key={c.key}>
                  <a href={c.url} rel="me noopener">
                    <span className="n-net">{c.name}<SocialIcon net={c.key} /></span>
                    <span className="n-handle">{c.handle}</span>
                    <p>{c.what}</p>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ═════════ THE CLOSE: sign up, or the early list while held ═════════ */}
        <section className="n-close" id="start" aria-labelledby="start-h">
          <div className="n-wrap n-close-grid">
            <div>
              <p className="n-display" aria-hidden="true"><span>From registration</span><span>to recognition.</span></p>
              <h2 id="start-h" className="n-h3" style={{ marginTop: 36 }}>{words.closeHeading}</h2>
              <p className="n-lead">{words.closeLead}</p>
              <div className="n-stores">
                {storeButton("ios", STORE_LINKS.ios)}
                {storeButton("android", STORE_LINKS.android)}
              </div>
              <p className="n-stores-note">Until then it installs straight from the browser on iPhone and Android: add it to your home screen and it opens in its own window, like an app.</p>
            </div>
            <div className="n-close-auth">
              <span id="signup" />
              <span id="signin" />
              <div className="authpanel"><LandingAuth defaultMode="signup" organizers={golf.organizers} golfGroup={golf.golfGroup} launch={launch} /></div>
            </div>
          </div>
        </section>
      </main>

      <footer className="n-ftr">
        <div className="n-wrap">
          <div className="n-ftr-top">
            <a className="lockup" href="#top" aria-label="TourneyHQ — top of the page"><Lockup size={LOGO_SIZE.lg} /></a>
            <nav aria-label="Footer">
              <ul>
                <li><a href="#pricing">Pricing</a></li>
                <li><a href="/faq">Questions</a></li>
                <li><a href="/play">Enter a round code</a></li>
                <li><a href={DEMO_HUB}>The demo club</a></li>
                {contactEmail ? <li><a href={`mailto:${contactEmail}`}>Contact</a></li> : null}
                <li><a href="#signin">Sign in</a></li>
              </ul>
            </nav>
            <ul className="n-socials" aria-label="TourneyHQ elsewhere">
              {SOCIAL_CHANNELS.filter((c) => c.url !== "").map((c) => (
                <li key={c.key}><a href={c.url} rel="me noopener"><SocialIcon net={c.key} label={`TourneyHQ on ${c.name}`} /></a></li>
              ))}
            </ul>
          </div>
          <div className="n-ftr-base">
            <span>&copy; {new Date().getFullYear()} TourneyHQ. Made by AjAi Labs.</span>
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
            <span>Every screen on this site is a capture of the app, on invented demo data.</span>
            <span className="ed-note">{note}</span>
          </div>
        </div>
      </footer>
    </div>
  );

  return inDialect(page, editionSwaps(shown));
}

/** An app-store button: the listing when it exists, otherwise the FAQ answer on installing it today. */
function storeButton(store: "ios" | "android", url: string) {
  const live = Boolean(url);
  const [lead, name, ic] =
    store === "ios"
      ? [live ? "Download on the" : "Coming soon to the", "App Store", "apple-phone"]
      : [live ? "Get it on" : "Coming soon on", "Google Play", "android-phone"];
  const inner = (<>{icon(ic)}<span><small>{lead}</small><b>{name}</b></span></>);
  return live ? (
    <a className="n-store" href={url} rel="noopener">{inner}</a>
  ) : (
    <Link className="n-store" href="/faq#q-stores" aria-label={`${lead} ${name}. How to install it from your browser today`}>{inner}</Link>
  );
}
