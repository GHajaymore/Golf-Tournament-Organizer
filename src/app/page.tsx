import { Fragment } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { landingScreenFor } from "@/lib/roles";
import { PLANS, effectiveAnnualPrice, phoneRequiredFor, retentionNotice, retentionSummary, type PlanKey } from "@/lib/plans";
import { storedPricingOverrides } from "@/lib/services/platform-pricing";
import { siteStructuredData } from "@/lib/domain/structured-data";
import { siteOrigin } from "@/lib/site";
import { editionSwaps, landingEdition, US_OVERRIDE_COOKIE } from "@/lib/landing/edition";
import { inDialect } from "@/lib/landing/dialect";
import { golfTermsFor } from "@/lib/domain/golf-terms";
import { landingPrices, type LandingPrices } from "@/lib/landing/pricing";
import { FAQ_COUNT, FORMAT_NAMES } from "@/lib/landing/faq";
import { featureCount, featureGroups } from "@/lib/landing/features";
import { LANDING_CSS } from "@/lib/landing/styles";
import { HOME_CSS } from "@/lib/landing/home-styles";
import { COMPARED_ON, PRICES_READ_ON, RIVALS, TOP_PUBLISHED, compareRows, type Cell } from "@/lib/landing/compare";
import { SALES_EMAIL } from "@/lib/contact";
import { LandingAuth } from "@/components/LandingAuth";
import { LandingEffects } from "@/components/LandingEffects";
import { LandingHomeEffects } from "@/components/LandingHomeEffects";
import { FeatureSearch } from "@/components/landing/FeatureSearch";
import { contactEmail, editionNote, icon, iconSprite, landingFooter, landingNav } from "@/components/landing/chrome";
import { plainShot, thumbShot } from "@/components/landing/shots";
import { posterFontVars } from "@/app/fonts";

/**
 * Only the canonical. Title, description and the share cards come from the root
 * layout, and this is the one page whose content those defaults describe — so
 * naming them again here would be two copies of the same sentence to keep in
 * step.
 */
export const metadata = { alternates: { canonical: "/" } };

/**
 * The app-store listings, when they exist. Empty today, so each button reads
 * "Coming soon" and — never a dead control (Ajay, 2026-09-28: "I don't want
 * anyone to click on it when it does nothing") — opens the FAQ answer on
 * installing it from the browser now. Set a URL in the environment and that
 * button links to the listing instead. Swap in Apple's and Google's official
 * badge artwork at the same moment — both companies allow their badges only on
 * a link to a live listing.
 */
const STORE_LINKS = {
  ios: process.env.TOURNEYHQ_IOS_URL ?? "",
  android: process.env.TOURNEYHQ_ANDROID_URL ?? "",
};

/** The plans, in the order the page shows them. */
const PLAN_KEYS: PlanKey[] = ["free", "society", "club"];

/**
 * "Compare plans": only what DIFFERS between the plans, every cell read from
 * PLANS. TourneyHQv2 read the code (2026-09-29): of the 69 feature lines only
 * the order of merit (seasonStandings) and white-label are plan-gated; the rest
 * is on every plan, which the table's footer says. The limits are the plans'
 * published terms — the page never claims anyone is blocked at them.
 */
function planDiff(prices: LandingPrices): [string, React.ReactNode[]][] {
  const each = (f: (k: PlanKey) => React.ReactNode) => PLAN_KEYS.map(f);
  const count = (n: number | null, one: string) => (n === null ? "No limit" : n === 1 ? one : `Up to ${n}`);
  const has = (on: boolean, note?: string) =>
    on ? <><span className="cp-m cp-y" aria-hidden="true">✓</span><span className="sr">Included</span>{note ? <small>{note}</small> : null}</>
       : <><span className="cp-m cp-x" aria-hidden="true">✕</span><span className="sr">Not included</span></>;
  return [
    ["Price", [
      <><b>{prices.zero}</b><small>free for good</small></>,
      <><b>{prices.society.yearly} a year</b><small>or {prices.society.monthly} a month</small></>,
      <><b>{prices.club.yearly} a year</b><small>or {prices.club.monthly} a month</small></>,
    ]],
    ["Players in one tournament", each((k) => count(PLANS[k].limits.playersPerEvent, "One"))],
    ["Tournaments at once", each((k) => count(PLANS[k].limits.activeEvents, "One"))],
    ["Organizers and assistants", each((k) => count(PLANS[k].limits.staffSeats, "One"))],
    ["Results kept", each((k) => capitalise(retentionSummary(PLANS[k]).replace(/^results /, "")))],
    ["Players' mobile numbers", each((k) => (phoneRequiredFor(k, false, "email") ? <>Asked<small>not with round codes</small></> : <>Your choice<small>per tournament</small></>))],
    ["Order of merit across events", each((k) => has(PLANS[k].features.seasonStandings))],
    ["The honors board", each((k) => has(PLANS[k].features.honours))],
    ["Your club's branding in place of ours", each((k) => has(PLANS[k].features.whiteLabel, "with your logo"))],
  ];
}

/**
 * How wide each picture is SHOWN, per place it sits — the `sizes` its <img>
 * carries. These must stay true to the stylesheet (`home-styles.ts`): from them
 * the browser picks which copy of a capture to fetch, and a wrong one fetches a
 * copy far too large (shrunk soft) or far too small (stretched), and then
 * reuses it everywhere else the same picture appears.
 */
const SIZES = {
  // The width the stylesheet draws it at (`.m-hero-phone` below 900px). It said 220px after the pair
  // was made to scale with the screen, so a 640-wide tablet was sent a picture for 220 and drew it
  // at 290, soft — found by the first round to hold a tablet (2026-10-13).
  heroPhone: "(max-width: 899px) min(56vw, 290px), 330px",
  heroDesk: "(max-width: 899px) 1px, 900px",
  story: "(max-width: 899px) min(60vw, 250px), 300px",
  step: "250px",
  desk: "(max-width: 899px) 1px, min(1070px, 92vw)",
  twin: "(max-width: 899px) min(70vw, 270px), 1px",
  peek: "(max-width: 899px) 70vw, 290px",
  themes: "250px",
  world: "(max-width: 899px) min(58vw, 250px), 200px",
} as const;

/**
 * ONE COMPETITION, FROM THE FIRST ENTRY TO THE PRIZE TABLE — the week at the
 * demo club, in the order it happens. Each moment is a real screen and each
 * sentence is what that screen does. The times are an example and are said to
 * be (Ajay, 2026-10-11: "is it real or realistic and are we showing it in
 * right way for people to understand?"): a draw goes out days before the
 * round, never on the morning, so Thursday is Thursday.
 */
const WEEK: Array<{ when: string; tab: string; who: string; h: string; p: string; shot: string; alt: string }> = [
  { when: "Mon 09:00", tab: "Registration", who: "Players", h: "Entries open.",
    p: "Players put their name down from their own phone. You see who is in, who is out and who is waiting.",
    shot: "club-enter", alt: "A player's Events screen: a tournament open for entries, 22 of 40 places left, and the button to enter." },
  { when: "Thu 18:00", tab: "The draw", who: "Organizer", h: "You publish the draw.",
    p: "Drawn from who's in, then yours to adjust. Every player has their group and tee time on their phone.",
    shot: "org-teesheet", alt: "The organizer's tee sheet: two pairing requests above the published draw." },
  { when: "Sat 08:05", tab: "The code", who: "Players", h: "They type the code.",
    p: "Eight characters put a player on their round. No account and no password.",
    shot: "club-today", alt: "A player's Today screen: the round, a pinned notice, their card so far and their position." },
  { when: "10:50", tab: "The card", who: "Players", h: "They tap the score, or say it.",
    p: "The card saves as they go, and keeps saving when there is no signal.",
    shot: "club-card", alt: "My card, by hole: hole 10, par 4, score buttons and a microphone." },
  { when: "11:42", tab: "The board", who: "Everyone", h: "The board moves.",
    p: "Their own line first, then the field, as every card comes in.",
    shot: "club-board", alt: "The player's Board: their own position first, then the field." },
  { when: "14:00", tab: "The money", who: "Everyone", h: "Everyone knows who owes what.",
    p: "Skins, pots and shared costs in one settle-up.",
    shot: "club-money", alt: "A player's Money screen: what they are owed, and who pays whom to settle it." },
  { when: "15:30", tab: "Recognition", who: "Organizer", h: "The champion is on the board.",
    p: "The final board, the prizes and the honors board, done before the prize-giving starts.",
    shot: "club-final", alt: "A player's Board for the finished championship: the result of each round, then the final order." },
];

/** The wall behind 11:42: small copies of real screens, never read, so they may be turned. Each column runs twice. */
const WALL = [
  ["club-board", "club-card", "public-pairs"],
  ["club-today", "public-final", "club-money"],
  ["public-cup", "world-gbp-board", "org-teesheet"],
  ["world-inr-board", "org-dashboard", "club-enter"],
] as const;

/**
 * WHEREVER YOU PLAY (Ajay, 2026-10-11: "that will be our one of the marketing
 * point"). Five different demo clubs, each with its own members and figures,
 * in its own money, written the way that country writes it.
 */
const WORLD: Array<{ shot: string; symbol: string; place: string; money: string; alt: string }> = [
  { shot: "club-money", symbol: "$", place: "United States", money: "US dollars", alt: "A player's Money screen at a club in Indiana: what they are owed, in dollars." },
  { shot: "world-gbp-money", symbol: "£", place: "United Kingdom", money: "Pounds", alt: "The same screen at a club in Harrogate, in pounds." },
  { shot: "world-eur-money", symbol: "€", place: "Ireland", money: "Euros", alt: "The same screen at a club in Kilkenny, in euros." },
  { shot: "world-zar-money", symbol: "R", place: "South Africa", money: "Rand", alt: "The same screen at a club in Stellenbosch, in rand, written with a decimal comma." },
  { shot: "world-inr-money", symbol: "₹", place: "India", money: "Rupees", alt: "The same screen at a club in Pune, in rupees." },
];

/**
 * Four of the club themes, on one board, two light and two dark — the one
 * place on the page where the colours vary. `swatch` is each theme's own
 * accent, as a strip under its band and a dot beside its name.
 */
const THEMES: Array<{ shot: string; name: string; swatch: string }> = [
  { shot: "look-tournament-light", name: "Tournament", swatch: "hsl(182 68% 36%)" },
  { shot: "look-championship-dark", name: "Championship, dark", swatch: "hsl(352 62% 42%)" },
  { shot: "look-coastal-light", name: "Coastal", swatch: "hsl(205 70% 46%)" },
  { shot: "look-midnight-dark", name: "Midnight, dark", swatch: "hsl(262 72% 60%)" },
];

/** The demo club's board at 11:42, as the strip under the first screen runs it. Names are the demo's, invented. */
const TICKER: Array<[string, string, string, string]> = [
  ["1", "Erin Walsh", "thru 9", "−6"],
  ["2", "Ana Costa", "F", "−3"],
  ["T3", "Ken Sato", "thru 9", "−2"],
  ["T3", "Cal Doyle", "thru 12", "−2"],
  ["T5", "Priya Nair", "thru 14", "−1"],
  ["T5", "Sean Molloy", "thru 12", "−1"],
];

/**
 * THE FRONT DOOR — rebuilt 2026-10-11 from the prototype Ajay steered through
 * twenty-six versions in an evening. Midnight navy, the logo's orange, a serif
 * headline, and the app's real screens: every picture is an unedited capture
 * of the app running a demo club with invented members.
 *
 * What it keeps from the page it replaces, because each was right:
 *  - THE VISITOR'S EDITION is decided here, on the server, from the request's
 *    country: local prices (set, not converted — `effectivePrice`) and local
 *    golf words, with a switch to US $ and US terms. The whole tree is built
 *    in US English and passed through the edition's word swaps (`inDialect`).
 *  - EVERY NUMBER IS READ, not typed: prices from PLANS through the owner's
 *    overrides, limits from PLANS, the feature count from the list, the two
 *    club platforms' prices from the one place they are held (`compare.tsx`).
 *  - EVERYTHING IS TEXT a reader and a crawler both get; the script
 *    (`LandingHomeEffects`) only moves what is already there.
 *  - THE SIGN-UP AND SIGN-IN FORM is on this page, once, at `#signup` /
 *    `#signin`, and it is how every organizer comes in.
 *
 * What it changes: one ground instead of a white page with dark bands; one
 * demo club in every picture (Braid Hollow, in Indiana) with other clubs only
 * in "Wherever you play"; the questions on /faq rather than in the scroll; and
 * only the two club platforms a buyer already knows named in the comparison.
 *
 * The rule for screens is in `home-styles.ts`: one you are meant to read is
 * shown whole, square and still; depth belongs to the decorative layers.
 */
export default async function LandingPage() {
  const session = await getSession();
  // Straight after sign-up there is no tournament yet, and the dashboard has
  // nothing to render without one — it would only bounce to /choose anyway.
  if (session) redirect(session.eventId ? landingScreenFor(session.viewRole) : "/choose");

  // The owner's price overrides, so the price here is the one the owner set on
  // the console — the same number the schema.org offer below quotes.
  const overrides = await storedPricingOverrides();
  const [h, jar] = await Promise.all([headers(), cookies()]);
  const { local, shown, overridden } = landingEdition(
    h.get("x-vercel-ip-country"),
    jar.get(US_OVERRIDE_COOKIE)?.value === "1",
  );
  const prices = landingPrices(shown, overrides);
  const note = editionNote(local, overridden);
  // UK-English editions only: the app follows the club's own conventions there
  // — the course's unit, the club's clock, and a Monday week.
  const groups = featureGroups({ localGolf: shown.register === "uk" });
  const total = featureCount(groups);

  // The two CLUB platforms, and only those (Ajay, 2026-10-11: name the rivals a
  // buyer already knows; nobody smaller is advertised from our own front door).
  const named = RIVALS.map((r, i) => ({ ...r, i })).filter((r) => r.kind === "Club platform");
  const rows = compareRows(prices);

  // What a year costs at each one's highest published plan, with its one-time
  // setup fee — the two figures each company prints, added. Ours beside them,
  // in the same dollars.
  const eagleYear = effectiveAnnualPrice(PLANS.club, overrides, "USD");
  const birdieYear = effectiveAnnualPrice(PLANS.society, overrides, "USD");
  const theirYear = (name: keyof typeof TOP_PUBLISHED) => TOP_PUBLISHED[name].year + TOP_PUBLISHED[name].setup;
  const bars = [
    { name: "Golf Genius", amount: theirYear("Golf Genius"), ours: false },
    { name: "BlueGolf", amount: theirYear("BlueGolf"), ours: false },
    { name: "TourneyHQ", amount: eagleYear, ours: true },
  ];
  const widest = Math.max(...bars.map((b) => b.amount));

  const mark = (m: NonNullable<Cell["mark"]>) => (
    <span className={`cx-m cx-${m}`} aria-hidden="true">{{ yes: "✓", part: "◐", no: "✕", na: "—" }[m]}</span>
  );
  const cell = (c: Cell) => (
    <>
      {c.value !== undefined ? <b>{c.value}</b> : null}
      {c.mark ? <>{mark(c.mark)}<span className="sr">{{ yes: "Yes", part: "Partly", no: "No", na: "Not listed" }[c.mark]}</span></> : null}
      {c.note ? <small>{c.note}</small> : null}
    </>
  );
  const doors = (
    <div className="m-cta-row">
      <a className="m-btn m-primary" href="#signup">Run an event <span className="m-arrow" aria-hidden="true">→</span></a>
      <a className="m-btn m-line" href="/play"><span className="m-long">I have a round code</span><span className="m-short">Enter a code</span></a>
    </div>
  );

  const page = (
    <div className="thq" lang={shown.locale} style={posterFontVars}>
      <style dangerouslySetInnerHTML={{ __html: LANDING_CSS }} />
      <style dangerouslySetInnerHTML={{ __html: HOME_CSS }} />
      {/* What this is, in schema.org terms — a product with a free tier and two
          paid ones, priced from PLANS in the visitor's currency. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(siteStructuredData({ origin: siteOrigin(), overrides, currency: shown.currency })),
        }}
      />
      <LandingEffects />
      <LandingHomeEffects />
      {iconSprite()}
      {landingNav("home")}

      <main id="top" className="m-home">
        <div className="m-progress" aria-hidden="true" />
        <div className="m-putter" id="putter" aria-hidden="true" />

        {/* ═══════════ THE FIRST SCREEN ═══════════ */}
        <section className="m-hero" aria-labelledby="hero-h">
          <div className="m-wrap">
            <div className="m-hero-grid">
              <div className="m-copy">
                <a className="m-news m-rise" href="#does"><b>New</b> Ryder-style cups, on every player&rsquo;s phone <span aria-hidden="true">→</span></a>
                <p className="m-eyebrow m-rise">Golf tournament &amp; league software</p>
                <h1 id="hero-h">
                  <span className="m-line"><span>From Registration</span></span>
                  <span className="m-line"><span>to <span className="m-hl" id="hero-word">Recognition.</span></span></span>
                  <svg className="m-putt" id="putt" viewBox="0 0 200 24" preserveAspectRatio="none" aria-hidden="true">
                    <path d="M2 14 C 55 0, 130 30, 190 12" />
                    <ellipse className="m-hole" cx="194" cy="13" rx="5" ry="2.6" />
                    <circle className="m-ball" r="4" />
                  </svg>
                </h1>
                <p className="m-sub m-rise m-d2"><span>Run the whole competition.</span> <span>Your players just type a code.</span></p>
                <div className="m-rise m-d3">{doors}</div>
                <ul className="m-facts3 m-rise m-d4">
                  <li>Free for fields of up to {PLANS.free.limits.playersPerEvent}</li>
                  <li>No card</li>
                  <li>No app for players</li>
                </ul>
              </div>

              <div className="m-hero-phone">
                <svg className="m-rings" viewBox="0 0 700 700" aria-hidden="true" preserveAspectRatio="none">
                  <ellipse cx="350" cy="350" rx="150" ry="205" />
                  <ellipse cx="356" cy="346" rx="205" ry="250" />
                  <ellipse cx="344" cy="356" rx="262" ry="292" />
                  <ellipse cx="352" cy="350" rx="318" ry="328" />
                </svg>
                {/* Decorative depth behind the phone: turned, so never read — the same screens are shown flat below. */}
                <div className="m-hero-desk m-decor" aria-hidden="true">
                  {plainShot({ name: "desk-leaderboard", alt: "", sizes: SIZES.heroDesk })}
                </div>
                <div className="m-toast" id="toast" aria-hidden="true" />
                <div className="m-chip" aria-hidden="true"><span className="m-dot" /><span><b>Live now</b> · 40 of 40 cards in</span></div>
                <div className="m-phone m-back m-left m-decor" aria-hidden="true">
                  {plainShot({ name: "club-today", alt: "", sizes: SIZES.heroPhone })}
                </div>
                <div className="m-phone">
                  <div className="m-loop" id="loop" role="img" aria-label="A player's phone: the live board, and a score going in on their card.">
                    {plainShot({ name: "club-board", alt: "", sizes: SIZES.heroPhone, className: "m-on", priority: true })}
                    {plainShot({ name: "club-card", alt: "", sizes: SIZES.heroPhone })}
                  </div>
                </div>
              </div>

              <div className="m-tryline m-rise m-d5">
                <label htmlFor="hero-code"><b>See what a player sees.</b> Type the demo code.</label>
                <div className="m-field">
                  <input id="hero-code" type="text" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={9} placeholder="Round code" aria-describedby="hero-code-say" />
                  <span className="m-hint">Try K7M4-PQ2X</span>
                </div>
                <span className="m-say" id="hero-code-say" role="status" />
                <span className="m-realcode">Playing today? <a href="/play">Enter your round code</a></span>
              </div>
            </div>
          </div>

          <div className="m-ticker" role="group" aria-label="The demo club's board, as a live strip">
            <div className="m-row">
              <span className="m-live"><span className="m-dot" aria-hidden="true" />Live · demo club</span>
              <div className="m-track" id="ticker-track" data-no-dialect="">
                <span><b>October Stroke Play</b> · Round 1</span>
                {TICKER.map(([pos, name, thru, score]) => (
                  <span key={name}>{pos} <b>{name}</b> {thru} <i>{score}</i></span>
                ))}
              </div>
            </div>
          </div>

          <div className="m-wrap">
            <div className="m-proof">
              <ul>
                <li><b>A live board by link</b><span>Anyone can watch; nobody signs in</span></li>
                <li><b>Works without signal</b><span>Cards save and send later</span></li>
                <li><b>Scores by voice</b><span>Say the hole, or the whole card</span></li>
                <li><b>{FORMAT_NAMES.length} formats</b><span>Each scored by its own rules</span></li>
              </ul>
            </div>
          </div>
        </section>

        {/* ═══════════ HOW IT WORKS ═══════════ */}
        <section className="m-chapter" id="round" aria-labelledby="round-h">
          <div className="m-wrap">
            <div className="m-head">
              <p className="m-eyebrow">How it works</p>
              <h2 id="round-h">One competition, from the first entry to the prize table.</h2>
              <p className="m-lead">An example week at our demo club. Every screen is the app itself, on invented players.</p>
            </div>

            <div className="m-times" role="tablist" aria-label="The week, by time">
              {WEEK.map((m, i) => (
                <button type="button" role="tab" aria-selected={i === 0} key={m.when}><b>{m.when}</b><span>{m.tab}</span></button>
              ))}
            </div>

            <div className="m-story" id="story">
              <div className="m-pin">
                <div className="m-stage">
                  <div className="m-phone">
                    {WEEK.map((m, i) => (
                      <Fragment key={m.when}>{plainShot({ name: m.shot, alt: m.alt, sizes: SIZES.story, className: i === 0 ? "m-on" : "" })}</Fragment>
                    ))}
                  </div>
                </div>
                <div className="m-beats">
                  <div className="m-rail" id="rail" aria-hidden="true"><span className="m-flag" /><span className="m-cup" /><span className="m-ball" /></div>
                  {WEEK.map((m, i) => (
                    <div className={i === 0 ? "m-beat m-on" : "m-beat"} key={m.when}>
                      <span className="m-what">{m.tab} · {m.who}</span>
                      <span className="m-clock">{m.when}</span>
                      <h3>{m.h}</h3>
                      <p>{m.p}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* The same week as a row of cards: what a narrow screen shows when the page's script has not run. */}
            <div id="steps" aria-hidden="true">
              {WEEK.map((m) => (
                <div className="m-step" key={m.when}>
                  <div className="m-phone">{plainShot({ name: m.shot, alt: "", sizes: SIZES.step })}</div>
                  <div className="m-say">
                    <span className="m-what">{m.tab} · {m.who}</span>
                    <span className="m-clock">{m.when}</span>
                    <b>{m.h}</b>
                    <p>{m.p}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ═══════════ ONE MOMENT ═══════════ */}
        <section className="m-moment" aria-label="What a live board means">
          <div className="m-wall m-decor" aria-hidden="true">
            {WALL.map((col) => (
              <div className="m-col" key={col[0]}>
                {[...col, ...col].map((name, i) => <Fragment key={`${name}-${i}`}>{thumbShot(name, 420)}</Fragment>)}
              </div>
            ))}
          </div>
          <div className="m-wrap">
            <div className="m-grid">
              <p className="m-big"><span className="m-time" id="moment-time">11:42.</span> <span className="m-l1">A birdie on the 14th.</span> <span className="m-hl m-l2">The whole club sees it.</span></p>
              <p className="m-aside">Every card moves the board the moment it is saved. On the phone in a member&rsquo;s hand, on the laptop in the office, on the television in the bar.</p>
            </div>
          </div>
        </section>

        {/* ═══════════ WHAT IT DOES ═══════════ */}
        <section className="m-chapter" id="does" aria-labelledby="does-h">
          <div className="m-wrap">
            <div className="m-head">
              <p className="m-eyebrow">What it does</p>
              <h2 id="does-h">The whole day, in one place.</h2>
              <ul className="m-runs" aria-label="What it runs" data-no-dialect="">
                {["Weekly leagues", "Society days", "Club championships", "Knockouts", "Ryder-style cups", "Member-guests", "Charity scrambles", "Golf trips", "A Saturday fourball"].map((x) => <li key={x}><b>{x}</b></li>)}
              </ul>
            </div>

            <div className="m-wide">
              <div className="m-line">
                <h3>The committee on a laptop. The field on their phones.</h3>
                <p>Registration, flights, the draw, the tee sheet and the cut from one screen, in your club&rsquo;s colors.</p>
              </div>
              <div className="m-screen">
                {plainShot({ name: "desk-dashboard", alt: "The organizer's dashboard during a round: what needs a decision, the tee sheet, and the pace of play group by group.", sizes: SIZES.desk })}
                <div className="m-spots" id="spots" aria-hidden="true">
                  <span className="m-spot m-on" style={{ left: "50%", top: "18.5%" }}><i /><b>What needs you, first</b></span>
                  <span className="m-spot" style={{ left: "47%", top: "41.5%" }}><i /><b>The tee sheet, one tap away</b></span>
                  <span className="m-spot" style={{ left: "63%", top: "60%" }}><i /><b>Pace of play, group by group</b></span>
                  <span className="m-spot" style={{ left: "17.6%", top: "52%" }}><i /><b>Every part of the setup</b></span>
                </div>
              </div>
              <div className="m-twin m-phone">
                {plainShot({ name: "org-teesheet", alt: "The organizer's tee sheet on a phone: pairing requests, and the draw as published to players.", sizes: SIZES.twin })}
              </div>
            </div>

            <div className="m-cards m-leaf">
              <div className="m-card">
                <h3>Nothing counts until you say so.</h3>
                <p>Cards are certified, approved or disputed. A result from the course waits for you.</p>
                <div className="m-peek"><div className="m-phone">{plainShot({ name: "org-dashboard", alt: "The organizer's dashboard on a phone: one disputed result to settle and one card to approve.", sizes: SIZES.peek })}</div></div>
              </div>
              <div className="m-card">
                <h3>Sixteen formats, one leaderboard.</h3>
                <p>Stroke play to Stableford, match play to scramble, skins and Nassau. All on every plan.</p>
                <div className="m-peek"><div className="m-phone">{plainShot({ name: "public-stableford", alt: "A live public board ranked by Stableford points.", sizes: SIZES.peek })}</div></div>
              </div>
              <div className="m-card">
                <h3>Works out the money. <span className="m-hl">Never holds it.</span></h3>
                <p>Skins, pots, prizes and trip costs, worked out from the cards. Nothing is collected or moved.</p>
                <div className="m-peek"><div className="m-phone">{plainShot({ name: "club-money", alt: "A player's Money screen: what they are owed, and who pays whom to settle it.", sizes: SIZES.peek })}</div></div>
              </div>
            </div>

            {/* A FIELD TOO BIG FOR ONE BRACKET (2026-10-12; Ajay: the website should show a 128-player
                knockout). The same block as the dashboard above — a laptop where there is room for one,
                the phone where there is not — so it needs no styling of its own. The screens are the
                app's: a match play of 128 divided by handicap into eight flights of sixteen. */}
            <div className="m-wide" style={{ marginTop: "clamp(44px, 6vw, 76px)" }}>
              <div className="m-line">
                <h3>128 in the match play? Eight flights, eight champions.</h3>
                <p>Divide a big field by handicap, by your own flights or at random. Each flight is its own knockout, and every player is told who they play.</p>
              </div>
              <div className="m-screen">
                {plainShot({ name: "desk-matchplay", alt: "The organizer's bracket screen for a match play of 128: eight flights of sixteen divided by handicap, and the Championship flight's draw with its first results.", sizes: SIZES.desk })}
              </div>
              <div className="m-twin m-phone">
                {plainShot({ name: "public-matchplay", alt: "The same draw on a phone, open to anyone with the link: the Championship flight's round of sixteen.", sizes: SIZES.twin })}
              </div>
            </div>

            <div className="m-colours">
              <div className="m-text">
                <h3>Your club&rsquo;s colors, on every screen.</h3>
                <p>Choose a theme once and every screen wears it: the organizer&rsquo;s, the public board, every player&rsquo;s phone. Here is one board in four of them at once, two light and two dark, each checked for how it reads in full sun.</p>
                <p className="m-drag"><span className="m-arrows" aria-hidden="true">←→</span> Drag across the board.</p>
                <ul className="m-schemes" aria-label="The four themes shown, left to right" data-no-dialect="">
                  {THEMES.map((t) => <li key={t.name}><span className="m-dot" style={{ background: t.swatch }} />{t.name}</li>)}
                </ul>
              </div>
              <div className="m-pic">
                <div className="m-phone m-compare" id="themes">
                  {THEMES.map((t, i) => (
                    <Fragment key={t.shot}>
                      {plainShot({
                        name: t.shot, sizes: SIZES.themes, className: "m-band",
                        alt: i === 0 ? "One board shown in four club themes side by side: Tournament and Coastal in light, Championship and Midnight in dark." : "",
                      })}
                    </Fragment>
                  ))}
                  <span className="m-handle" aria-hidden="true" />
                  <span className="m-handle" aria-hidden="true"><span className="m-knob">↔</span></span>
                  <span className="m-handle" aria-hidden="true" />
                  <span className="m-hues" id="hues" aria-hidden="true">{THEMES.map((t) => <i key={t.shot} style={{ background: t.swatch }} />)}</span>
                  <input id="themes-range" type="range" min={0} max={100} step={0.5} defaultValue={50} aria-label="Drag to move the bands of color" />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════ WHEREVER YOU PLAY ═══════════ */}
        <section className="m-chapter" id="world" aria-labelledby="world-h">
          <div className="m-wrap">
            <div className="m-head">
              <p className="m-eyebrow">Wherever you play</p>
              <h2 id="world-h">Your club&rsquo;s money. Your country&rsquo;s golf.</h2>
              <p className="m-lead">Every figure in your club&rsquo;s own currency, written the way your country writes it. Dates, the week and the golf words follow.</p>
            </div>
            <div className="m-world" id="world-row">
              {WORLD.map((w, i) => (
                <figure className="m-wphone" key={w.place} style={{ "--m-i": i } as React.CSSProperties}>
                  <div className="m-phone">{plainShot({ name: w.shot, alt: w.alt, sizes: SIZES.world })}</div>
                  <span className="m-coin" aria-hidden="true">{w.symbol}</span>
                  <figcaption><b>{w.place}</b><span>{w.money}</span></figcaption>
                </figure>
              ))}
            </div>
            <ul className="m-runs m-world-also" aria-label="Also" data-no-dialect="">
              {["Canadian dollars", "Australian dollars", "New Zealand dollars", "Yen", "Yards or metres", "Carts or buggies", "A Sunday or a Monday week"].map((x) => <li key={x}>{x}</li>)}
            </ul>
          </div>
        </section>

        {/* ═══════════ PRICING ═══════════
            Read from PLANS through the owner's overrides, in the visitor's
            currency, so the page cannot promise a price or a limit the code
            does not hold. */}
        <section className="m-chapter m-leaf m-leaf-ground" id="pricing" aria-labelledby="pricing-h">
          <div className="m-wrap">
            <div className="m-head">
              <p className="m-eyebrow">Pricing</p>
              <h2 id="pricing-h">Priced on your field. Never per player.</h2>
            </div>
            <div className="m-plans">
              <div className="m-plan">
                <p className="m-who">{PLANS.free.tagline}</p>
                <h3>{PLANS.free.name}</h3>
                <div className="m-price">{prices.zero}</div>
                <p className="m-year">Free for good</p>
                <a className="m-btn m-line" href="#signup">Start free</a>
                <ul>
                  <li>Up to {PLANS.free.limits.playersPerEvent} players</li>
                  <li>One tournament at a time</li>
                  <li>Every format, the live board, side games</li>
                </ul>
                <p className="m-term">{retentionNotice("free")}</p>
              </div>
              <div className="m-plan m-pick lightband">
                <p className="m-who">{PLANS.society.tagline}</p>
                <h3>{PLANS.society.name}</h3>
                <div className="m-price">{prices.society.monthly}<small>a month</small></div>
                <p className="m-year">or {prices.society.yearly} a year</p>
                <a className="m-btn" href="#signup">Choose {PLANS.society.name}</a>
                <ul>
                  <li>Up to {PLANS.society.limits.playersPerEvent} players in a field</li>
                  <li>As many events as your season runs</li>
                  <li>A season table, and {retentionSummary(PLANS.society)}</li>
                </ul>
              </div>
              <div className="m-plan">
                <p className="m-who">{PLANS.club.tagline}</p>
                <h3>{PLANS.club.name}</h3>
                <div className="m-price">{prices.club.monthly}<small>a month</small></div>
                <p className="m-year">or {prices.club.yearly} a year</p>
                <a className="m-btn m-line" href="#signup">Choose {PLANS.club.name}</a>
                <ul>
                  <li>Any size of field</li>
                  <li>Up to {PLANS.club.limits.staffSeats} organizers and assistants</li>
                  <li>Your club&rsquo;s branding, ours removed</li>
                </ul>
              </div>
            </div>
            <p className="m-small">Paid plans are arranged with us directly: create your account and we move it to the plan. Nothing is charged through the app. {note}</p>

            <div className="m-versus">
              <div className="m-say">
                <h3>A year on the top plan, elsewhere.</h3>
                <p>Each company&rsquo;s highest published plan for one club, with its one-time setup fee, beside ours with none. A league of up to {PLANS.society.limits.playersPerEvent} runs on {PLANS.society.name} for {prices.usd(birdieYear)}.</p>
                <p><a href="#compare">See the like-for-like comparison</a></p>
              </div>
              <ul className="m-bars" aria-label="A year on each company's highest published plan, setup fee included" data-no-dialect="">
                {bars.map((b) => (
                  <li className={b.ours ? "m-us" : undefined} key={b.name}>
                    <span>{b.name}</span>
                    <span className="m-track"><span className="m-fill" style={{ width: `${((b.amount / widest) * 100).toFixed(1)}%` }} /></span>
                    <span className="m-amount" data-to={b.amount}>{prices.usd(b.amount)}</span>
                  </li>
                ))}
                <li className="m-saved">
                  {bars.filter((b) => !b.ours).map((b) => (
                    <div key={b.name}><b>{prices.usd(b.amount - eagleYear)}</b><span>less than {b.name}</span></div>
                  ))}
                </li>
              </ul>
            </div>
            <p className="m-small">
              Golf Genius and BlueGolf prices are from each company&rsquo;s own website as of {PRICES_READ_ON}, in US dollars before tax, for
              one facility in the US or Canada with up to 36 holes. Prices change, so check with each provider. Both are trademarks of their
              owners; TourneyHQ is not affiliated with or endorsed by either.
              {contactEmail ? <> Several clubs, or a corporate golf program? {PLANS.enterprise.name} is scoped with you: write to <a href={`mailto:${SALES_EMAIL}`}>{SALES_EMAIL}</a>.</> : null}
            </p>

            <p className="m-soon" data-no-dialect="">
              <b>Coming</b>
              <span>GHIN and WHS handicap services</span>
              <span>The iPhone app in the App Store</span>
              <span>The Android app on Google Play</span>
            </p>

            <div className="m-more">
              <details id="plans">
                <summary><span>Compare the plans <small>what changes from one to the next</small></span></summary>
                <div className="m-in">
                  <div className="cp">
                    <table className="cp-t">
                      <caption className="sr">What differs between TourneyHQ&rsquo;s plans</caption>
                      <thead>
                        <tr>
                          <th scope="col"><span className="sr">Plan</span></th>
                          {PLAN_KEYS.map((k) => <th scope="col" key={k} className={k === "society" ? "hot" : undefined}>{PLANS[k].name}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {planDiff(prices).map(([label, cells]) => (
                          <tr key={label}>
                            <th scope="row">{label}</th>
                            {cells.map((c, i) => <td key={PLAN_KEYS[i]} className={PLAN_KEYS[i] === "society" ? "hot" : undefined}>{c}</td>)}
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={4}>
                            <b>Everything else is on every plan, {PLANS.free.name} included</b> — live scoring, voice, round codes, every
                            format, the golf money, the calendar and leagues. <a href="#all-features">See every feature {icon("arrow", "i")}</a>
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  <p className="metered">
                    Text alerts, reading a photographed card and drafted commentary are built and not switched on for
                    anybody yet — they cost per message and per call, so they will come with {PLANS.club.name} first, once
                    they&rsquo;re worth billing for.
                  </p>
                </div>
              </details>

              {/* The named comparison: every cell and its source live in
                  lib/landing/compare.tsx — read the rules there before changing it. */}
              <details id="compare">
                <summary><span>TourneyHQ beside the two club platforms <small>from their own websites</small></span></summary>
                <div className="m-in">
                  <div className="vs">
                    <div className="cx-scroll" tabIndex={0} role="region" aria-label="TourneyHQ beside two club platforms">
                      <table className="cx">
                        <caption className="sr">TourneyHQ beside {named.map((r) => r.name).join(" and ")}</caption>
                        <thead>
                          <tr>
                            <th className="cx-lab" scope="col"><span className="sr">Feature</span></th>
                            <th className="cx-us" scope="col"><b>TourneyHQ</b><span>{PLANS.free.name} · {PLANS.society.name} · {PLANS.club.name}</span></th>
                            {named.map((r) => <th scope="col" key={r.name}><b>{r.name}</b><span>{r.kind}</span></th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((row) => (
                            <tr key={row.label}>
                              <th className="cx-lab" scope="row">{row.label}<small>{row.detail}</small></th>
                              <td className="cx-us">{cell(row.ours)}</td>
                              {named.map((r) => <td key={r.name}>{cell(row.theirs[r.i])}</td>)}
                            </tr>
                          ))}
                          <tr className="cx-src">
                            <th className="cx-lab" scope="row">Source</th>
                            <td className="cx-us">This page</td>
                            {named.map((r) => (
                              <td key={r.name}><a href={r.source.href} rel="nofollow noopener noreferrer" target="_blank">{r.source.label}</a></td>
                            ))}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <p className="cx-key">
                      <span>{mark("yes")} Yes</span><span>{mark("part")} Partly, or on some plans</span>
                      <span>{mark("no")} No</span><span>{mark("na")} Not listed on their website</span>
                    </p>
                    <p className="vs-legal">
                      Competitor information is from each company&rsquo;s own website as of {COMPARED_ON}. Golf Genius and
                      BlueGolf prices are for facilities in the US and Canada with up to 36 holes, in US dollars, before
                      tax. &ldquo;Not listed&rdquo; means their website does not say so, not that the feature is missing.
                      Prices and features change, so check with each provider. Golf Genius and BlueGolf are trademarks of
                      their respective owners. TourneyHQ is not affiliated with or endorsed by either of them.
                    </p>
                  </div>
                </div>
              </details>

              {/* Every line, all of it rendered; filtered by chips (CSS) and a search box (a small client script). */}
              <details id="features">
                <summary><span>Every feature <small>{total}, all live today</small></span></summary>
                <div className="m-in">
                  <div className="fx" id="all-features">
                    <div className="fx-bar">
                      <div role="radiogroup" aria-label="Show features" style={{ display: "contents" }}>
                        {[
                          ["top", "Highlights", 12],
                          ["all", "All", total],
                          ...groups.map((g) => [g.key, g.title, g.items.length] as const),
                        ].map(([k, label, n], i) => (
                          <label className="chip" key={k}>
                            <input className="sr" type="radio" name="fx" value={k} defaultChecked={i === 0} />
                            {label}<i>{n}</i>
                          </label>
                        ))}
                      </div>
                      <FeatureSearch total={total} />
                    </div>
                    <div className="fx-grid">
                      {groups.flatMap((g) =>
                        g.items.map((f) => (
                          <div className={f.top ? "f top" : "f"} data-g={g.key} key={`${g.key}-${f.t}`}>
                            <small>{g.title}</small>
                            <b>{f.t}</b>
                            {f.s ? <span>{f.s}</span> : null}
                          </div>
                        )),
                      )}
                    </div>
                    <p className="fx-none">No feature matches that. Try another word, or <Link href="/faq">search the questions</Link>.</p>
                  </div>
                </div>
              </details>
            </div>
          </div>
        </section>

        {/* ═══════════ THE WHOLE COMPETITION, IN ORDER ═══════════ */}
        <div className="m-kinetic">
          <div className="m-path">
            <p className="m-eyebrow">The whole competition, in order</p>
            <ol>
              {WEEK.map((m, i) => <li className={i === 0 || i === WEEK.length - 1 ? "m-end" : undefined} key={m.tab}><span>{m.tab}</span></li>)}
            </ol>
          </div>
          <div className="m-run" id="kinetic-run" aria-hidden="true">
            {[0, 1, 2, 3].map((n) => <span key={n}>From Registration to <b>Recognition.</b></span>)}
          </div>
          <div className="m-run m-back" id="kinetic-back" aria-hidden="true">
            {[0, 1, 2].map((n) => <span key={n}>{WEEK.map((m) => <Fragment key={m.tab}>{m.tab} <i>·</i> </Fragment>)}</span>)}
          </div>
        </div>

        {/* ═══════════ SIGN UP / SIGN IN ═══════════ */}
        <section className="m-chapter" id="start" aria-labelledby="start-h" style={{ paddingTop: 0 }}>
          <div className="m-wrap">
            <div className="m-close">
              <span className="anchor" id="signup" aria-hidden="true" />
              <span className="anchor" id="signin" aria-hidden="true" />
              <svg className="m-rings" viewBox="0 0 700 700" aria-hidden="true">
                <ellipse cx="350" cy="350" rx="96" ry="96" />
                <ellipse cx="350" cy="350" rx="170" ry="170" />
                <ellipse cx="350" cy="350" rx="248" ry="248" />
                <ellipse cx="350" cy="350" rx="330" ry="330" />
              </svg>
              <svg className="m-pin" viewBox="0 0 210 230" aria-hidden="true">
                <ellipse className="m-cupline" cx="105" cy="196" rx="52" ry="11" />
                <line x1="105" y1="196" x2="105" y2="34" />
                <path className="m-cloth" d="M105 36 L170 56 L105 78 Z" />
              </svg>
              <div className="m-close-copy">
              <h2 id="start-h">Run your first event.</h2>
              <p className="m-lead">
                A name is enough to start. No card, and with round codes on your players don&rsquo;t need an account.
                Organizers create an event here; players invited to one sign in with the same box.
              </p>
              </div>
              <div className="authpanel m-auth">
                <LandingAuth defaultMode="signup" organizers={golfTermsFor(shown.register).organizers} />
              </div>
              <div className="m-close-more">
              <div className="m-stores">
                {storeButton("ios", STORE_LINKS.ios)}
                {storeButton("android", STORE_LINKS.android)}
              </div>
              <p className="m-stores-note">
                Until then it installs straight from the browser on iPhone and Android: add it to your home screen
                and it opens in its own window, like an app. {FAQ_COUNT} questions are answered on <Link href="/faq">the questions page</Link>.
              </p>
              </div>
            </div>
          </div>
        </section>

        {/* The two doors, within reach on a phone once the first screen's have scrolled away. */}
        <div className="m-dock" id="dock">
          <a className="m-btn m-primary" href="#signup">Run an event</a>
          <a className="m-btn m-line" href="/play">Enter a code</a>
        </div>
      </main>

      {landingFooter("home", note)}
    </div>
  );

  return inDialect(page, editionSwaps(shown));
}

/**
 * An app-store button. With a live listing it links there; until then it reads
 * "Coming soon" and opens the FAQ answer on installing from the browser today,
 * so a tap always goes somewhere true.
 */
function storeButton(store: "ios" | "android", url: string) {
  const live = Boolean(url);
  const [lead, name, ic] =
    store === "ios"
      ? [live ? "Download on the" : "Coming soon to the", "App Store", "apple-phone"]
      : [live ? "Get it on" : "Coming soon on", "Google Play", "android-phone"];
  const inner = (
    <>
      {icon(ic)}
      <span><small>{lead}</small><b>{name}</b></span>
    </>
  );
  return live ? (
    <a className="store" href={url} rel="noopener">{inner}</a>
  ) : (
    <Link className="store soon" href="/faq#q-stores" aria-label={`${lead} ${name}. How to install it from your browser today`}>{inner}</Link>
  );
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
