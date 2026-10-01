import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { landingScreenFor } from "@/lib/roles";
import { PLANS, phoneRequiredFor, retentionNotice, retentionSummary, type PlanKey } from "@/lib/plans";
import { storedPricingOverrides } from "@/lib/services/platform-pricing";
import { siteStructuredData } from "@/lib/domain/structured-data";
import { siteOrigin } from "@/lib/site";
import { editionSwaps, landingEdition, US_OVERRIDE_COOKIE } from "@/lib/landing/edition";
import { inDialect } from "@/lib/landing/dialect";
import { golfTermsFor } from "@/lib/domain/golf-terms";
import { landingPrices, type LandingPrices } from "@/lib/landing/pricing";
import { FAQ_COUNT, FORMAT_NAMES, LANDING_FAQ_IDS, faqItem } from "@/lib/landing/faq";
import { featureCount, featureGroups } from "@/lib/landing/features";
import { COMPARE_APPEARANCE, COMPARE_COLOURS, LANDING_CSS } from "@/lib/landing/styles";
import { COMPARED_ON, RIVALS, compareRows, goFurther, type Cell } from "@/lib/landing/compare";
import { LandingAuth } from "@/components/LandingAuth";
import { LandingEffects } from "@/components/LandingEffects";
import { FeatureSearch } from "@/components/landing/FeatureSearch";
import { contactEmail, editionNote, icon, iconSprite, landingFooter, landingNav } from "@/components/landing/chrome";
import { fixedShot, lightShot, shotSrc } from "@/components/landing/shots";

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
    ["Players' mobile numbers", each((k) => (phoneRequiredFor(k, false) ? "Always asked" : <>Your choice<small>per tournament</small></>))],
    ["Order of merit across events", each((k) => has(PLANS[k].features.seasonStandings))],
    ["The honors board", each((k) => has(PLANS[k].features.honours))],
    ["Your club's branding in place of ours", each((k) => has(PLANS[k].features.whiteLabel, "with your logo"))],
  ];
}

/** A screen by name: an edition's capture ("d"), the club's currency ("cur"), or one file for everyone. */
type Screen = { name: string; by: "d" | "cur" | "one"; w: number; h: number };
const PHONE = { w: 600, h: 1298 };

/**
 * "One Saturday, both sides" — the organizer's day and the players', in the
 * order it happens. Each moment is a real screen, captured unedited from the
 * demo club; every sentence is what that screen does (TourneyHQv2 checked the
 * calendar, the attendance → field → tee sheet path, and the knockout report
 * flow against the code, 2026-09-28/29).
 */
const DAY: Array<{ time: string; who: "org" | "pl"; h: string; p: string; ul?: string[]; screen: Screen; cap: string; alt: string }> = [
  {
    time: "06:30", who: "org", h: "The tee sheet is drawn from who's in.",
    p: "Groups by handicap, standings or sides — then yours to adjust. Publish it, and the day is set.",
    ul: ["One tee, split tees or a shotgun", "Opt in, opt out, or captains send the list", "Pairing requests kept together — not on a draw by position"],
    screen: { name: "day-teesheet", by: "d", ...PHONE }, cap: "Organizer · the tee sheet",
    alt: "The organizer's tee sheet: two pairing requests above the published draw, and the pair who asked together in Group 1, off hole 1 at 08:10.",
  },
  {
    time: "06:31", who: "pl", h: "Every player has their tee time.",
    p: "On their Today screen: the round, the group, where they stand, and the club's pinned notice. Pushed to their phone if they've turned notifications on.",
    screen: { name: "phone-today", by: "d", ...PHONE }, cap: "Player · Today",
    alt: "A player's Today screen: the round, a pinned notice about preferred lies, their card so far and the leaders.",
  },
  {
    time: "08:10", who: "pl", h: "Eight characters, and they're on their card.",
    p: "A round code — no account, no app store, nothing to install.",
    screen: { name: "day-code", by: "one", ...PHONE }, cap: "Player · a round code",
    alt: "Enter your score: a box for the round code the organizer gave out.",
  },
  {
    time: "08:14", who: "pl", h: "Tap the score — or say it.",
    p: "“Four”, “par”, “bogey” — or the whole card read out in one go. It keeps saving without signal.",
    ul: ["Gross and net per hole, with the stroke dot", "One phone can keep the card for the group"],
    screen: { name: "phone-hole", by: "d", ...PHONE }, cap: "Player · My card",
    alt: "My card, by hole: hole 12, par 3, score buttons from Ace to +3 and a microphone to say it.",
  },
  {
    time: "11:42", who: "pl", h: "Their own line first on the board.",
    p: "Where they stand as every card comes in — and the column says whether it's strokes, points or match play.",
    screen: { name: "phone-board", by: "d", ...PHONE }, cap: "Player · the board",
    alt: "The player's Board: their own position first, then the field ranked by net strokes.",
  },
  {
    time: "12:30", who: "org", h: "A knockout result comes in from the course.",
    p: "The player reports it on their phone. Nothing moves on the draw until you approve it — or turn it down.",
    screen: { name: "day-approve", by: "d", ...PHONE }, cap: "Organizer · a result to approve",
    alt: "A result to approve: Gordon Pyle reports he won his semifinal 3&2, with Approve and Turn down.",
  },
  {
    time: "14:00", who: "pl", h: "Everyone knows what they're owed.",
    p: "Skins, pots and the shared costs in one settle-up — the fewest handovers.",
    screen: { name: "phone-money", by: "cur", ...PHONE }, cap: "Player · Money",
    alt: "A player's Money screen: what they're owed, and the fewest handovers that make everyone square.",
  },
];

/** The showcase: the rest of the app, by tab — none of these screens appears anywhere else on the page. */
/* A desk capture shrunk to a phone is ~4px text, so a desk item can carry a
   twin: the same page captured at phone width, shown at 700px and below. */
/**
 * The showcase: one real phone screen per tab, staged. Each screen carries
 * three notes that name what THAT screen shows, and a pin beside the phone,
 * level with it (`y`, % down the screen). The pins sit outside the screen:
 * the capture itself is untouched (Ajay, 2026-09-29: "rich", "innovative").
 */
type Note = { t: string; s: string; y: number };
const SHOWCASE: Array<{ key: string; side: "org" | "pl"; title: string; sub: string; screen: Screen; alt: string; notes: Note[] }> = [
  { key: "cup", side: "org", title: "Team cup", sub: "Sessions of matches, one score", screen: { name: "cup-org-phone", by: "d", ...PHONE },
    alt: "The team cup on the organizer's phone: Blues 1½, Whites 1½, what each side needs, and the four-balls as they stand.",
    notes: [
      { t: "The score, as it stands", s: "A point a match, half a point for a halve.", y: 45 },
      { t: "What each side needs", s: "Worked out as each result comes in.", y: 59 },
      { t: "Every match, as it stands", s: "Four-balls, foursomes and singles — 2&1, all square.", y: 77 },
    ] },
  { key: "week", side: "org", title: "League week", sub: "Who's returned a card", screen: { name: "day-week", by: "d", ...PHONE },
    alt: "A league week: the night's Stableford results, with 17 of 20 cards returned and three still to come.",
    notes: [
      { t: "Week by week", s: "Every night of the league, a tap apart.", y: 27 },
      { t: "Who's returned a card", s: "And how many are still to come.", y: 52 },
      { t: "The night's results", s: "Points and gross, as the cards come in.", y: 70 },
    ] },
  { key: "calendar", side: "pl", title: "Their calendar", sub: "In or Out for league weeks", screen: { name: "day-calendar", by: "d", ...PHONE },
    alt: "A member's calendar: the month's league rounds, each with an In / Out switch.",
    notes: [
      { t: "Every round they're in", s: "Marked Playing, in date order.", y: 12 },
      { t: "The month at a glance", s: "A dot on each day they play.", y: 45 },
      { t: "In or Out, in a tap", s: "For each league week ahead.", y: 80 },
    ] },
  { key: "events", side: "pl", title: "Events", sub: "Enter in a tap", screen: { name: "panel-casual-events", by: "d", ...PHONE },
    alt: "The player's Events screen, starting with Play a casual round — just you and your group — and the club's events.",
    notes: [
      { t: "A casual round", s: "Just you and your group — no tournament needed.", y: 31 },
      { t: "Their calendar, one tap away", s: "Every round they're in, on its day.", y: 42 },
      { t: "Every club event", s: "Entered, or entered in a tap.", y: 80 },
    ] },
];

/** The formats: [capture, format, how it is set up, alt]. Captions are the seed's own setup. */
const FORMAT_BOARDS = [
  ["fmt-champs", "Stroke play, gross", "36 holes, cut to the top 16 after round one", "A final public board ranked by gross strokes after two rounds."],
  ["fmt-twilight", "Stableford, net", "Nine holes at 95% allowance, live", "A live public board ranked by Stableford points."],
  ["fmt-fourball", "Foursomes, net", "Alternate shot in pairs, 50% allowance", "A live pairs board: sides, their handicaps, holes played and gross, lowest net wins."],
] as const;

const APPEARANCE_LABEL: Record<(typeof COMPARE_APPEARANCE)[number], string> = {
  card: "My card",
};

const COLOUR_LABEL: Record<(typeof COMPARE_COLOURS)[number], readonly [string, string]> = {
  championship: ["Championship", "claret & gold"],
  coastal: ["Coastal", "links blue & sand"],
  azalea: ["Azalea Week", "hot pink & sand"],
};

/**
 * THE FRONT DOOR — redesigned 2026-09-29 in the direction Ajay chose: the
 * "Swiss poster" page (warm white, big type, one bold colour) with an
 * interactive showcase of the real app.
 *
 * What it is made of, and where each part comes from:
 *  - EVERY PRODUCT IMAGE IS A REAL SCREEN of the app, captured unedited from a
 *    production build running the invented demo club. Nothing is drawn.
 *  - THE VISITOR'S EDITION is decided here, on the server, from the request's
 *    country: local prices (set, not converted — `effectivePrice`) and local
 *    golf words (`golf-terms.ts`), with a switch to US $ and US terms.
 *  - EVERY NUMBER IS READ, not typed: prices from PLANS through the owner's
 *    overrides, limits and seats from PLANS, the feature count from the list.
 *  - EVERYTHING IS TEXT a reader and a crawler both get: the whole feature
 *    list, the comparison and the answers are rendered on the server; the
 *    tabs, filters and slider only choose what is shown.
 *
 * The whole tree is built once in US English and then passed through the
 * edition's word swaps (`inDialect`), so a British visitor's page arrives
 * saying "buggy" and "organiser" rather than flashing the US words first.
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
  const d = shown.shots;
  const cur = shown.currency.toLowerCase();
  const ctx = { prices, email: contactEmail };
  const rows = compareRows(prices);
  const note = editionNote(local, overridden);
  // UK-English editions only: the app follows the club's own conventions there
  // — the course's unit, the club's clock, and a Monday week.
  const groups = featureGroups({ localGolf: shown.register === "uk" });
  const total = featureCount(groups);

  const screen = (s: Screen, alt: string, className = "", priority = false) =>
    s.by === "one"
      ? fixedShot(`/landing/${s.name}.webp`, s.w, s.h, alt, className)
      : lightShot({ name: s.name, variant: s.by === "cur" ? cur : d, width: s.w, height: s.h, alt, className, priority });
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
  const tick = (text: React.ReactNode) => (
    <li>
      {icon("check")}
      <span>{text}</span>
    </li>
  );

  const page = (
    <div className="thq" lang={shown.locale}>
      <style dangerouslySetInnerHTML={{ __html: LANDING_CSS }} />
      {/* What this is, in schema.org terms — a product with a free tier and two
          paid ones, priced from PLANS in the visitor's currency. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(siteStructuredData({ origin: siteOrigin(), overrides, currency: shown.currency })),
        }}
      />
      <LandingEffects />
      {iconSprite()}
      {landingNav("home")}

      <main id="top">
        {/* ═══════════ HERO ═══════════ */}
        {/* The one bold moment (Ajay, 2026-09-29: "go ahead" with a black hero
            on a white page): the hero is a dark band, so the product screens
            are framed on black and everything below reads on white. */}
        <section className="hero band" aria-labelledby="hero-h">
          <div className="wrap">
            <span className="label kicker">Golf tournament &amp; league management</span>
            <div className="hero-top">
              <h1 className="h1" id="hero-h">From registration<br />to <span className="o">recognition.</span></h1>
              <div className="hero-side">
                <p>
                  The club championship, the Thursday league and the Saturday foursome — the draw, the cards, the
                  live board and the money, run from one place.
                </p>
                <div className="ctas">
                  <a className="btn" href="#signup">Set up your first event {icon("arrow", "i")}</a>
                  <a className="btn ghost" href="#round">See a round</a>
                </div>
              </div>
            </div>
            <div className="proof">
              <span><b>Free</b> to start</span>
              <span><b>No</b> setup fee</span>
              <span>Players join with a <b>code</b> — no app</span>
              <span>Scores by <b>voice</b></span>
              <span><b>Sixteen</b> formats</span>
            </div>
            <div className="stage">
              <div className="desk">
                {/* Lazy, not priority: phones hide the laptop, and a priority image is preloaded
                    whether it shows or not (150 KB a phone never drew). On a laptop it is in view,
                    so it loads at once anyway. */}
                {lightShot({ name: "hero-console", variant: d, width: 2400, height: 1500, sizes: "(max-width: 760px) 1px, 80vw", alt: "The organizer's live leaderboard on a laptop: the field ranked across all flights, gross, net and to par." })}
              </div>
              <div className="phone">
                {lightShot({ name: "hero-live", variant: d, width: 600, height: 1298, priority: true, alt: "The public live board on a phone: the round, and the field ranked by net strokes, the leader highlighted." })}
              </div>
            </div>
            <p className="real">
              Every picture on this page is <b>an unedited screen of the app</b>, running a demo club with invented players.
            </p>
          </div>
          {/* Format NAMES never change for an edition: UK "foursomes" is
              alternate shot, a US "foursome" is the group of four. */}
          <div className="marq" role="group" aria-label="The sixteen formats" data-no-dialect="">
            <div className="marq-track">
              {[0, 1].map((n) =>
                FORMAT_NAMES.map((f) => (
                  <span key={`${n}-${f}`} aria-hidden={n === 1 ? true : undefined}>
                    {f}
                    <em aria-hidden="true"> •</em>
                  </span>
                )),
              )}
            </div>
          </div>
        </section>

        {/* ═══════════ THE ROUND ═══════════ */}
        <section className="sec" id="round" aria-labelledby="round-h">
          <div className="wrap">
            <div className="shead">
              <div>
                <span className="label">The round</span>
                <h2 className="h2" id="round-h">One Saturday, both sides of it.</h2>
              </div>
              <p>What you do as the organizer and what your players see, in the order it happens.</p>
            </div>
            <div className="round">
              <div className="steps" role="region" aria-label="The round, step by step" tabIndex={0}>
                {DAY.map((s) => (
                  <article className="step" key={s.time} data-cap={s.cap}>
                    <div className="step-t">
                      <b>{s.time}</b>
                      <span className={`who ${s.who}`}>{s.who === "org" ? "Organizer" : "Player"}</span>
                    </div>
                    <h3 className="h3">{s.h}</h3>
                    <p>{s.p}</p>
                    {s.ul ? <ul>{s.ul.map((x) => <li key={x}>{x}</li>)}</ul> : null}
                    <div className="inl phone">{screen(s.screen, s.alt)}</div>
                  </article>
                ))}
              </div>
              <div className="pin" aria-hidden="true">
                <div className="phone">
                  <div className="scr">
                    {DAY.map((s, i) => (
                      <span key={s.time}>{screen(s.screen, "", i === 0 ? "on" : "")}</span>
                    ))}
                  </div>
                </div>
                <div className="clock">{DAY.map((s) => <i key={s.time} />)}</div>
                <div className="cap">{DAY[0].cap}</div>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════ WHY IT'S DIFFERENT ═══════════
            Each reason is backed by the comparison below, from the named
            platforms' own websites. */}
        <section className="why" id="why" aria-labelledby="why-h">
          <div className="wrap">
            <span className="label">The difference</span>
            <h2 className="h2" id="why-h">Five reasons it&rsquo;s different.</h2>
            <p className="lead">What a club, a league or a golf group gets here — each one checked against the platforms we compare, on their own websites.</p>
            <div className="reasons">
              <div className="reason"><span className="n">01</span><h3>Say the score.</h3><p>Players read their scores out loud, hole by hole or the whole card. <b>None of the five platforms we compare lists voice scoring.</b></p></div>
              <div className="reason"><span className="n">02</span><h3>No app. No account.</h3><p>A round code puts a player on their card in eight characters. It installs from the browser if they want it on the home screen.</p></div>
              <div className="reason"><span className="n">03</span><h3>Works out the money. Never holds it.</h3><p>Outing costs, skins, pots and side bets in one settle-up, in the fewest handovers. <b>Nothing is collected or moved.</b></p></div>
              <div className="reason"><span className="n">04</span><h3>A real free plan. No setup fee.</h3><p>Up to {PLANS.free.limits.playersPerEvent} players, every format, the live board — free for good. <b>Both club platforms we compare charge a one-time setup fee and list no free plan.</b></p></div>
              <div className="reason"><span className="n">05</span><h3>Your country&rsquo;s golf.</h3><p>Carts or buggies, organizers or organisers, yards or metres, a Sunday or a Monday week — set by where the club is, with prices in its currency.</p></div>
            </div>
          </div>
        </section>

        {/* ═══════════ SIDE BY SIDE ═══════════
            The named comparison: every cell and its source live in
            lib/landing/compare.tsx — read the rules there before changing it. */}
        <section className="sec" id="compare" aria-labelledby="compare-h">
          <div className="wrap">
            <div className="shead">
              <div>
                <span className="label">Side by side</span>
                <h2 className="h2" id="compare-h">The usual way, and the TourneyHQ way.</h2>
              </div>
              <p>How most events are run today, and how the same day runs here.</p>
            </div>
            <div className="usual reveal">
              <div className="u-hd" aria-hidden="true"><span /><b>The usual way</b><b className="now">With TourneyHQ</b></div>
              {[
                ["The field", "A spreadsheet of names and handicaps", "Registration with open and close dates, and a waiting list"],
                ["Who's in", "A group chat, counted by hand", "Opt in or out on their phone — or captains send the list"],
                ["The draw", "Pairings worked out on paper", "Drawn from who's in, by handicap, standings or sides"],
                ["The scores", "Paper cards, typed up afterwards", "Entered on the course — tapped or said out loud"],
                ["The board", "Posted when somebody gets to it", "Live on every phone and a public link, as cards come in"],
                ["The money", "A notes app, a cash envelope and IOUs", "One settle-up, in the fewest handovers"],
              ].map(([k, before, after]) => (
                <div className="u-row" key={k}>
                  <i>{k}</i>
                  <span className="before"><span className="sr">The usual way: </span>{before}</span>
                  <span className="after"><span className="sr">With TourneyHQ: </span>{after}</span>
                </div>
              ))}
            </div>

            <div className="vs reveal">
              <div className="shead" style={{ marginBottom: 28 }}>
                <div>
                  <span className="label">Side by side</span>
                  <h3 className="h2" style={{ fontSize: "clamp(32px, 4vw, 56px)" }}>TourneyHQ and five you know.</h3>
                </div>
                <p>Two club platforms and three league apps, every cell from each company&rsquo;s own website as of {COMPARED_ON}.</p>
              </div>
              <p className="cx-cue" aria-hidden="true">Swipe to see all five {icon("arrow", "i")}</p>
              <div className="cx-scroll" tabIndex={0} role="region" aria-label="TourneyHQ beside five golf platforms">
                <table className="cx">
                  <caption className="sr">TourneyHQ beside {RIVALS.map((r) => r.name).join(", ")}</caption>
                  <thead>
                    <tr>
                      <th className="cx-lab" scope="col"><span className="sr">Feature</span></th>
                      <th className="cx-us" scope="col"><b>TourneyHQ</b><span>{PLANS.free.name} · {PLANS.society.name} · {PLANS.club.name}</span></th>
                      {RIVALS.map((r) => <th scope="col" key={r.name}><b>{r.name}</b><span>{r.kind}</span></th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.label}>
                        <th className="cx-lab" scope="row">{row.label}<small>{row.detail}</small></th>
                        <td className="cx-us">{cell(row.ours)}</td>
                        {row.theirs.map((c, i) => <td key={RIVALS[i].name}>{cell(c)}</td>)}
                      </tr>
                    ))}
                    <tr className="cx-src">
                      <th className="cx-lab" scope="row">Source</th>
                      <td className="cx-us">This page</td>
                      {RIVALS.map((r) => (
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
              {/* Where the others go further — a comparison that only lists wins is one a club will not trust. */}
              <div className="glance">
                <div className="glance-col further">
                  <h3>Where others go further</h3>
                  <ul>{goFurther().map((t) => <li key={t}><span className="dot" aria-hidden="true" /><span>{t}</span></li>)}</ul>
                </div>
              </div>
              <p className="vs-legal">
                Competitor information is from each company&rsquo;s own website as of {COMPARED_ON}. Golf Genius and
                BlueGolf prices are for facilities in the US and Canada with up to 36 holes; every competitor price is
                in US dollars, before tax. &ldquo;Not listed&rdquo; means their website does not say so, not that the
                feature is missing. Prices and features change, so check with each provider. Golf Genius, BlueGolf,
                Squabbit, Golf GameBook and LeagueGolfer are trademarks of their respective owners. TourneyHQ is not
                affiliated with or endorsed by any of them.
              </p>
            </div>
          </div>
        </section>

        {/* ═══════════ EVERY FEATURE ═══════════
            The showcase first — the rest of the real app, a tab at a time —
            then every line, all of it rendered, filtered by chips (CSS) and a
            search box (a small client script). */}
        <section className="sec tint" id="features" aria-labelledby="features-h">
          <div className="wrap">
            <div className="shead">
              <div>
                <span className="label">Every feature</span>
                <h2 className="h2" id="features-h">{total} features. All of them live today.</h2>
              </div>
              <p>Explore the real app by screen — the organizer&rsquo;s side and the player&rsquo;s — then search every line.</p>
            </div>

            <div className="show reveal" role="group" aria-label="The app, by screen">
              <div className="show-rail" role="radiogroup" aria-label="Screen">
                {(["org", "pl"] as const).map((side) => (
                  <div key={side} style={{ display: "contents" }}>
                    <span className="label">{side === "org" ? "Organizer" : "Player"}</span>
                    {SHOWCASE.filter((x) => x.side === side).map((x, i) => (
                      <label className="show-tab" key={x.key}>
                        <input className="sr" type="radio" name="show" value={x.key} defaultChecked={side === "org" && i === 0} />
                        <b>{x.title}</b>
                        <span>{x.sub}</span>
                      </label>
                    ))}
                  </div>
                ))}
              </div>
              <div className="show-view">
                {SHOWCASE.map((x) => (
                  <figure className="show-f" data-f={x.key} key={x.key}>
                    <div className="stage-phone">
                      <div className="phone">{screen(x.screen, x.alt)}</div>
                      <ol className="stage-pins" aria-hidden="true">
                        {x.notes.map((n, i) => <li key={n.t} style={{ top: `${n.y}%` }}>{i + 1}</li>)}
                      </ol>
                    </div>
                    <figcaption className="stage-notes">
                      <ol>{x.notes.map((n) => <li key={n.t}><b>{n.t}</b><span>{n.s}</span></li>)}</ol>
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>

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
        </section>

        {/* ═══════════ FORMATS ═══════════ */}
        <section className="sec" id="formats" aria-labelledby="formats-h">
          <div className="wrap">
            <div className="shead center">
              <span className="label">Formats</span>
              <h2 className="h2" id="formats-h">Sixteen formats. One leaderboard.</h2>
              <p className="lead">Three real boards from the demo club, each scored by its own format&rsquo;s rules.</p>
            </div>
            <div className="boards">
              {FORMAT_BOARDS.map(([name, title, caption, alt]) => (
                <figure key={name}>
                  <div className="phone sm">{lightShot({ name, variant: d, width: 600, height: 1298, alt })}</div>
                  <figcaption><b>{title}</b><span>{caption}</span></figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>

        {/* ═══════════ THE MONEY ═══════════ */}
        <section className="sec band" id="money" aria-labelledby="money-h">
          <div className="wrap">
            <div className="shead">
              <div>
                <span className="label">The money</span>
                <h2 className="h2" id="money-h">Outing costs and prize money, <span className="o">settled.</span></h2>
              </div>
              <p>Worked out from the cards and the bills — and TourneyHQ never touches the cash.</p>
            </div>
            <div className="money-cols">
              <div className="mcard reveal">
                <h3 className="h3">Outing costs, split.</h3>
                <p>Whoever paid records the bill. Several payers on one bill, refunds, and four ways to split it.</p>
                <div className="chips">
                  {["Green fees", "Carts", "Caddies", "Dinner", "Lodging", "Evenly", "By shares", "Exact amounts", "By percent"].map((c) => <span key={c}>{c}</span>)}
                </div>
                <div className="phone money-phone">{lightShot({ name: "money-expenses", variant: d, width: 600, height: 1298, alt: "A player's Money screen: five expenses from one golf weekend, each split its own way — dinner among 14, lodging by shares across 5, caddies among 4, carts among 8, green fees among all 16." })}</div>
              </div>
              <div className="mcard reveal">
                <h3 className="h3">Prize money, from the board.</h3>
                <p>Start from a structure — top three, gross &amp; net, flight winners, a twos pot, nearest the pin — set each amount, award in finishing order.</p>
                <div className="chips">
                  {["Total purse", "Flight winners", "Twos pot", "Skins with carries", "Nassau", "Birdie pot"].map((c) => <span key={c}>{c}</span>)}
                </div>
                <div className="well">{lightShot({ name: "prizes-org-phone", variant: d, width: 1170, height: 1310, sizes: "(max-width: 760px) 92vw, 440px", alt: "The organizer's prizes: Club Champion, 250, awarded to the winner; runner-up 120 and third 60 awarded in finishing order; best gross round not yet awarded." })}</div>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════ MAKE IT YOURS ═══════════
            The comparison slider: the SAME real screen two ways, a divider
            dragged between them (Ajay: "I really like the slider"; it opens on light
            vs dark — "make the slider use for light vs dark theme"). Every frame
            is rendered and only the chosen one shown, so the tabs are native
            radios and work without JavaScript. */}
        <section className="sec" id="yours" aria-labelledby="yours-h">
          <div className="wrap yours">
            <div>
              <span className="label">Make it yours</span>
              <h2 className="h2" id="yours-h" style={{ marginTop: 22 }}>Light or dark. In your colors.</h2>
              <p className="lead" style={{ marginTop: 20 }}>
                Every screen comes in light and dark — drag the slider across one. And the organizer screens, the
                public board and the player app all wear the club&rsquo;s colors: eleven presets, thirteen ready-made
                pairings, or your own, each checked for how it reads outdoors.
              </p>
              <div className="facts">
                <div><span className="ic">{icon("sun")}</span><div><h4>Checked for sunlight</h4><p>A 7:1 outdoor bar on dark, the readable minimum on light — a warning, not a refusal.</p></div></div>
                <div><span className="ic">{icon("moon")}</span><div><h4>Dark, light, or follow the phone</h4><p>Clubhouse at dusk indoors, paper-white in bright sun.</p></div></div>
                <div><span className="ic">{icon("star")}</span><div><h4>Your logo, ours stepped back</h4><p>On the {PLANS.club.name} plan your mark leads, with TourneyHQ a small &ldquo;powered by&rdquo; line.</p></div></div>
              </div>
            </div>
            <div className="compare" role="group" aria-label="The same real screen, compared">
              <div className="seg" role="radiogroup" aria-label="What to compare">
                <label className="tab"><input className="sr" type="radio" name="cmp-mode" value="ap" defaultChecked />Light vs dark</label>
                <label className="tab"><input className="sr" type="radio" name="cmp-mode" value="col" />Club colors</label>
              </div>
              <div className="seg cmp-tabs" data-set="col" role="radiogroup" aria-label="Color pair to compare">
                {COMPARE_COLOURS.map((k, i) => (
                  <label className="tab" key={k}><input className="sr" type="radio" name="cmp-col" value={k} defaultChecked={i === 0} />{COLOUR_LABEL[k][0]}</label>
                ))}
              </div>
              {COMPARE_COLOURS.map((k) => {
                const [name, desc] = COLOUR_LABEL[k];
                return (
                  <div className="cmp-f" data-f={`col-${k}`} key={`col-${k}`}>
                    <div className="cmp-frame phone">
                      <div className="cmp-view">
                        {lightShot({ name: "theme-tournament", variant: d, width: 480, height: 1039, alt: "The Board in the default Tournament colors." })}
                        {lightShot({ name: `theme-${k}`, variant: d, width: 480, height: 1039, className: "cmp-b", alt: `The same Board in ${name} colors, ${desc}.` })}
                        <input className="cmp-range" type="range" min={0} max={100} defaultValue={50} aria-label={`Drag to compare the default colors and ${name}`} />
                        <span className="cmp-line" aria-hidden="true"><i /></span>
                      </div>
                    </div>
                    <div className="cmp-legend">
                      <span>Default</span>
                      <span className="cmp-hint">drag to compare</span>
                      <span>{name}</span>
                    </div>
                  </div>
                );
              })}
              {COMPARE_APPEARANCE.map((k) => {
                const name = `phone-${k}`;
                const [variant, w, hgt] = [d, 600, 1298];
                return (
                  <div className="cmp-f" data-f={`ap-${k}`} key={`ap-${k}`}>
                    <div className="cmp-frame phone">
                      <div className="cmp-view">
                        {fixedShot(shotSrc(name, variant, "light"), w, hgt, `${APPEARANCE_LABEL[k]}, in the light appearance.`)}
                        {fixedShot(shotSrc(name, variant, "dark"), w, hgt, "The same screen, in the dark appearance.", "cmp-b")}
                        <input className="cmp-range" type="range" min={0} max={100} defaultValue={50} aria-label="Drag to compare light and dark" />
                        <span className="cmp-line" aria-hidden="true"><i /></span>
                      </div>
                    </div>
                    <div className="cmp-legend">
                      <span>{icon("sun")}Light</span>
                      <span className="cmp-hint">drag to compare</span>
                      <span>Dark{icon("moon")}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ═══════════ PRICING ═══════════
            Read from PLANS through the owner's overrides, in the visitor's
            currency, so the page cannot promise a price or a limit the code
            does not hold. The Monthly / Yearly radios choose which shows. */}
        <section className="sec tint" id="pricing" aria-labelledby="pricing-h">
          <div className="wrap">
            <div className="shead">
              <div>
                <span className="label">Pricing</span>
                <h2 className="h2" id="pricing-h">Priced on your field. Never per player.</h2>
              </div>
              <div>
                <div className="seg bill" role="radiogroup" aria-label="Billing period">
                  <label className="tab"><input className="sr" type="radio" name="bill" value="m" defaultChecked />Monthly</label>
                  <label className="tab"><input className="sr" type="radio" name="bill" value="y" />Yearly <em>2 MONTHS FREE</em></label>
                </div>
                <p className="ed-note">{note}</p>
              </div>
            </div>
            <div className="tiers">
              <div className="tier reveal">
                <h3>{PLANS.free.name}</h3>
                <p className="for">{PLANS.free.blurb}</p>
                <div className="price"><b>{prices.zero}</b><span>forever</span></div>
                <div className="price-sub">&nbsp;</div>
                <a className="btn ghost" href="#signup">Start free</a>
                <ul>
                  {tick(<>Up to {PLANS.free.limits.playersPerEvent} in a field</>)}
                  {tick("One tournament at a time")}
                  {tick("One organizer")}
                  {tick("Every format, the live board, the money")}
                </ul>
                <p className="note">{retentionNotice("free")}</p>
              </div>
              <div className="tier hot reveal">
                <h3>{PLANS.society.name}<span className="badge">{PLANS.society.tagline}</span></h3>
                <p className="for">{PLANS.society.blurb}</p>
                <div className="price">
                  <b><span className="per-m">{prices.society.monthly}</span><span className="per-y">{prices.society.yearly}</span></b>
                  <span><span className="per-m">/ month</span><span className="per-y">/ year</span></span>
                </div>
                <div className="price-sub">
                  <span className="per-m">or {prices.society.yearly} a year — two months free</span>
                  <span className="per-y">two months free</span>
                </div>
                <a className="btn" href="#signup"><span className="long">Choose {PLANS.society.name}</span><span className="short">Choose</span></a>
                <p className="tier-how">Create your account and we move it to this plan. Nothing is charged online.</p>
                <ul>
                  {tick(<>Up to {PLANS.society.limits.playersPerEvent} in a field</>)}
                  {tick("As many events as your season runs")}
                  {tick(<>Up to {PLANS.society.limits.staffSeats} organizers</>)}
                  {tick("Order of merit across your tournaments")}
                  {tick(capitalise(retentionSummary(PLANS.society)))}
                </ul>
              </div>
              <div className="tier reveal">
                <h3>{PLANS.club.name}</h3>
                <p className="for">{PLANS.club.blurb}</p>
                <div className="price">
                  <b><span className="per-m">{prices.club.monthly}</span><span className="per-y">{prices.club.yearly}</span></b>
                  <span><span className="per-m">/ month</span><span className="per-y">/ year</span></span>
                </div>
                <div className="price-sub">
                  <span className="per-m">or {prices.club.yearly} a year — two months free</span>
                  <span className="per-y">two months free</span>
                </div>
                <a className="btn ghost" href="#signup"><span className="long">Choose {PLANS.club.name}</span><span className="short">Choose</span></a>
                <p className="tier-how">Create your account and we move it to this plan. Nothing is charged online.</p>
                <ul>
                  {tick("An unlimited field")}
                  {tick("As many tournaments as your season runs")}
                  {tick(<>Up to {PLANS.club.limits.staffSeats} organizers and assistants</>)}
                  {tick("Your club's branding, ours removed")}
                  {tick(`Order of merit · ${retentionSummary(PLANS.club)}`)}
                </ul>
              </div>
            </div>
            <div className="cp reveal">
              <h3>Compare plans</h3>
              <p className="cp-sub">What changes from one plan to the next.</p>
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
            <p className="tier-note">Paid plans are arranged with us directly — nothing is charged through the app.</p>
            <div className="ultimate">
              <span className="ic">{icon("globe")}</span>
              <div>
                <h3>{PLANS.enterprise.name} · {PLANS.enterprise.tagline}</h3>
                {contactEmail ? (
                  <p>Running several clubs, or a corporate golf program? Tell us how you work and we&rsquo;ll scope it with you.</p>
                ) : (
                  <p>Running several clubs, or a corporate golf program? {PLANS.enterprise.name} is priced with each organization rather than published — our contact address opens soon. Until then, each club can run on {PLANS.club.name}.</p>
                )}
              </div>
              {contactEmail ? (
                <a className="btn ghost sm" href={`mailto:${contactEmail}?subject=TourneyHQ%20for%20our%20organization`}>Talk to us</a>
              ) : null}
            </div>
            <p className="metered">
              Text alerts, reading a photographed card and drafted commentary are built and not switched on for
              anybody yet — they cost per message and per call, so they will come with {PLANS.club.name} first, once
              they&rsquo;re worth billing for.
            </p>
          </div>
        </section>

        {/* ═══════════ QUESTIONS ═══════════
            Eight here, all of them on /faq — the same answers, from one module. */}
        <section className="sec" id="faq" aria-labelledby="faq-h">
          <div className="wrap faq-split">
            <div>
              <span className="label">Questions</span>
              <h2 className="h2" id="faq-h">What organizers ask first.</h2>
              <p className="lead">The eight we hear most. {FAQ_COUNT} in all — handicaps, leagues, the money, plans — on the full page.</p>
              <Link className="btn ghost sm" href="/faq">See all {FAQ_COUNT} questions {icon("arrow", "i i-sm")}</Link>
            </div>
            <div>
              {LANDING_FAQ_IDS.map((id) => {
                const item = faqItem(id);
                return (
                  <details className="q" key={id}>
                    <summary>{item.q}<span className="pm" aria-hidden="true">+</span></summary>
                    <div className="ans">{item.a(ctx)}</div>
                  </details>
                );
              })}
            </div>
          </div>
        </section>

        {/* ═══════════ SIGN UP / SIGN IN ═══════════ */}
        <section className="close" id="start" aria-labelledby="start-h">
          <div className="wrap">
            <span className="anchor" id="signup" aria-hidden="true" />
            <span className="anchor" id="signin" aria-hidden="true" />
            <span className="label">Free to start · No setup fee</span>
            <h2 className="h1" id="start-h">Set up your<br /><span className="o">first event.</span></h2>
            <p className="lead">
              A name is enough to start. No card — and with round codes on, your players don&rsquo;t need an account.
              Organizers create an event here; players invited to one sign in with the same box.
            </p>
            <div className="authpanel">
              <LandingAuth defaultMode="signup" organizers={golfTermsFor(shown.register).organizers} />
            </div>
            <div className="store-block">
              <div className="stores">
                {storeButton("ios", STORE_LINKS.ios)}
                {storeButton("android", STORE_LINKS.android)}
              </div>
              <p className="stores-note">
                Until then it installs straight from the browser on iPhone and Android — add it to your home screen
                and it opens in its own window, like an app.
              </p>
            </div>
          </div>
        </section>
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
    <Link className="store soon" href="/faq#q-stores" aria-label={`${name} — coming soon. How to install it from your browser today`}>{inner}</Link>
  );
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
