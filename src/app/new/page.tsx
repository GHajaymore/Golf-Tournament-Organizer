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
import { SALES_EMAIL } from "@/lib/contact";
import { SOCIAL_LINKS, type SocialId } from "@/lib/social-links";
import { LandingAuth } from "@/components/LandingAuth";
import { launchState } from "@/lib/services/signins-switch";
import { frontDoorWords } from "@/lib/go-live";
import { contactEmail, editionNote, icon, iconSprite } from "@/components/landing/chrome";
import { plainShot } from "@/components/landing/shots";
import { Lockup } from "@/components/Lockup";
import { LOGO_SIZE } from "@/components/Logo";
import { landingScreen } from "@/lib/landing/screens";
// The hero's live moment as design D's own capture measured it (Tournament theme, dark ground).
import FACTS from "./d-facts.json";
import D_SHOTS from "./d-shots.json";
import { NEW_CSS } from "./new-styles";
import { BoardTabs } from "./BoardTabs";
import { DayStory, type StoryStep } from "./DayStory";
import { HeroMoment } from "./HeroMoment";
import { SocialIcon } from "./social-icons";

/**
 * THE SITE REHAUL — A PREVIEW (2026-11-01). Ajay: "I didn't like it. Show me the complete rehaul of
 * the site." Built beside today's front door so `/` is untouched: this page is never indexed and
 * nothing links to it. It says what `/` says — the same claims, the same prices read from PLANS, the
 * same held/live words from `go-live.ts` — in a new order, a new type and a new layout. The design
 * plan is in `TourneyHQ Documents\Landing concepts Nov 2026\Rehaul\Design plan.md`.
 *
 * DESIGN C (2026-11-02), one of several drafts put side by side: the day told as a scroll story.
 * The hero stands the live board on a phone in slight perspective on the app's own dark ground;
 * then one phone stays in view while its real screen turns with each moment of the day, from the
 * first entry to the prize table (`DayStory`). Below 768px it is a plain sequence.
 *
 * DESIGN D, "FLOODLIT" (2026-11-02): today's navy drama made deeper. The hero stands the live
 * moment (a score goes in on a member's phone and the committee's board moves, `HeroMoment`) on a
 * green under evening floodlights; C's scroll story is the spine; B's bento carries the
 * committee's desk; the money, the formats and the close sit on lit turf and glass. The
 * backdrops (`public/new/d`) are made images of light and grass only: every screen is still a
 * real capture, framed and lit, never redrawn.
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
  heroDesk: "(max-width: 767px) 100vw, min(820px, 56vw)",
  heroPhone: "(max-width: 767px) min(64vw, 260px), min(250px, 17vw)",
  // The bento's windows show a laptop capture zoomed in (1.25 to 2.6 times the window).
  bentoXl: "(max-width: 680px) 200vw, (max-width: 1000px) 130vw, 860px",
  bentoWide: "(max-width: 680px) 230vw, (max-width: 1000px) 125vw, 860px",
  bentoPhone: "(max-width: 680px) 70vw, (max-width: 1000px) 40vw, 320px",
  story: "(max-width: 767px) min(72vw, 280px), 240px",
  storyDesk: "(max-width: 1100px) 46vw, 600px",
  // On a phone a console moment is a window onto its capture, drawn 3.2 windows wide.
  storyDetail: "(max-width: 767px) 300vw, 1px",
  watch: "(max-width: 900px) min(64vw, 260px), 300px",
  money: "(max-width: 900px) min(80vw, 330px), 330px",
  theme: "(max-width: 900px) min(58vw, 230px), 290px",
} as const;

/**
 * DESIGN D'S OWN CAPTURES (2026-11-02): the same invented demo club, shot by
 * `scripts/capture-demo.mjs --theme=<pair>:<ground>` in four club themes, so the screens on the page
 * are not all one colour (Ajay). Unedited; resized with the landing's "crisp" treatment into
 * `public/new/d/shots`, their true sizes in `d-shots.json`.
 *
 *   Tournament (Verdigris + Optic), dark  ·  the hero's live moment
 *   Desert (Bunker + Verdigris), dark     ·  the day's story
 *   Championship (Claret + Bunker), light ·  the committee's desk
 *   Coastal (Links + Bunker), light       ·  the money
 */
function dShot(name: keyof typeof D_SHOTS, alt: string, sizes: string, priority = false) {
  const e = D_SHOTS[name];
  const big = e.v[e.v.length - 1];
  return (
    // eslint-disable-next-line @next/next/no-img-element -- pre-sized copies with a srcset; next/image would re-encode them
    <img
      src={`/new/d/shots/${name}.w${big}.webp`}
      srcSet={e.v.map((w) => `/new/d/shots/${name}.w${w}.webp ${w}w`).join(", ")}
      sizes={sizes}
      width={e.w}
      height={e.h}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding="async"
    />
  );
}

/**
 * THE DAY: one competition at the demo club, in the order it happens, told by BOTH sides: what the
 * committee does on the laptop, and what a member sees on their phone. The times are an example and
 * are said to be (Ajay, 2026-10-11): a draw goes out days before the round.
 */
const DAY: Array<{ day: string; when: string; what: string; who: string; h: string; p: string; shot: keyof typeof D_SHOTS; device: "laptop" | "phone"; alt: string }> = [
  { day: "Monday", when: "09:00", what: "The season", who: "The organizer", device: "laptop", h: "You set up the season.",
    p: "Every tournament the club runs, in one list: the medal, the league night, the championship, each with its status and its field.",
    shot: "c-tournaments-desert", alt: "The organizer's Tournaments list: each tournament with its status, course and number of players." },
  { day: "Monday", when: "09:05", what: "Entries open", who: "Players", device: "phone", h: "They put their name down.",
    p: "From their own phone. You see who is in, who is out and who is waiting.",
    shot: "p-events-desert", alt: "A player's Events screen: a casual round, their calendar, and the club's tournaments." },
  { day: "Thursday", when: "18:00", what: "The draw", who: "The organizer", device: "laptop", h: "You publish the draw.",
    p: "Drawn from who's in, then yours to adjust: pairing requests are kept together where the draw can, and every group has its tee and its time.",
    shot: "c-teesheet-desert", alt: "The organizer's tee sheet: two pairing requests above the published draw of six groups with their tee times." },
  { day: "Saturday", when: "08:05", what: "The code", who: "Players", device: "phone", h: "They scan the sign.",
    p: "Each round's printed sign carries a QR code and its eight-character code. Scan or type it, tap your name, and you're on your round. No account and no password.",
    shot: "p-today-desert", alt: "A player's Today screen: a pinned notice, their card so far and their position." },
  { day: "Saturday", when: "10:50", what: "The card", who: "Players", device: "phone", h: "They tap the score, or say it.",
    p: "The card saves as they go, and keeps saving when there is no signal. In a match the organizer chooses how it is kept: one tap for who won each hole, or stroke cards with gross and net.",
    shot: "p-card-desert", alt: "My card, by hole: hole 10, par 4, score buttons and a microphone." },
  { day: "Saturday", when: "11:42", what: "The office", who: "The organizer", device: "laptop", h: "The office sees every group.",
    p: "What needs you comes first, a disputed result or a card to approve, then the pace of play group by group while the round is on.",
    shot: "c-dashboard-desert", alt: "The organizer's dashboard during the round: what needs a decision, the tee sheet, and the pace of play group by group." },
  { day: "Saturday", when: "14:00", what: "The money", who: "Everyone", device: "phone", h: "Everyone knows who owes what.",
    p: "Skins, pots and shared costs in one settle-up. Worked out, never collected.",
    shot: "p-money-desert", alt: "A player's Money screen: what they are owed, and who pays whom to settle it." },
  { day: "Saturday", when: "15:30", what: "The result", who: "The organizer", device: "laptop", h: "The result, ready for the prize table.",
    p: "Final standings, flight results and the print kit, with the tournament's final report on one page.",
    shot: "c-reports-desert", alt: "The organizer's Reports screen for the finished championship: players, cards in, the exports and the final standings." },
  { day: "Saturday", when: "15:31", what: "Recognition", who: "Everyone", device: "phone", h: "The champion is on every phone.",
    p: "The final board, each round's result and the order, in every member's hand before the prize-giving starts.",
    shot: "p-final-desert", alt: "A player's Board for the finished championship: the result of each round, then the final order." },
];

/**
 * The story's five chapters, in the order of the tagline: from registration to recognition. Each
 * names the first moment of the day it opens (an index into DAY); the moments after it belong to
 * it until the next one opens.
 */
const CHAPTERS: Array<{ n: number; title: string; first: number }> = [
  { n: 1, title: "Entries", first: 0 },
  { n: 2, title: "The draw and the tee sheet", first: 2 },
  { n: 3, title: "Scoring by phone", first: 3 },
  { n: 4, title: "The live round", first: 5 },
  { n: 5, title: "The prize table", first: 6 },
];

const STEPS: StoryStep[] = DAY.map((d, i) => {
  const ch = [...CHAPTERS].reverse().find((c) => c.first <= i)!;
  return { chapter: ch.n, chapterTitle: ch.first === i ? ch.title : undefined, day: d.day, when: d.when, what: d.what, who: d.who, h: d.h, p: d.p, device: d.device };
});

/** Five demo clubs, each in its own money, written the way that country writes it (all in Coastal). */
const WORLD: Array<{ shot: keyof typeof D_SHOTS; symbol: string; place: string; money: string; alt: string }> = [
  { shot: "p-money-coastal", symbol: "$", place: "United States", money: "US dollars", alt: "A player's Money screen at a club in Indiana: what they are owed, in dollars." },
  { shot: "p-money-gbp-coastal", symbol: "£", place: "United Kingdom", money: "Pounds", alt: "The same screen at a club in England, in pounds." },
  { shot: "p-money-eur-coastal", symbol: "€", place: "Ireland", money: "Euros", alt: "The same screen at a club in Ireland, in euros." },
  { shot: "p-money-zar-coastal", symbol: "R", place: "South Africa", money: "Rand", alt: "The same screen at a club in South Africa, in rand, written with a decimal comma." },
  { shot: "p-money-inr-coastal", symbol: "₹", place: "India", money: "Rupees", alt: "The same screen at a club in India, in rupees." },
];

/** One board in the four club themes the page is shot in. The swatch is the theme's own accent hue. */
const THEMES: Array<{ shot: keyof typeof D_SHOTS; name: string; swatch: string }> = [
  { shot: "p-board-tournament", name: "Tournament, dark", swatch: "hsl(182 68% 40%)" },
  { shot: "p-board-desert", name: "Desert, dark", swatch: "hsl(42 72% 52%)" },
  { shot: "p-board-championship", name: "Championship, light", swatch: "hsl(352 62% 42%)" },
  { shot: "p-board-coastal", name: "Coastal, light", swatch: "hsl(205 70% 46%)" },
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

/** What is on each channel (the addresses themselves are only in `lib/social-links.ts`). */
const ON_EACH: Record<SocialId, string> = {
  facebook: "News for organizers, and updates as launch comes closer.",
  instagram: "Pictures and short clips of the app at work: the board, the card, the prize table.",
};

const STORE_LINKS = {
  ios: process.env.TOURNEYHQ_IOS_URL ?? "",
  android: process.env.TOURNEYHQ_ANDROID_URL ?? "",
};

export default async function NewSitePreview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const showFilmSlot = (await searchParams).slot === "video";
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
  const channels = SOCIAL_LINKS;

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
          __html: JSON.stringify(siteStructuredData({ origin: siteOrigin(), overrides, currency: shown.currency, launch, sameAs: channels.map((c) => c.href) })),
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
          <div className="n-flood" aria-hidden="true" />
          <div className="n-wrap n-hero-grid">
          <div className="n-hero-top">
            <a className="n-kicker" href={words.pill.href}><i aria-hidden="true" />{words.pill.badge ? `${words.pill.badge}: ` : ""}{words.pill.text}</a>
            {/* Ajay's line (11 Oct), kept in the opening as the tagline and again as the close. */}
            <p className="n-tagline">From Registration to Recognition.</p>
            <h1 id="hero-h" className="n-display">
              <span>Run the whole competition.</span> <span className="n-h1-2">They score by phone.</span>
            </h1>
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
            </ul>
          </div>

          {/* The live moment under the floodlights: the committee's laptop and a member's phone, real
              captures before and after one score goes in. The light, the pool on the green and the
              shadows are drawn around the devices, never into a screen. */}
          <div className="n-stage">
            <span className="n-pool" aria-hidden="true" />
            <HeroMoment
              facts={moment}
              deskView={{ z: 1.28, fx: 0.2, fy: 0.22 }}
              deskBefore={dShot("live-desk-before-tournament", "", SIZES.heroDesk, true)}
              deskAfter={dShot("live-desk-after-tournament", "", SIZES.heroDesk)}
              card={dShot("live-card-before-tournament", "", SIZES.heroPhone, true)}
              board={dShot("live-board-after-tournament", "", SIZES.heroPhone)}
            />
          </div>
          </div>
          {/* On a phone the pill moves below the live board, so the board is in the first screen. */}
          <div className="n-wrap n-kicker-after">
            <a className="n-kicker" href={words.pill.href}><i aria-hidden="true" />{words.pill.badge ? `${words.pill.badge}: ` : ""}{words.pill.text}</a>
          </div>
          <p className="n-wrap n-caption">
            The app itself, at {FACTS.club}: a demo club with invented players. Every screen on this page is a capture of TourneyHQ, never a mock-up, shown in four of the club themes: each club picks its own colors, and the organizer&rsquo;s screens, the board and every player&rsquo;s phone wear them.
          </p>
        </section>

        {/* ═════════ THE STORY: the day in order, one phone in view ═════════ */}
        <section className="n-story-sec" id="day" aria-labelledby="day-h">
          <div className="n-wrap">
            <div className="n-story-head">
              <p className="n-eyebrow">From Registration to Recognition.</p>
              <h2 id="day-h" className="n-h2">One competition, from the first entry to the prize table.</h2>
              <p className="n-lead">An example week at the demo club.</p>
            </div>
            <DayStory
              steps={STEPS}
              chapters={CHAPTERS.map(({ n, title }) => ({ n, title }))}
              screens={DAY.map((d) => <Fragment key={d.when}>{dShot(d.shot, d.alt, d.device === "laptop" ? SIZES.storyDesk : SIZES.story)}</Fragment>)}
              inline={DAY.map((d) => <Fragment key={d.when}>{dShot(d.shot, d.alt, d.device === "laptop" ? SIZES.storyDetail : SIZES.story)}</Fragment>)}
            />
          </div>
        </section>

        {/* ═════════ THE FILM: a slot kept for the narrated demo (not built yet) ═════════
            Ajay, 2026-11-02: a narrated film of a tournament from setup to prize-giving will sit on
            this page once the screens settle. Until it exists nothing here pretends to play: the slot
            is drawn only behind `?slot=video` (for the design captures), never on the page itself. */}
        {showFilmSlot ? (
          <section className="n-sec n-film" aria-labelledby="film-h">
            <div className="n-wrap n-film-in">
              <div>
                <p className="n-eyebrow">Placeholder: the film is not made yet</p>
                <h2 id="film-h" className="n-h2">Watch a tournament from setup to prize-giving.</h2>
              </div>
              <div className="n-film-frame">
                <div className="n-lid"><div className="n-lid-screen">{dShot("c-tournaments-desert", "", SIZES.storyDesk)}</div></div>
                <p className="n-film-note">Poster frame: a real screen. The narrated film goes here when it exists.</p>
              </div>
            </div>
          </section>
        ) : null}

        {/* ═════════ THE COMMITTEE'S DESK ═════════ */}
        <section className="n-sec" id="desk" aria-labelledby="desk-h">
          {/* Design B's bento, on glass: each tile a window onto a real capture, cropped and shown
              nearer its own size; nothing in a screen is redrawn. */}
          <div className="n-wrap">
            <div className="n-sec-head">
              <h2 id="desk-h" className="n-h2">The committee on a laptop.</h2>
              <p className="n-lead">Registration, flights, the draw, the tee sheet and the cut from one screen, in your club&rsquo;s colors. The field is on their phones.</p>
            </div>
            <div className="n-bento">
              <div className="n-tile n-tile-xl n-tile-bleed">
                <div className="n-tile-say"><span className="n-t" aria-hidden="true">1</span><b>The whole field, gross and net.</b><p>The leaderboard across every flight, live as the cards come in: overall, or flight by flight.</p></div>
                <div className="n-win n-win-needs">{dShot("c-leaderboard-championship", "The organizer's leaderboard during the round: each player's flight, holes played, gross, net and score to par.", SIZES.bentoXl)}</div>
              </div>
              <div className="n-tile n-tile-tall">
                <div className="n-tile-say"><span className="n-t" aria-hidden="true">2</span><b>Nothing counts until you say so.</b><p>Cards are certified, approved or disputed. A result from the course waits for you.</p></div>
                <div className="n-tile-phone"><div className="n-phone"><div className="n-phone-screen">{dShot("p-orgdash-championship", "The organizer's dashboard on a phone: one disputed result to settle and one card to approve.", SIZES.bentoPhone)}</div></div></div>
              </div>
              <div className="n-tile n-tile-pace n-tile-bleed">
                <div className="n-tile-say"><span className="n-t" aria-hidden="true">3</span><b>Pace of play, group by group.</b><p>Which group is behind, and by how much, while the round is on.</p></div>
                <div className="n-win n-win-pace">{dShot("c-dashboard-championship", "The pace of play on the organizer's dashboard: each group's tee time, holes played and when it is due in.", SIZES.bentoXl)}</div>
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

        {/* ═════════ THE WHOLE CLUB WATCHES ═════════ */}
        <section className="n-sec n-turf" id="watch" aria-labelledby="watch-h">
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
        <section className="n-band" id="formats" aria-labelledby="formats-h">
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
              screens={WORLD.map((w) => <Fragment key={w.place}>{dShot(w.shot, w.alt, SIZES.money)}</Fragment>)}
            />
            <p className="n-also" data-no-dialect="">Also Canadian, Australian and New Zealand dollars, and yen. Yards or metres, carts or buggies, a Sunday or a Monday week.</p>
          </div>
        </section>

        {/* ═════════ YOUR COLOURS ═════════ */}
        <section className="n-sec" id="colors" aria-labelledby="colors-h">
          <div className="n-wrap">
            <div className="n-sec-head">
              <h2 id="colors-h" className="n-h2">Your club&rsquo;s colors, on every screen.</h2>
              <p className="n-lead">Choose a theme once and every screen wears it: the organizer&rsquo;s, the public board, every player&rsquo;s phone. The picker says which read best in full sun.</p>
            </div>
            <div className="n-themes">
              {THEMES.map((t) => (
                <figure key={t.shot}>
                  <div className="n-phone"><div className="n-phone-screen">{dShot(t.shot, `One board in the ${t.name} theme.`, SIZES.theme)}</div></div>
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
        <section className="n-band" id="pricing" aria-labelledby="pricing-h">
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
                <li key={c.id}>
                  <a href={c.href} rel="me noopener">
                    <span className="n-net">{c.label}<SocialIcon net={c.id} /></span>
                    <p>{ON_EACH[c.id]}</p>
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
              {channels.map((c) => (
                <li key={c.id}><a href={c.href} rel="me noopener"><SocialIcon net={c.id} label={`TourneyHQ on ${c.label}`} /></a></li>
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
