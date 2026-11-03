import { Fragment, type CSSProperties, type ReactNode } from "react";
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
import { SOCIAL_LINKS } from "@/lib/social-links";
import { LandingAuth } from "@/components/LandingAuth";
import { launchState } from "@/lib/services/signins-switch";
import { frontDoorWords } from "@/lib/go-live";
import { contactEmail, editionNote, icon, iconSprite } from "@/components/landing/chrome";
import { plainShot } from "@/components/landing/shots";
import { Lockup } from "@/components/Lockup";
import { LOGO_SIZE } from "@/components/Logo";
import { landingScreen } from "@/lib/landing/screens";
import SHOT_WIDTHS from "@/lib/landing/shot-widths.json";
import { posterFontVars } from "@/app/fonts";
import { THEME_PAIRS, secondaryFor, themeFor } from "@/lib/themes";
// The hero's live moment as design D's own capture measured it (Tournament theme, dark ground).
import FACTS from "./d-facts.json";
import D_SHOTS from "./d-shots.json";
import { NEW_CSS } from "./new-styles";
import { BoardTabs } from "./BoardTabs";
import { DayStory, type StoryStep } from "./DayStory";
import { HeroMoment } from "./HeroMoment";
import { SocialIcon } from "./social-icons";
import { Course } from "./course";
import { LIGHT, type LightName } from "./day-light";
import { PIPELINE } from "./pipeline";

/**
 * THE SITE REHAUL — A PREVIEW (2026-11-01). Built beside today's front door so `/` is untouched:
 * this page is never indexed and nothing links to it. It says what `/` says — the same claims, the
 * same prices read from PLANS, the same held/live words from `go-live.ts`.
 *
 * DESIGN F (2026-11-03), D and E mixed and taken further. Ajay liked E's hero ("similar to what our
 * current is") and found E too player-centric. So F keeps E's frame — the page is one tournament
 * day's light, dawn behind the hero and golden hour over the champion and the final report — and
 * puts D's substance in it: the ORGANIZER leads (organizers buy; about 60% of the page is theirs),
 * the hero's moment is the committee's laptop with a member's phone, the day is told on both
 * devices, and the players appear as what the organizer's field experiences. New since D and E: the
 * guided setup and the honest card and figures that explain themselves (real screens of features on
 * main), the demo club's own pages, and the pipeline's sections behind their switches
 * (`pipeline.ts`, all off).
 *
 * Every screen is a real capture, flat and upright; only layers marked `aria-hidden` are lit or
 * dimmed, and nobody is asked to read one. A section whose screen has not been placed yet is not
 * drawn (`placed`), so the page never shows an empty frame.
 *
 * Unlike `/`, a signed-in visitor is NOT sent on to the app: the owners judging the preview are
 * signed in.
 */
export const metadata: Metadata = {
  title: "TourneyHQ: golf tournament and league software (preview)",
  robots: NOINDEX,
  alternates: { canonical: "/" },
};

/** Has this manifest screen been shot and placed? A section waits for its picture. */
function placed(id: string): boolean {
  const e = (SHOT_WIDTHS as Record<string, { h?: number }>)[id];
  return Boolean(e && e.h);
}

/** Draw a capture the manifest names (`src/lib/landing/screens.ts`) — and only one it names. */
function screen(id: string, alt: string, sizes: string, priority = false) {
  landingScreen(id);
  return plainShot({ name: id, alt, sizes, priority });
}

/** One of design D's own captures (`public/new/d/shots`, their true sizes in `d-shots.json`). */
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
 * A console capture seen through a window (a framed crop): drawn as the window's background, so the
 * picture never reaches past the window's edge (`.n-bg`). The pixels are the capture's own sharp
 * copies, unedited; the alternative text is the window's label.
 */
function zoomed(src: { d: keyof typeof D_SHOTS } | { landing: string }, alt: string) {
  if ("landing" in src) landingScreen(src.landing);
  const base = "d" in src ? `/new/d/shots/${src.d}` : `/landing/${src.landing}`;
  return (
    <div
      className="n-bg"
      role={alt ? "img" : undefined}
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : true}
      style={{ backgroundImage: `image-set(url("${base}.w1620.webp") 1x, url("${base}.w2160.webp") 2x)` }}
    />
  );
}

const SIZES = {
  heroPhone: "(max-width: 767px) min(54vw, 220px), min(250px, 17vw)",
  story: "(max-width: 767px) min(72vw, 280px), 240px",
  storyDesk: "(max-width: 1100px) 46vw, 600px",
  bentoPhone: "(max-width: 680px) 70vw, (max-width: 1000px) 40vw, 320px",
  watch: "(max-width: 900px) min(64vw, 260px), 300px",
  money: "(max-width: 900px) min(80vw, 330px), 330px",
  feature: "(max-width: 900px) min(70vw, 280px), 300px",
  field: "(max-width: 520px) min(72vw, 280px), 240px",
  // Below 600px a laptop capture is cropped to a square and drawn twice as wide.
  wide: "(max-width: 600px) 200vw, (max-width: 900px) 100vw, 66vw",
  final: "(max-width: 767px) min(62vw, 250px), 300px",
} as const;

/**
 * A moment's screen: one of D's captures, or one of the manifest's (E's themed ones). A laptop
 * moment is always a window onto its capture; a phone moment is the whole screen.
 */
type Shot = { d: keyof typeof D_SHOTS } | { landing: string };
function momentScreen(shot: Shot, device: "laptop" | "phone", alt: string): ReactNode {
  if (device === "laptop") return zoomed(shot, alt);
  return "d" in shot ? dShot(shot.d, alt, SIZES.story) : screen(shot.landing, alt, SIZES.story);
}

/**
 * THE DAY, up to the moment the office sees every group: one competition at the demo club, told by
 * BOTH sides (D) in the light of its hour (E). The organizer opens it and closes it; the members
 * are what the organizer's field does in between. The times are an example and are said to be
 * (Ajay, 2026-10-11): a draw goes out days before the round. The money (14:00) and the result
 * (17:40) have sections of their own further down, in the light of their hour.
 */
const DAY: Array<{ day: string; when: string; what: string; who: string; h: string; p: string; shot: Shot; device: "laptop" | "phone"; alt: string; tone: LightName }> = [
  { day: "Monday", when: "09:00", what: "The season", who: "The organizer", device: "laptop", tone: "night", h: "You set up the season.",
    p: "Every tournament the club runs, in one list: the medal, the league night, the championship, each with its status and its field. Copy last year's and change the dates.",
    shot: { d: "c-tournaments-desert" }, alt: "The organizer's Tournaments list: each tournament with its status, course and number of players." },
  { day: "Monday", when: "09:05", what: "Entries open", who: "Your field", device: "phone", tone: "night", h: "They put their name down.",
    p: "From their own phone. You see who is in, who is out and who is waiting.",
    shot: { d: "p-events-desert" }, alt: "A player's Events screen: a casual round, their calendar, and the club's tournaments." },
  { day: "Thursday", when: "18:00", what: "The draw", who: "The organizer", device: "laptop", tone: "night", h: "You publish the draw.",
    p: "Drawn from who's in, then yours to adjust: pairing requests are kept together where the draw can, and every group has its tee and its time.",
    shot: { d: "c-teesheet-desert" }, alt: "The organizer's tee sheet: two pairing requests above the published draw of six groups with their tee times." },
  { day: "Saturday", when: "08:05", what: "The code", who: "Your field", device: "phone", tone: "sunrise", h: "They scan the sign.",
    p: "Each round's printed sign carries a QR code and its eight-character code. Scan or type it, tap your name, and you're on your round. No account and no password.",
    shot: { landing: "e-club-today" }, alt: "A player's Today screen: the round, a pinned notice, their card so far and their position." },
  { day: "Saturday", when: "10:50", what: "The card", who: "Your field", device: "phone", tone: "morning", h: "They tap the score, or say it.",
    p: "The card saves as they go, and keeps saving when there is no signal. In a match you choose how it is kept: one tap for who won each hole, or stroke cards with gross and net.",
    shot: { landing: "e-club-card" }, alt: "My card, by hole: hole 10, par 4, score buttons and a microphone." },
  { day: "Saturday", when: "11:42", what: "The office", who: "The organizer", device: "laptop", tone: "morning", h: "The office sees every group.",
    p: "What needs you comes first, a disputed result or a card to approve, then the pace of play group by group while the round is on.",
    shot: { landing: "e-desk-dashboard" }, alt: "The organizer's dashboard during the round: what needs a decision, the tee sheet, and the pace of play group by group." },
];

/** The story's chapters, each naming the first moment it opens (an index into DAY). */
const CHAPTERS: Array<{ n: number; title: string; first: number }> = [
  { n: 1, title: "Entries", first: 0 },
  { n: 2, title: "The draw and the tee sheet", first: 2 },
  { n: 3, title: "Scoring by phone", first: 3 },
  { n: 4, title: "The live round", first: 5 },
];

const STEPS: StoryStep[] = DAY.map((d, i) => {
  const ch = [...CHAPTERS].reverse().find((c) => c.first <= i)!;
  return { chapter: ch.n, chapterTitle: ch.first === i ? ch.title : undefined, day: d.day, when: d.when, what: d.what, who: d.who, h: d.h, p: d.p, device: d.device, tone: d.tone };
});

/** Five demo clubs, each in its own money, written the way that country writes it. */
const WORLD: Array<{ shot: string; symbol: string; place: string; money: string; alt: string }> = [
  { shot: "club-money", symbol: "$", place: "United States", money: "US dollars", alt: "A player's Money screen at a club in Indiana: what they are owed, in dollars." },
  { shot: "world-gbp-money", symbol: "£", place: "United Kingdom", money: "Pounds", alt: "The same screen at a club in Harrogate, in pounds." },
  { shot: "world-eur-money", symbol: "€", place: "Ireland", money: "Euros", alt: "The same screen at a club in Kilkenny, in euros." },
  { shot: "world-zar-money", symbol: "R", place: "South Africa", money: "Rand", alt: "The same screen at a club in Stellenbosch, in rand, written with a decimal comma." },
  { shot: "world-inr-money", symbol: "₹", place: "India", money: "Rupees", alt: "The same screen at a club in Pune, in rupees." },
];

/**
 * The four club themes the screens on this page wear (Ajay, 2 Nov), named as the app's theme picker
 * names them (`THEME_PAIRS`), each swatch the pair's accent then its second color, read from the
 * presets rather than typed.
 */
const THEMES = (["tournament", "desert", "championship", "coastal"] as const).map((key) => {
  const pair = THEME_PAIRS.find((p) => p.key === key)!;
  const a = themeFor(pair.accentKey);
  const b = secondaryFor(pair.secondaryKey);
  const hsl = (t: { hue: number; saturation: number }) => `hsl(${t.hue} ${Math.round(t.saturation * 100)}% 46%)`;
  return { name: pair.name, swatch: `linear-gradient(90deg, ${hsl(a)} 50%, ${hsl(b)} 50%)` };
});

const AUDIENCES: Array<{ who: string; h: string; p: string; href: string; go: string }> = [
  { who: "Clubs", h: "Every competition, in your colors.",
    p: "The medal, the championship and the knockout, any size of field, with the board on the clubhouse TV and in every member's hand.",
    href: "#pricing", go: "See the club plans" },
  { who: "Leagues & golf groups", h: "A season, not just a day.",
    p: "Weekly leagues, golf groups and outings: every foursome's tee time on their phone, a table across the season, and who owes whom worked out.",
    href: "/faq#q-league", go: "How a league runs" },
  { who: "Golf pros", h: "Your event, from your phone.",
    p: "A clinic day, a member-guest or a corporate day, with the field scoring from a round code and no account to make.",
    href: DEMO_HUB, go: "See a day run" },
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

/** The chapter marker: the hour, and what the light is doing. An example day, said once under the hero. */
function Hour({ light, children }: { light: LightName; children?: ReactNode }) {
  const l = LIGHT[light];
  return (
    <p className="e-hour">
      <span className="e-hour-sun" aria-hidden="true" />
      <b className="n-num">{l.clock}</b>
      <span>{children ?? l.label}</span>
    </p>
  );
}

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st: the hole as a person says it. */
function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const tail = teen ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${tail}`;
}

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
  const nth = ordinal(FACTS.hole);

  // What has landed since D and E (real screens of features on main), drawn once each is placed.
  const has = {
    checklist: placed("f-desk-checklist"),
    why: placed("f-why-board"),
    sync: placed("f-card-sync"),
    eventPage: placed("f-event-page"),
    clubhouse: placed("f-clubhouse"),
  };
  const setupRows = has.checklist || PIPELINE.setupQuestions.on || PIPELINE.courseDay.on || PIPELINE.cardPhoto.on;
  const fieldRows = has.why || has.sync;

  const page = (
    <div className="thq n-site" lang={shown.locale} style={posterFontVars}>
      <style dangerouslySetInnerHTML={{ __html: LANDING_CSS }} />
      <style dangerouslySetInnerHTML={{ __html: NEW_CSS }} />
      <link rel="preload" href="/new/fonts/atkinson-hyperlegible-next-latin-wght-normal.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(siteStructuredData({ origin: siteOrigin(), overrides, currency: shown.currency, launch, sameAs: SOCIAL_LINKS.map((s) => s.href) })),
        }}
      />
      {iconSprite()}
      <a className="n-skip" href="#main">Skip to the page</a>

      <header className="n-hdr">
        <div className="n-wrap n-hdr-in">
          <a className="lockup" href="#top" aria-label="TourneyHQ — top of the page"><Lockup size={LOGO_SIZE.lg} /></a>
          <nav className="n-nav" aria-label="Sections">
            <a href="#day">How a day runs</a>
            <a href="#desk">The committee&rsquo;s desk</a>
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
                <a href="#desk">The committee&rsquo;s desk</a>
                <a href="#pricing">Pricing</a>
                <a href="/faq">Questions</a>
                <hr />
                <a href="/play">Playing today? Enter your code</a>
                <a href="#signin">Sign in</a>
              </nav>
            </details>
          </div>
        </div>
        {/* The day, as a line of light under the header: the sun crosses it as the page is read. */}
        <div className="e-daybar" aria-hidden="true"><span /></div>
      </header>

      <main id="main">
        {/* ═════════ 06:12, FIRST LIGHT: what it is, that it is real, what to do next ═════════ */}
        <section className="n-hero e-sec e-l-dawn" id="top" aria-labelledby="hero-h">
          <div className="e-sky e-sky-dawn" aria-hidden="true" />
          {/* A photograph of a course at first light (Canva AI, checked as believable), laid low and faint under the CSS light. */}
          <div className="e-photo e-photo-dawn" aria-hidden="true" />
          <div className="n-wrap n-hero-grid">
            <div className="n-hero-top">
              <a className="n-kicker" href={words.pill.href}><i aria-hidden="true" />{words.pill.badge ? `${words.pill.badge}: ` : ""}{words.pill.text}</a>
              <p className="n-tagline">Golf tournament &amp; league software</p>
              <h1 id="hero-h" className="e-h1">
                <span>From Registration</span>
                <span>to <span className="e-hl">Recognition.<svg className="e-putt" viewBox="0 0 200 24" preserveAspectRatio="none" aria-hidden="true"><path d="M2 14 C 55 0, 130 30, 186 13" /></svg><i className="e-ball" aria-hidden="true" /></span></span>
              </h1>
              <p className="e-sub"><span>Run the whole competition.</span> <span>They score by phone.</span></p>
              <p className="n-hero-sub">
                <b>Golf tournament and league software</b><span className="n-sub-more"> for clubs, golf groups and leagues</span>.{" "}
                <span className="n-sub-more">Entries, the draw, live scoring, side games and the prize table, from one screen. </span>
                Players type a round code: no app, no account.
              </p>
              <div className="n-hero-go">
                <a className="n-btn n-btn-go" href={start}>{words.heroCta}</a>
                <a className="n-btn n-btn-line" href={DEMO_HUB}>See a demo club&rsquo;s day</a>
              </div>
              <ul className="n-hero-facts">
                {words.facts.map((f) => <li key={f}>{f}</li>)}
                <li>Playing today? <a className="n-link" href="/play">Enter your round code</a></li>
              </ul>
            </div>

            {/* The live moment in the first light: the committee's laptop and a member's phone, real
                captures before and after one score goes in. The light and the shadows are drawn
                around the devices, never into a screen. */}
            <div className="n-stage">
              <div className="e-stage-hour"><Hour light="dawn" /></div>
              <HeroMoment
                facts={moment}
                startAfter={1700}
                deskView={{ z: 1.28, fx: 0.2, fy: 0.22 }}
                deskBefore={zoomed({ d: "live-desk-before-tournament" }, "")}
                deskAfter={zoomed({ d: "live-desk-after-tournament" }, "")}
                card={dShot("live-card-before-tournament", "", SIZES.heroPhone, true)}
                board={dShot("live-board-after-tournament", "", SIZES.heroPhone)}
              />
            </div>
          </div>
          {/* On a phone the pill moves below the live moment, so the moment is in the first screen. */}
          <div className="n-wrap n-kicker-after">
            <a className="n-kicker" href={words.pill.href}><i aria-hidden="true" />{words.pill.badge ? `${words.pill.badge}: ` : ""}{words.pill.text}</a>
          </div>
          <Course variant="dawn" />
        </section>

        {/* ═════════ THE WEEK BEFORE, THEN SATURDAY MORNING: the day on both devices ═════════ */}
        <section className="n-story-sec e-sec e-l-night" id="day" aria-labelledby="day-h">
          <div className="n-wrap">
            <p className="n-caption e-hero-caption">
              The app itself, at {FACTS.club}: a demo club with invented players. Every screen on this page is a capture of TourneyHQ, never a mock-up, shown in four of the club themes, and every time is one example day there.
            </p>
            <div className="n-story-head">
              <Hour light="night" />
              <h2 id="day-h" className="n-h2">One competition, from the first entry to the live round.</h2>
              <p className="n-lead">You on the laptop, your field on their phones. The work is done in the week before; on Saturday morning, the field arrives.</p>
            </div>
            <DayStory
              steps={STEPS}
              chapters={CHAPTERS.map(({ n, title }) => ({ n, title }))}
              screens={DAY.map((d) => <Fragment key={d.when}>{momentScreen(d.shot, d.device, d.alt)}</Fragment>)}
              inline={DAY.map((d) => <Fragment key={d.when}>{momentScreen(d.shot, d.device, d.alt)}</Fragment>)}
            />
          </div>
        </section>

        {/* ═════════ 11:42, THE WHOLE CLUB WATCHES ═════════ */}
        <section className="n-sec e-sec e-l-morning" id="watch" aria-labelledby="watch-h">
          <div className="n-wrap">
            <div className="n-watch">
              <h2 id="watch-h" className="n-watch-big"><span className="n-t">11:42.</span> A birdie on the 14th. The whole club sees it.</h2>
              <div>
                <p className="n-lead">Every card moves the board the moment it is saved: on your laptop in the office, on the television in the bar, on the phone in a member&rsquo;s hand. Anyone with the link can watch. Nobody signs in.</p>
                <div className="n-try">
                  <svg viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label="A QR code that opens a player's card at the demo club" shapeRendering="crispEdges">
                    <rect width={qr.size} height={qr.size} className="n-qr-ground" />
                    <path d={qr.d} className="n-qr-ink" />
                  </svg>
                  <p><b>Score a round yourself.</b>Scan it with your phone, or <a className="n-link" href={demoDoorHref("card")}>open a player&rsquo;s card</a> here, and watch the board take it.</p>
                </div>
                <ul className="n-doors" aria-label="The demo club's pages">
                  <li><a className="n-link" href={DEMO_HUB}>See a demo club&rsquo;s day</a></li>
                  <li><a className="n-link" href={demoDoorHref("event")}>The event page</a></li>
                  <li><a className="n-link" href={demoDoorHref("clubhouse")}>The clubhouse screen</a></li>
                </ul>
              </div>
            </div>
            <div className="e-watch-row">
              <figure className="e-fig-lap">
                {has.clubhouse ? (
                  <>
                    <div className="n-lid n-crop" style={{ "--cx": "50%" } as CSSProperties}><div className="n-lid-screen">{screen("f-clubhouse", "The clubhouse screen for the demo club's stroke play: the live board, sized for the television in the bar.", SIZES.wide)}</div></div>
                    <figcaption><b>In the bar: the clubhouse screen</b>The live board on the television, turning itself as cards come in. Open it on any screen; nothing to sign in to.</figcaption>
                  </>
                ) : (
                  <>
                    <div className="n-lid n-crop" style={{ "--cx": "53%" } as CSSProperties}><div className="n-lid-screen">{screen("live-desk-after", `The committee's leaderboard on a laptop, the moment ${FACTS.player}'s ${FACTS.score} on the ${nth} goes in: gross, net and to par for every player, by flight.`, SIZES.wide)}</div></div>
                    <figcaption><b>In the office: the committee&rsquo;s leaderboard</b>Every flight, gross and net, the moment a card is saved.</figcaption>
                  </>
                )}
              </figure>
              {has.eventPage ? (
                <figure>
                  <div className="n-phone"><div className="n-phone-screen">{screen("f-event-page", "The tournament's public event page on a phone: the day's round, the leaders and the links to the board.", SIZES.watch)}</div></div>
                  <figcaption><b>The event page</b>The day, the leaders and the board, on any phone, by a link.</figcaption>
                </figure>
              ) : (
                <figure>
                  <div className="n-phone"><div className="n-phone-screen">{screen("public-pairs", "A public board for a member-guest in foursomes: eight sides, their total over three rounds.", SIZES.watch)}</div></div>
                  <figcaption><b>A member-guest</b>Foursomes sides, over three rounds.</figcaption>
                </figure>
              )}
              <figure>
                <div className="n-phone"><div className="n-phone-screen">{screen("public-stableford", "A live public board ranked by Stableford points.", SIZES.watch)}</div></div>
                <figcaption><b>Stableford, live</b>Ranked by points as cards come in.</figcaption>
              </figure>
            </div>
            <p className="n-caption e-caption-left">{DEMO_LABEL}. {FACTS.club} is made up, and so is everybody on its boards.</p>
          </div>
        </section>

        {/* ═════════ 12:30, MIDDAY: the committee's desk ═════════ */}
        <section className="n-sec e-sec e-l-midday e-from-morning" id="desk" aria-labelledby="desk-h">
          <div className="e-sky e-sky-midday" aria-hidden="true" />
          <div className="n-wrap">
            <div className="n-sec-head">
              <Hour light="midday">Midday. Half the field is in, and the office is busy.</Hour>
              <h2 id="desk-h" className="n-h2">The committee on a laptop.</h2>
              <p className="n-lead">Registration, flights, the draw, the tee sheet and the cut from one screen, in your club&rsquo;s colors. The field is on their phones.</p>
            </div>
            <div className="n-bento">
              <div className="n-tile n-tile-xl n-tile-bleed">
                <div className="n-tile-say"><span className="n-t" aria-hidden="true">1</span><b>What needs you comes first.</b><p>A disputed result, a card to approve, a player still to place.</p></div>
                <div className="n-win n-win-needs">{zoomed({ landing: "e-desk-dashboard" }, "The organizer's tournament dashboard during a round, in the Championship theme: one disputed result to settle, one card to approve, the round's tee sheet, and the pace of play group by group.")}</div>
              </div>
              <div className="n-tile n-tile-tall">
                <div className="n-tile-say"><span className="n-t" aria-hidden="true">2</span><b>Nothing counts until you say so.</b><p>Cards are certified, approved or disputed. A result from the course waits for you.</p></div>
                <div className="n-tile-phone"><div className="n-phone"><div className="n-phone-screen">{dShot("p-orgdash-championship", "The organizer's dashboard on a phone: one disputed result to settle and one card to approve.", SIZES.bentoPhone)}</div></div></div>
              </div>
              <div className="n-tile n-tile-pace n-tile-bleed">
                <div className="n-tile-say"><span className="n-t" aria-hidden="true">3</span><b>Pace of play, group by group.</b><p>Which group is behind, and by how much, while the round is on.</p></div>
                <div className="n-win n-win-pace">{zoomed({ d: "c-dashboard-championship" }, "The pace of play on the organizer's dashboard: each group's tee time, holes played and when it is due in.")}</div>
              </div>
              <div className="n-tile n-tile-draw n-tile-bleed">
                <div className="n-tile-say"><span className="n-t" aria-hidden="true">4</span><b>Flights, your way.</b><p>Balanced, by handicap, by seeding, at random or by hand. Preview it, then generate.</p></div>
                <div className="n-win n-win-draw">{zoomed({ landing: "e-desk-grouping" }, "The organizer's Flights screen in the Coastal theme: six ways to form flights, and a preview of six flights of four with each flight's average handicap.")}</div>
              </div>
              <div className="n-tile n-tile-128">
                <div className="n-128-say">
                  <p className="n-num-big n-num" aria-hidden="true">128</p>
                  <div>
                    <h3 className="n-h3">128 in the match play? Eight flights, eight champions.</h3>
                    <p>Divide a big field by handicap, by your own flights or at random. Each flight is its own knockout, and every player is told who they play.</p>
                  </div>
                </div>
                <div className="n-win n-win-flights">{zoomed({ landing: "desk-matchplay" }, "The organizer's bracket screen for a match play of 128: eight flights of sixteen divided by handicap, and the Championship flight's draw with its first results.")}</div>
              </div>
            </div>

            <div className="n-formats" id="formats">
              <div>
                <h2 className="n-h2 e-h2-sm">{FORMAT_NAMES.length} formats. One leaderboard.</h2>
                <p className="n-lead">Each scored by its own rules, gross and net, with handicaps by the Rules. Stroke play to Stableford, match play to scramble, skins and Nassau. All on every plan.</p>
                <ul className="n-runs" aria-label="What it runs">
                  {["Weekly leagues", "Golf outings", "Club championships", "Knockouts", "Ryder-style cups", "Member-guests", "Charity scrambles", "Golf trips", "A Saturday foursome"].map((x) => <li key={x}>{x}</li>)}
                </ul>
              </div>
              <ul className="n-format-wall" aria-label="The formats it scores" data-no-dialect="">
                {FORMAT_NAMES.map((f) => <li key={f}>{f}</li>)}
              </ul>
            </div>
          </div>
        </section>

        {/* ═════════ NEW: SETTING UP, WITH THE NEXT STEP IN VIEW (the organizer's) ═════════
            Real screens of features on main, each drawn once it is placed; the pipeline's rows each
            behind their switch in `pipeline.ts` (off until the pull request that ships them). */}
        {setupRows ? (
          <section className="n-sec e-sec e-l-midday" id="setup" aria-labelledby="setup-h">
            <div className="n-wrap">
              <div className="n-sec-head">
                <h2 id="setup-h" className="n-h2">Setting up, with the next step in view.</h2>
                <p className="n-lead">A new tournament starts as a draft that nobody else sees. TourneyHQ says what is still to do, in the order a tournament is set up, until you launch it.</p>
              </div>
              <div className="f-rows">
                {PIPELINE.setupQuestions.on ? (
                  <div className="f-row">
                    <div className="f-row-say">
                      <h3 className="n-h3">Set up with a few questions.</h3>
                      <p>Seven questions, each with an answer already chosen for a club like yours: what you are running, how it is played and scored, the first day, who keeps the scores. Change what is different, check the scorecard, and TourneyHQ makes a draft you review before anything is published.</p>
                    </div>
                    <div className="n-win f-win-questions">{zoomed({ landing: "f-setup-questions" }, "The setup questions on a laptop: each question with its answer already chosen and a line saying why.")}</div>
                  </div>
                ) : null}
                {has.checklist ? (
                  <div className="f-row">
                    <div className="f-row-say">
                      <h3 className="n-h3">The dashboard keeps the list.</h3>
                      <p>What is done and what is still to set up, in order, from the field to the format to the round codes. It stays on the dashboard after the field is in, until you launch.</p>
                    </div>
                    <div className="n-win f-win-checklist">{zoomed({ landing: "f-desk-checklist" }, "The organizer's dashboard for a tournament taking entries, in the Desert theme on the dark ground: the setup checklist saying what is still to set up before launch.")}</div>
                  </div>
                ) : null}
                {PIPELINE.courseDay.on ? (
                  <div className="f-row">
                    <div className="f-row-say">
                      <h3 className="n-h3">Every round on one timeline.</h3>
                      <p>Rounds &amp; formats lays the tournament out as a course day: each round&rsquo;s date, course, format and tee times. What is still missing is said in words, with what it costs the players.</p>
                    </div>
                    <div className="n-win f-win-course-day">{zoomed({ landing: "f-course-day" }, "Rounds and formats as a timeline: each round with its state, its recipe and what still needs the organizer.")}</div>
                  </div>
                ) : null}
                {PIPELINE.cardPhoto.on ? (
                  <div className="f-row f-row-phone">
                    <div className="f-row-say">
                      <h3 className="n-h3">The scorecard, read from a photo.</h3>
                      <p>Take a picture of the course&rsquo;s card. TourneyHQ reads each hole&rsquo;s par, stroke index and yards into the card for you.</p>
                      <p className="f-plain">It reads the card; you check it. Nothing is saved until you have looked at every hole.</p>
                    </div>
                    <div className="n-phone"><div className="n-phone-screen">{screen("f-card-photo", "A course's card read from a photo, each hole's par, stroke index and yards laid out for the organizer to check.", SIZES.feature)}</div></div>
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}

        {/* ═════════ NEW: FEWER QUESTIONS ON THE DAY (what the organizer's field sees) ═════════ */}
        {fieldRows ? (
          <section className="n-sec e-sec e-l-midday" id="field" aria-labelledby="field-h">
            <div className="n-wrap">
              <div className="n-sec-head">
                <h2 id="field-h" className="n-h2">Fewer questions at the desk.</h2>
                <p className="n-lead">What your field sees on their phones answers most of what they would come and ask you.</p>
              </div>
              <div className="f-field">
                {has.why ? (
                  <figure>
                    <div className="n-phone"><div className="n-phone-screen">{screen("f-why-board", "A player's board with one figure opened: a sentence saying how it was worked out, and the Rule it follows.", SIZES.field)}</div></div>
                    <figcaption><b>Every figure explains itself.</b>Tap a score or a place, and one sentence says how it was worked out, with the Rule it follows. A net score, a tie on the countback: settled on the phone, not at the desk.</figcaption>
                  </figure>
                ) : null}
                {has.sync ? (
                  <figure>
                    <div className="n-phone"><div className="n-phone-screen">{screen("f-card-sync", "A player's card with no signal: the hole just played says On your phone, the holes before it are marked Sent.", SIZES.field)}</div></div>
                    <figcaption><b>The card says where each score is.</b>Every hole says On your phone, Sent or Not sent. No signal on the far side of the course? The score waits on the phone and goes when it can, and the player can see that it did.</figcaption>
                  </figure>
                ) : null}
              </div>
              <p className="f-also"><b>The round code works on a slow phone, too.</b> It takes a press from the moment the page appears, even on a weak signal, so nobody stands at the first tee waiting for it to load.</p>
            </div>
          </section>
        ) : null}

        {/* ═════════ 14:00, AFTERNOON: the money, and wherever you play ═════════ */}
        <section className="n-sec e-sec e-l-afternoon e-from-midday" id="money" aria-labelledby="money-h">
          <div className="n-wrap">
            <BoardTabs
              label="The same screen in five countries"
              idBase="money"
              layout="money"
              listClass="n-coins"
              tabClass="n-coin"
              intro={
                <>
                  <Hour light="afternoon">The last cards are in. Everyone knows who owes what.</Hour>
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

          <div className="n-wrap e-ledger">
            <div>
              <h3 className="n-h3">On your laptop: the prize list.</h3>
              <p>The purse, every prize line and its winner. The skins sit underneath, worked out from the cards.</p>
            </div>
            <div className="n-lid n-crop" style={{ "--cx": "53%" } as CSSProperties}><div className="n-lid-screen">{screen("e-desk-prizes", "The organizer's Prizes and payouts screen in the Championship theme: a $470 purse, four prize lines, three awarded, and the winners beside each prize.", SIZES.wide)}</div></div>
          </div>

          {/* Each club picks its colors (Ajay, 2 Nov: the screens are not all one scheme). */}
          <div className="n-wrap" id="colors">
            <p className="e-themes-line" data-no-dialect="">
              <b>Every club picks its own colors,</b> and they reach the console, the board and every player&rsquo;s phone. On this page:
              {THEMES.map((t) => (
                <span key={t.name}><i aria-hidden="true" style={{ background: t.swatch }} />{t.name}</span>
              ))}
            </p>
          </div>
        </section>

        {/* ═════════ 16:20, LATE AFTERNOON: who it is for, what it costs, three questions ═════════ */}
        <section className="n-sec e-sec e-l-late e-from-afternoon" id="for" aria-labelledby="for-h">
          <div className="n-wrap">
            <Hour light="late" />
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

          <div className="n-wrap e-pricing" id="pricing">
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

          <div className="n-wrap e-questions" id="questions">
            <h2 id="q-h" className="n-h2 e-h2-sm">Three questions first.</h2>
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

        {/* ═════════ THE FILM: a slot kept for the narrated demo (not made yet) ═════════
            Ajay, 2026-11-02: a narrated film of a tournament from setup to prize-giving will sit here,
            before golden hour, once the screens settle. Until it exists nothing here pretends to play:
            the slot is drawn only behind `?slot=video` (for the design captures), never on the page. */}
        {showFilmSlot ? (
          <section className="n-sec e-sec e-l-late n-film" aria-labelledby="film-h">
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

        {/* ═════════ 17:40, GOLDEN HOUR: the result ═════════ */}
        <section className="e-sec e-l-golden e-golden" id="result" aria-labelledby="result-h">
          <div className="e-golden-sky" aria-hidden="true">
            <div className="e-photo e-photo-golden" />
            <Course variant="golden" />
          </div>
          <div className="n-wrap e-final">
            <div className="e-final-say">
              <Hour light="golden" />
              <h2 id="result-h" className="n-h2">The champion is on the board.</h2>
              <p className="n-lead">The final report, the prizes and the honors board, done before the prize-giving starts. The whole club can open the result, with nothing to sign in to.</p>
              <ul className="e-final-facts">
                <li>Each round&rsquo;s result, then the final order</li>
                <li>Ranked the way the event is played: gross, net or points</li>
                <li>Prizes and side games worked out, never collected</li>
              </ul>
            </div>
            <div className="e-final-pics">
              <figure className="e-fig-report">
                <div className="n-lid n-crop" style={{ "--cx": "80%" } as CSSProperties}><div className="n-lid-screen">{screen("e-desk-report", "The organizer's final report for the club championship, in the Tournament theme on the dark ground: the champion, the prize list with gross and net, and each player's place after each round.", SIZES.wide)}</div></div>
                <figcaption><b>The final report, on your laptop</b>The champion, the prize list and how the places moved. Print it, or share its link.</figcaption>
              </figure>
              <figure className="e-fig-final">
                <div className="n-phone"><div className="n-phone-screen">{screen("e-club-final", "A player's Board for the finished championship, in the Desert theme on the dark ground: the result of each round, then the final order.", SIZES.final)}</div></div>
                <figcaption><b>On every player&rsquo;s phone</b>Each round, then the final order.</figcaption>
              </figure>
            </div>
          </div>
        </section>

        {/* ═════════ 19:30, THE PRIZE-GIVING: the close ═════════ */}
        <section className="n-close e-sec e-l-evening e-from-golden" id="start" aria-labelledby="start-h">
          <div className="e-lanterns" aria-hidden="true" />
          <div className="n-wrap n-close-grid">
            <div>
              <Hour light="evening" />
              <p className="e-close-line" aria-hidden="true"><span>From registration</span><span>to recognition.</span></p>
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
              {SOCIAL_LINKS.map((s) => (
                <li key={s.id}><a href={s.href} rel="me noopener"><SocialIcon net={s.id} label={`TourneyHQ on ${s.label}`} /></a></li>
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
