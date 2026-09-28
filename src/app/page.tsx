import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { landingScreenFor } from "@/lib/roles";
import { PLANS, retentionNotice, retentionSummary } from "@/lib/plans";
import { storedPricingOverrides } from "@/lib/services/platform-pricing";
import { siteStructuredData } from "@/lib/domain/structured-data";
import { siteOrigin } from "@/lib/site";
import { editionSwaps, landingEdition, US_OVERRIDE_COOKIE } from "@/lib/landing/edition";
import { inDialect } from "@/lib/landing/dialect";
import { landingPrices } from "@/lib/landing/pricing";
import { FAQ_COUNT, FORMAT_NAMES, LANDING_FAQ_IDS, faqItem } from "@/lib/landing/faq";
import { COMPARE_APPEARANCE, COMPARE_COLOURS, LANDING_CSS } from "@/lib/landing/styles";
import { LandingAuth } from "@/components/LandingAuth";
import { LandingEffects } from "@/components/LandingEffects";
import { ScreensToggle } from "@/components/landing/ScreensToggle";
import {
  CONTACT_EMAIL,
  editionNote,
  icon,
  iconSprite,
  landingFooter,
  landingNav,
} from "@/components/landing/chrome";
import { fixedShot, shot, shotSrc } from "@/components/landing/shots";

/**
 * Only the canonical. Title, description and the share cards come from the root
 * layout, and this is the one page whose content those defaults describe — so
 * naming them again here would be two copies of the same sentence to keep in
 * step.
 */
export const metadata = { alternates: { canonical: "/" } };

/**
 * The app-store listings, when they exist. Empty today, so the buttons read
 * "Coming soon" and link nowhere; set a URL in the environment and that button
 * becomes a real link. Swap in Apple's and Google's official badge artwork at
 * the same moment — both companies allow their badges only on a link to a live
 * listing.
 */
const STORE_LINKS = {
  ios: process.env.TOURNEYHQ_IOS_URL ?? "",
  android: process.env.TOURNEYHQ_ANDROID_URL ?? "",
};

/** The desktop-and-phone pairs: [key, desktop capture, phone capture, url, caption, what it is]. */
const DEVICE_SETS = [
  ["live", "dp-live-desktop", "dp-live-phone", "tourneyhq.club/live/…", "the public board — no login, names and scores only", "The public live board"],
  ["console", "hero-console", "dp-console-phone", "tourneyhq.club/leaderboard", "the organizer console — the full sidebar on a laptop, the same leaderboard on a phone", "The organizer console's leaderboard"],
  ["player", "dp-player-desktop", "phone-board", "tourneyhq.club/me/board", "the player app — their own line first, at any size", "A player's Board"],
] as const;

const APPEARANCE_LABEL: Record<(typeof COMPARE_APPEARANCE)[number], string> = {
  today: "Today",
  board: "Board",
  card: "My card",
  money: "Money",
  console: "Console",
};

const COLOUR_LABEL: Record<(typeof COMPARE_COLOURS)[number], readonly [string, string]> = {
  championship: ["Championship", "claret & gold"],
  coastal: ["Coastal", "links blue & sand"],
  azalea: ["Azalea Week", "hot pink & sand"],
};

/**
 * THE FRONT DOOR — redesigned 2026-09-27 (Ajay: "a real good website", "modern
 * and professional", "sleek").
 *
 * What it is made of, and where each part comes from:
 *  - EVERY PRODUCT IMAGE IS A REAL SCREEN of the app, captured unedited from a
 *    production build running the invented demo club. Nothing is drawn, and
 *    the screens are dark by default with their light twins a switch away.
 *  - THE VISITOR'S EDITION is decided here, on the server, from the request's
 *    country: local prices (set, not converted — `effectivePrice`) and local
 *    golf words (`golf-terms.ts`), with a switch to US $ and US terms. US is
 *    the default.
 *  - EVERY NUMBER IS READ, not typed: prices from PLANS through the owner's
 *    overrides, limits and seats from PLANS, the Free plan's retention term
 *    from `retentionNotice`, the worked handicap from the scoring engine.
 *  - THE WORDS ARE CHECKED against the app (TourneyHQv2 verified every
 *    comparison cell, the voice wording and the format count on 2026-09-27),
 *    and the competitor facts are from each company's own website that day.
 *
 * The whole tree is built once in US English and then passed through the
 * edition's word swaps (`inDialect`), so a British visitor's page arrives
 * saying "buggy" and "organiser" rather than flashing the US words first.
 */
export default async function LandingPage() {
  const session = await getSession();
  // Straight after sign-up there is no tournament yet, and the dashboard has
  // nothing to render without one — it would only bounce to /choose anyway.
  // Via landingScreenFor, not a hard-coded /dashboard.
  if (session) redirect(session.eventId ? landingScreenFor(session.viewRole) : "/choose");

  // The owner's price overrides, so the price on this page is the one the owner
  // set on the console — the same number the schema.org offer below quotes.
  const overrides = await storedPricingOverrides();
  const [h, jar] = await Promise.all([headers(), cookies()]);
  const { local, shown, overridden } = landingEdition(
    h.get("x-vercel-ip-country"),
    jar.get(US_OVERRIDE_COOKIE)?.value === "1",
  );
  const prices = landingPrices(shown, overrides);
  const d = shown.shots;
  const cur = shown.currency.toLowerCase();
  const ctx = { prices, email: CONTACT_EMAIL };
  const note = editionNote(local, overridden);

  const check = icon("check");
  const tick = (text: React.ReactNode) => (
    <li>
      {check}
      {text}
    </li>
  );
  const ck = (text: React.ReactNode) => (
    <li>
      <span className="ck">{check}</span>
      {text}
    </li>
  );
  const feature = (text: React.ReactNode, sub?: React.ReactNode) => (
    <li>
      {check}
      <span>
        {text}
        {sub ? <small>{sub}</small> : null}
      </span>
    </li>
  );

  const page = (
    <div className="thq" lang={shown.locale}>
      <style dangerouslySetInnerHTML={{ __html: LANDING_CSS }} />
      {/* What kind of thing this is, in schema.org terms — a product with a
          free tier and two paid ones, priced from PLANS in the visitor's
          currency, so it cannot drift from the pricing section below. */}
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
        <section className="hero">
          <div className="wrap">
            <div className="hero-copy">
              <span className="eyebrow"><i />Golf tournament &amp; league management</span>
              <h1 className="h1">From Registration<br />to <span className="grad">Recognition.</span></h1>
              {/* The organizer's real path through the app — entry, the draw,
                  the round, the result — which is why it earns the sequence. */}
              <div className="verbs" aria-label="Plan it, pair it, play it, crown it">
                <span>Plan it</span><span>Pair it</span><span>Play it</span><span>Crown it</span>
              </div>
              <p className="lead">
                The club championship, the Thursday league and the Saturday foursome — run from one place.
                Every format scored to the book, the tee sheet drawn from who&rsquo;s in, the skins settled to
                the cent, and a live leaderboard on every phone.
              </p>
              <div className="cta-row">
                <a className="btn btn-solid btn-lg" href="#signup">Set up your first event {icon("arrow", "i i-sm arr")}</a>
                <a className="btn btn-ghost btn-lg" href="#features">See what it does</a>
              </div>
              <div className="proof">
                <span>{check}Free to start</span>
                <span>{check}No setup fee</span>
                <span>{check}Join with a code</span>
                <span>{check}Score by voice</span>
              </div>
            </div>
          </div>

          <div className="wrap">
            <div className="showcase reveal" role="group" aria-label="The organizer's live leaderboard, and a player's Today screen — real screens of the app">
              <div className="window">
                <div className="win-bar">
                  <div className="dots"><i /><i /><i /></div>
                  <div className="url">{icon("lock")}tourneyhq.club/leaderboard</div>
                  <div className="win-pad" />
                </div>
                {shot({
                  name: "hero-console",
                  variant: d,
                  width: 1600,
                  height: 1000,
                  className: "win-shot",
                  priority: true,
                  alt: "TourneyHQ's organizer console showing the live leaderboard of a club tournament: players, flights, holes played, gross, net and score to par.",
                })}
              </div>
              <div className="phone">
                <div className="scr">
                  {shot({
                    name: "hero-phone",
                    variant: d,
                    width: 600,
                    height: 1298,
                    priority: true,
                    alt: "The player app's Today screen: a pinned notice, the player's card thru 11 holes, and the leaders.",
                  })}
                </div>
              </div>
            </div>
            <div className="screens-bar">
              <p className="real-note"><i />Real screens of the app, running on invented demo data</p>
              <ScreensToggle />
            </div>
          </div>
        </section>

        {/* ═══════════ STATS ═══════════ */}
        <div className="strip">
          <div className="wrap">
            <div className="s"><b>16</b><span>formats on one leaderboard</span></div>
            <div className="s"><b>4</b><span>ways to decide who&rsquo;s in each week</span></div>
            <div className="s"><b>8</b><span>characters to join a round — no account</span></div>
            <div className="s"><b className="accent">0%</b><span>of your money ever held or moved</span></div>
          </div>
        </div>

        {/* ═══════════ FEATURES ═══════════ */}
        <section className="sec" id="features">
          <div className="wrap">
            <div className="sec-head reveal">
              <span className="kick">Features</span>
              <h2 className="h2">Everything the day needs. <span className="muted">Nothing it doesn&rsquo;t.</span></h2>
              <p className="lead">
                More configurable, and it asks less. Most of what other tools make you set, TourneyHQ already
                knows from the format, the event and the kind of outfit you are.
              </p>
            </div>
            <div className="bento">
              <div className="cell c4 reveal">
                <div className="ic">{icon("board")}</div>
                <h3 className="h3">A live leaderboard on every phone</h3>
                <p>
                  Standings update as cards come in — on your screen, every player&rsquo;s phone, and, once you
                  publish it, a public link for the clubhouse screen and the families. No login; names and
                  scores only.
                </p>
                <figure className="shot-fig">
                  {shot({ name: "crop-live-board", variant: d, width: 1000, height: 846, className: "shot", alt: "The public live board: ranked by net strokes, the leader highlighted, each player's flight and holes played." })}
                  <figcaption><i />Real screen · the public board</figcaption>
                </figure>
              </div>
              <div className="cell c2 reveal">
                <div className="ic">{icon("key")}</div>
                <h3 className="h3">No account. No install.</h3>
                <p>Turn on round codes and a player types eight characters to reach their card.</p>
                <figure className="shot-fig">
                  {fixedShot("/landing/crop-round-code.webp", 700, 592, "The round code screen: 'Enter your score — type the round code you were given', with a code box reading ABCD-EFGH.", "shot")}
                  <figcaption><i />Real screen · round code</figcaption>
                </figure>
              </div>
              <div className="cell c2 reveal">
                <div className="ic">{icon("users")}</div>
                <h3 className="h3">The tee sheet, drawn for you</h3>
                <p>Groups drawn by handicap, standings or sides — from who&rsquo;s in — then yours to adjust, publish and print.</p>
                <figure className="shot-fig">
                  {shot({ name: "crop-tee-sheet", variant: d, width: 1200, height: 494, className: "shot", alt: "The tee sheet: groups with their start times, each player's handicap and the group average." })}
                  <figcaption><i />Real screen · tee sheet</figcaption>
                </figure>
              </div>
              <div className="cell c2 reveal">
                <div className="ic">{icon("mic")}</div>
                <h3 className="h3">Say your score</h3>
                <p>
                  Tap it, or say it — &ldquo;four&rdquo;, &ldquo;par&rdquo;, &ldquo;bogey&rdquo; — or read the whole
                  card out in one go. Tap the mic, speak, and it stops listening when you finish. TourneyHQ keeps
                  the scores, not what you said. Where the phone&rsquo;s browser supports it.
                </p>
                <figure className="shot-fig">
                  {shot({ name: "crop-say-card", variant: d, width: 700, height: 233, className: "shot", alt: "My card, full-card view: a 'Say the card' button — 'Read your 18 scores down the card' — and the app's note that the microphone is only on while you use the button and nothing said is recorded or kept." })}
                  <figcaption><i />Real screen · say the card</figcaption>
                </figure>
              </div>
              <div className="cell c2 reveal">
                <div className="ic">{icon("users")}</div>
                <h3 className="h3">One phone, the whole foursome</h3>
                <p>One player can keep the card for the group on the published tee sheet. Each player still signs their own card, and a partner&rsquo;s own edits always win.</p>
                <figure className="shot-fig">
                  {shot({ name: "crop-group", variant: d, width: 700, height: 191, className: "shot", alt: "My card: the By hole / Full card switch, a Me / Group (2) switch, and the hole strip." })}
                  <figcaption><i />Real screen · me or the group</figcaption>
                </figure>
              </div>
              <div className="cell c3 reveal">
                <div className="ic">{icon("shield")}</div>
                <h3 className="h3">Cards the committee can stand behind</h3>
                <p>Entered, certified, approved — and a disputed card is set aside and named, never quietly counted. A disputed result can&rsquo;t settle the money or finish the event.</p>
                <figure className="shot-fig">
                  {shot({ name: "crop-card-status", variant: d, width: 700, height: 538, className: "shot", alt: "A player's card with 11 of 18 holes in, its gross, to-par and net, and a Certify my card button — certify once all 18 holes are in." })}
                  <figcaption><i />Real screen · card status</figcaption>
                </figure>
              </div>
              <div className="cell c3 reveal">
                <div className="ic">{icon("info")}</div>
                <h3 className="h3">It tells you why — and the way out</h3>
                <p>When something can&rsquo;t be done, the screen says why and what to do next, right where you tried. Not a dead button, not a tooltip to hunt for.</p>
                <figure className="shot-fig">
                  {shot({ name: "crop-locked", variant: d, width: 1200, height: 115, className: "shot", alt: "'Changing this redraws who plays whom, so it is locked while setup is. Unlock setup on Tournament details to change it.'" })}
                  <figcaption><i />Real screen · the bracket, locked</figcaption>
                </figure>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════ FORMATS ═══════════ */}
        <div className="ticker" role="group" aria-label="Sixteen formats">
          <p className="tick-label">Sixteen formats, one leaderboard</p>
          {/* Format NAMES never change for an edition: UK "foursomes" is
              alternate shot, a US "foursome" is the group of four. */}
          <div className="tick-track" data-no-dialect="">
            {FORMAT_NAMES.map((f) => <span key={f}>{f}</span>)}
            {FORMAT_NAMES.map((f) => <span key={`${f}-again`} aria-hidden="true">{f}</span>)}
          </div>
        </div>

        {/* ═══════════ HOW IT WORKS ═══════════ */}
        <section className="sec" id="how">
          <div className="wrap">
            <div className="sec-head reveal">
              <span className="kick">How it works</span>
              <h2 className="h2">From entry form to honors board.</h2>
              <p className="lead">Not a workbook for the field, a chat thread for who&rsquo;s in and a notes app for the skins. One set of numbers, start to finish.</p>
            </div>
            <div className="steps">
              <div className="step reveal">
                <span className="n">01</span>
                <h3>Plan it.</h3>
                <p>A name is enough to start. Everything stays editable.</p>
                <ul>
                  {tick("Entries open and close on dates, with a waiting list")}
                  {tick("Members enter in a tap, and can withdraw until entries close")}
                  {tick("Copy last year's — the setup, never the scores")}
                </ul>
              </div>
              <div className="step reveal">
                <span className="n">02</span>
                <h3>Pair it.</h3>
                <p>The draw starts from who said they&rsquo;re playing.</p>
                <ul>
                  {tick("Opt in, opt out, or captains send the list")}
                  {tick("Groups by handicap, standings or sides — then yours")}
                  {tick("Publish, and each tee time goes to their phone — if they've turned notifications on")}
                </ul>
              </div>
              <div className="step reveal">
                <span className="n">03</span>
                <h3>Play it.</h3>
                <p>Scores from the tee, standings everywhere.</p>
                <ul>
                  {tick("A round code puts a player on their card")}
                  {tick("A public board for the clubhouse screen")}
                  {tick("Messages to the club, a flight, a foursome — or one player")}
                </ul>
              </div>
              <div className="step reveal">
                <span className="n">04</span>
                <h3>Crown it.</h3>
                <p>Results a committee can stand behind.</p>
                <ul>
                  {tick("Countback on the last 9, 6, 3 and 1")}
                  {tick("Prizes by finishing order, and the honors board")}
                  {tick("The money worked out to the cent — never touched")}
                </ul>
              </div>
            </div>
          </div>
        </section>

        <div className="wrap"><div className="divider" /></div>

        {/* ═══════════ WHO IT'S FOR ═══════════ */}
        <section className="sec aud" id="for">
          <div className="wrap">
            <div className="sec-head reveal">
              <span className="kick">Who it&rsquo;s for</span>
              <h2 className="h2">One engine. <span className="muted">Every kind of golf.</span></h2>
              <p className="lead">Each outfit gets the parts that apply — and is never asked about the rest.</p>
            </div>
            <div className="seg" role="radiogroup" aria-label="Who it's for">
              <label className="tab"><input className="sr" type="radio" name="aud" value="club" defaultChecked />{icon("building")}Golf clubs</label>
              <label className="tab"><input className="sr" type="radio" name="aud" value="league" />{icon("calendar")}Leagues &amp; golf groups</label>
              <label className="tab"><input className="sr" type="radio" name="aud" value="day" />{icon("heart")}Charity &amp; corporate</label>
              <label className="tab"><input className="sr" type="radio" name="aud" value="casual" />{icon("flag")}A round with friends</label>
            </div>

            <div className="aud-panel" data-p="club">
              <div className="aud-copy">
                <h3>Every competition on the calendar, championship to Thursday night.</h3>
                <p>Divisions off different tees on one board, a members&rsquo; roster that carries from event to event, and the recognition the members turned up for.</p>
                <ul className="checks">
                  {ck("Three divisions, three sets of tees, one leaderboard")}
                  {ck("One roster — handicaps, tees and contacts carry forward, and a blank never overwrites them")}
                  {ck(`Your colors on every screen — and on the ${PLANS.club.name} plan your logo, with TourneyHQ stepped back to "powered by"`)}
                  {ck("Blind events — standings hidden from players and the public link until you publish results")}
                  {ck("Entry fees and prizes stay with the shop — the app keeps the record, not the cash")}
                </ul>
              </div>
              <figure className="shot-fig panel">
                {shot({ name: "panel-club-bracket", variant: d, width: 1100, height: 582, className: "shot", alt: "The bracket manager: quarterfinals, semifinals and final, with match results such as 4&3 and 2&1." })}
                <figcaption><i />Real screen · the knockout bracket</figcaption>
              </figure>
            </div>

            <div className="aud-panel" data-p="league">
              <div className="aud-copy">
                <h3>A season, not twelve separate evenings.</h3>
                <p>The weekly question answered on the players&rsquo; phones, the draw built from the answers, and a table that treats a missed week as a week missed — not a zero.</p>
                <ul className="checks">
                  {ck("In unless they opt out, out unless they opt in — or captains send the list and the club enters it")}
                  {ck("A season table where a missed week is a week missed — never a zero")}
                  {ck("Interclub leagues — level clubs share the place; your tie-break chain sets the order and play-off seeding")}
                  {ck("Away trips split properly — rooms, dinner, carts, each with its own people")}
                </ul>
              </div>
              <figure className="shot-fig panel">
                {shot({ name: "panel-league-week", variant: d, width: 1100, height: 608, className: "shot", alt: "A league week: Stableford results for the night, with '17 of 20 in have returned a card · 3 still to come'." })}
                <figcaption><i />Real screen · a league week</figcaption>
              </figure>
            </div>

            <div className="aud-panel" data-p="day">
              <div className="aud-copy">
                <h3>One big field, played once — without a season&rsquo;s worth of setup.</h3>
                <p>A scramble scored as a scramble, a board on the clubhouse screen, and helpers for the day who don&rsquo;t use up a seat.</p>
                <ul className="checks">
                  {ck("Scramble, Texas scramble, shamble — each on its own engine")}
                  {ck("One tee, split tees or a shotgun — A and B groups when the field outgrows the course")}
                  {ck("A guest role for somebody helping on the day — it costs no staff seat")}
                  {ck("A public board link — names and scores only, never contact details")}
                </ul>
              </div>
              <figure className="shot-fig panel">
                {shot({ name: "panel-day-board", variant: d, width: 900, height: 901, className: "shot", alt: "The public live board, as shown on a clubhouse screen: the club's name, the round, and the field ranked by net strokes." })}
                <figcaption><i />Real screen · the board on the clubhouse screen</figcaption>
              </figure>
            </div>

            <div className="aud-panel" data-p="casual">
              <div className="aud-copy">
                <h3>Four of you, one afternoon. Free.</h3>
                <p>Set up a round with your group: the scoring, a live board, and — only if you ask for it — the bet, worked out. Nobody is asked anything they don&rsquo;t need.</p>
                <ul className="checks">
                  {ck(`Up to ${PLANS.free.limits.playersPerEvent} players on the free plan — temporary by design: kept for about a day unless someone keeps it`)}
                  {ck("Play for nothing, for a pint, or for skins or a birdie pot — worked out from the cards")}
                  {ck("Everyone joins with a code — no account, no install")}
                  {ck("One figure each at the end, with the parts shown")}
                </ul>
              </div>
              <figure className="shot-fig panel narrow">
                {shot({ name: "panel-casual-events", variant: d, width: 600, height: 800, className: "shot", alt: "The player's Events screen, starting with 'Play a casual round — just you and your group, no tournament needed'." })}
                <figcaption><i />Real screen · start a casual round</figcaption>
              </figure>
            </div>
          </div>
        </section>

        {/* ═══════════ FOR THE PLAYER ═══════════ */}
        <section className="sec paper" id="players">
          <div className="wrap reveal">
            <div className="sec-head" style={{ marginBottom: 0 }}>
              <span className="kick">For the player</span>
              <h2 className="h2">Four tabs. <span className="muted">Nothing to learn.</span></h2>
              <p className="lead">
                A member opens their phone on the first tee, not a manual — their round, the board, their card
                and what&rsquo;s coming up, in the club&rsquo;s own colors. A Money tab joins them when there&rsquo;s
                money in play.
              </p>
            </div>
            <div className="feats">
              <div className="feat"><div className="ic">{icon("home")}</div><div><h4>Today</h4><p>Their round, tee time, group and where they stand — plus the club&rsquo;s pinned notices.</p></div></div>
              <div className="feat"><div className="ic">{icon("board")}</div><div><h4>Board</h4><p>Their own line first, and the column says whether it&rsquo;s strokes, points or match play.</p></div></div>
              <div className="feat"><div className="ic">{icon("grid")}</div><div><h4>My card</h4><p>Opens on the hole they&rsquo;re playing — tap the score, or say it. Net cards show gross and net, with the stroke dot.</p></div></div>
              <div className="feat"><div className="ic">{icon("calendar")}</div><div><h4>Events</h4><p>Every tournament the club runs — enter in a tap, and &ldquo;am I in next week?&rdquo; answered.</p></div></div>
            </div>
          </div>
        </section>

        {/* ═══════════ DESKTOP AND PHONE ═══════════ */}
        <section className="sec" id="devices">
          <div className="wrap">
            <div className="sec-head center reveal">
              <span className="kick">Desktop and phone</span>
              <h2 className="h2">The same screen, <span className="muted">wherever you are.</span></h2>
              <p className="lead">Run the day from a laptop in the clubhouse; everyone else follows on their phone. Real captures of the same screen at both sizes.</p>
            </div>
            <div className="dp reveal">
              <div className="seg" role="radiogroup" aria-label="Screen to show">
                <label className="tab"><input className="sr" type="radio" name="dp" value="live" defaultChecked />Public board</label>
                <label className="tab"><input className="sr" type="radio" name="dp" value="console" />Organizer console</label>
                <label className="tab"><input className="sr" type="radio" name="dp" value="player" />Player&rsquo;s board</label>
              </div>
              {DEVICE_SETS.map(([key, desk, mob, url, caption, label]) => (
                <div className="dp-set" data-dp={key} key={key}>
                  <div className="dp-stage">
                    <div className="window dp-window">
                      <div className="win-bar">
                        <div className="dots"><i /><i /><i /></div>
                        <div className="url">{icon("lock")}<span>{url}</span></div>
                        <div className="win-pad" />
                      </div>
                      {shot({ name: desk, variant: d, width: 1600, height: 1000, alt: `${label} on a laptop.` })}
                    </div>
                    <div className="phone dp-phone">
                      <div className="scr">{shot({ name: mob, variant: d, width: 600, height: 1298, alt: "The same screen on a phone." })}</div>
                    </div>
                  </div>
                  <p className="real-note"><i />Real screens · {caption}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ═══════════ THE MONEY ═══════════ */}
        <section className="sec" id="money">
          <div className="wrap money">
            <div className="reveal">
              <div className="sec-head" style={{ marginBottom: 0 }}>
                <span className="kick">The money</span>
                <h2 className="h2">Works it out to the cent. <span className="muted">Never touches it.</span></h2>
                <p className="lead">
                  Skins and pots worked out from the cards as you play, shared costs added alongside, and the lot
                  reduced to the fewest handovers that square everybody. TourneyHQ keeps the record — it never
                  holds, moves or skims a penny.
                </p>
              </div>
              <div className="games">
                <span>Skins with carries</span><span>Nassau</span><span>Low gross &amp; net</span><span>Birdie pot</span>
                <span>Closest to the pin</span><span>Prize fund</span><span>Carts</span><span>Trip costs</span><span>Any currency</span>
              </div>
              <p className="money-note">
                Split evenly, by shares, by exact amounts or by percentage. The club&rsquo;s pot, a foursome&rsquo;s own
                game and a side bet each keep their own players — and a result shows as final only once it can&rsquo;t change.
              </p>
            </div>
            <div className="money-shot reveal">
              <div className="phone">
                <div className="scr">
                  {shot({ name: "phone-money", variant: cur, width: 600, height: 1298, alt: "The player's Money screen: what they're owed, and Settle up — the fewest handovers that make everyone square, each with a Mark settled button." })}
                </div>
              </div>
              <p className="real-note"><i />Real screen · in the club&rsquo;s own currency</p>
            </div>
          </div>
        </section>

        {/* ═══════════ MAKE IT YOURS ═══════════ */}
        <section className="sec paper">
          <div className="wrap">
            <div className="yours-head reveal">
              <div className="sec-head" style={{ marginBottom: 0 }}>
                <span className="kick">Make it yours</span>
                <h2 className="h2">Your colors on every screen <span className="muted">your members see.</span></h2>
                <p className="lead">
                  The organizer screens, the public board and the player app all wear the club&rsquo;s colors — eleven
                  presets, thirteen ready-made pairings, or your own, each checked for how it reads outdoors.
                </p>
              </div>
              <div className="feats yours">
                <div className="feat"><div className="ic">{icon("sun")}</div><div><h4>Checked for sunlight</h4><p>A 7:1 outdoor bar on dark, the readable minimum on light — a warning, not a refusal.</p></div></div>
                <div className="feat"><div className="ic">{icon("moon")}</div><div><h4>Dark, light, or follow the phone</h4><p>Clubhouse at dusk indoors, paper-white in bright sun.</p></div></div>
                <div className="feat"><div className="ic">{icon("star")}</div><div><h4>Your logo, ours stepped back</h4><p>On the {PLANS.club.name} plan your mark leads, with TourneyHQ a small &ldquo;powered by&rdquo; line.</p></div></div>
              </div>
            </div>

            {/* The comparison viewer: the SAME real screen two ways, a divider
                dragged between them (Ajay: "compare apple to apple", "I really
                like the slider for color"). Light vs dark shows fixed captures
                of both appearances; club colors show the default Tournament
                look beside a preset, following the page's Dark / Light switch.
                Every frame is rendered and only the chosen one shown, so the
                tabs are native radios and work without JavaScript. */}
            <div className="compare reveal" role="group" aria-label="The same real screen, compared">
              <div className="seg solid mode" role="radiogroup" aria-label="What to compare">
                <label className="tab"><input className="sr" type="radio" name="cmp-mode" value="ap" defaultChecked />Light vs dark</label>
                <label className="tab"><input className="sr" type="radio" name="cmp-mode" value="col" />Club colors</label>
              </div>
              <div className="seg cmp-tabs" data-set="ap" role="radiogroup" aria-label="Screen to compare">
                {COMPARE_APPEARANCE.map((k, i) => (
                  <label className="tab" key={k}><input className="sr" type="radio" name="cmp-ap" value={k} defaultChecked={i === 0} />{APPEARANCE_LABEL[k]}</label>
                ))}
              </div>
              <div className="seg cmp-tabs" data-set="col" role="radiogroup" aria-label="Color pair to compare">
                {COMPARE_COLOURS.map((k, i) => (
                  <label className="tab" key={k}><input className="sr" type="radio" name="cmp-col" value={k} defaultChecked={i === 0} />{COLOUR_LABEL[k][0]}</label>
                ))}
              </div>

              {COMPARE_APPEARANCE.map((k) => {
                const isWindow = k === "console";
                const variant = k === "money" ? cur : d;
                const name = isWindow ? "hero-console" : `phone-${k}`;
                const [w, hgt] = isWindow ? [1600, 1000] : [600, 1298];
                return (
                  <div className="cmp-f" data-f={`ap-${k}`} key={`ap-${k}`}>
                    <div className={`cmp-frame ${isWindow ? "window" : "phone"}`}>
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
                    <p className="real-note"><i />Real screens · the same screen, both ways</p>
                  </div>
                );
              })}
              {COMPARE_COLOURS.map((k) => {
                const [name, desc] = COLOUR_LABEL[k];
                return (
                  <div className="cmp-f" data-f={`col-${k}`} key={`col-${k}`}>
                    <div className="cmp-frame phone">
                      <div className="cmp-view">
                        {shot({ name: "theme-tournament", variant: d, width: 480, height: 1039, alt: "The Board in the default Tournament colors." })}
                        {shot({ name: `theme-${k}`, variant: d, width: 480, height: 1039, className: "cmp-b", alt: `The same Board in ${name} colors, ${desc}.` })}
                        <input className="cmp-range" type="range" min={0} max={100} defaultValue={50} aria-label={`Drag to compare the default colors and ${name}`} />
                        <span className="cmp-line" aria-hidden="true"><i /></span>
                      </div>
                    </div>
                    <div className="cmp-legend">
                      <span>Tournament · default</span>
                      <span className="cmp-hint">drag to compare</span>
                      <span>{name} · {desc}</span>
                    </div>
                    <p className="real-note"><i />Real screens · one color choice recolors the console, the player app and the public board — the TourneyHQ mark stays orange and green</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ═══════════ EVERYTHING ═══════════ */}
        <section className="sec">
          <div className="wrap idx-all">
            <div className="sec-head center reveal">
              <span className="kick">Everything it does</span>
              <h2 className="h2">The whole list.</h2>
              <p className="lead">Every line below is in the product today.</p>
            </div>
            <div className="idx" id="all-features">
              <div className="idx-col reveal">
                <h3><span className="ic">{icon("trophy")}</span>The competition<em>19</em></h3>
                <ul>
                  {feature("Sixteen formats", "fifteen scored automatically, one leaderboard")}
                  {feature("Slope-and-rating course handicaps", "then the format's allowance")}
                  {feature("Multi-round events", "cuts made as a round closes, carry-forward")}
                  {feature("A warning before a carry mixes units")}
                  {feature("Brackets, flights and a plate", "seeded from live standings")}
                  {feature("Round robin into main & consolation")}
                  {feature("Countback on the last 9, 6, 3, 1")}
                  {feature("A different course per round")}
                  {feature("Divisions off different tees")}
                  {feature("Card certify, approve and dispute")}
                  {feature("Prizes and the honors board")}
                  {feature("Copy last year's, or a template")}
                  {feature("Blind events", "standings hidden until you publish results")}
                  {feature("Card confirmation rules", "a playing partner, the other side, or everyone")}
                  {feature("Concessions and walkovers", "for individual matches")}
                  {feature("A knockout draw for members and the public", "with each player's own line — “lost to …”, “Champion”")}
                  {feature("Order of merit across events", `points, best-of, rounds to qualify — ${PLANS.society.name} and ${PLANS.club.name} plans`)}
                  {feature("Handicaps set per round", "and frozen once cards are in")}
                  {feature("Scoring deadlines per round", "closed, closed early or extended")}
                </ul>
              </div>
              <div className="idx-col reveal">
                <h3><span className="ic">{icon("calendar")}</span>The field &amp; the day<em>17</em></h3>
                <ul>
                  {feature("Registration with open and close dates")}
                  {feature("Waiting list, one-tap member entry")}
                  {feature("Weekly attendance, four ways")}
                  {feature("Tee sheet drawn from who's in", "by handicap, standings or sides — then editable")}
                  {feature("One tee, split tees or a shotgun")}
                  {feature("Tee times pushed to players' phones", "for players who turned notifications on")}
                  {feature("Print the tee sheet and the cards")}
                  {feature("Leagues and interclub leagues")}
                  {feature("Courses looked up with rated tees")}
                  {feature("Messages at every level")}
                  {feature("Pinned announcements")}
                  {feature("A public sign-up link — no account", "auto-confirm to capacity, or approve each entry")}
                  {feature("Invite players from your phone's share sheet", "WhatsApp, text or a copied message")}
                  {feature("The league's “This week” sheet", "movement, who turned out, and a purse check")}
                  {feature("Interclub scoring systems", "match play, holes won, Nassau — pairs per club, play-offs")}
                  {feature("Roster import from a spreadsheet")}
                  {feature("Course card check", "flags a card that's unchecked, missing stroke index, or old")}
                </ul>
              </div>
              <div className="idx-col reveal">
                <h3><span className="ic">{icon("phone")}</span>The player<em>14</em></h3>
                <ul>
                  {feature("Say the score out loud", "where the phone's browser supports it")}
                  {feature("Round codes — no account, no install")}
                  {feature("A card that keeps saving without signal")}
                  {feature("Gross and net per hole, stroke dots")}
                  {feature("Their own line first on the board")}
                  {feature("A public live board, no login, once you publish it")}
                  {feature("Every club event, entered in a tap")}
                  {feature("The club calendar")}
                  {feature("The rules sheet for today's round")}
                  {feature("Adds to the home screen")}
                  {feature("One phone keeps the whole group's card", "each player still signs their own")}
                  {feature("Two phones, one card", "it asks which to keep — never overwrites")}
                  {feature("Players start their own side bets")}
                  {feature("A board that says how fresh it is", "Live or Final")}
                </ul>
              </div>
              <div className="idx-col reveal">
                <h3><span className="ic">{icon("wallet")}</span>Money &amp; the club<em>17</em></h3>
                <ul>
                  {feature("Skins, Nassau, pots and side bets", "skins and Nassau straight off the cards")}
                  {feature("Costs split four ways")}
                  {feature("Fewest handovers, mark settled")}
                  {feature("Any currency")}
                  {feature("One club roster across events")}
                  {feature("Organizers, assistants and guests")}
                  {feature("A record of recent changes")}
                  {feature("Reports and CSV export")}
                  {feature("Your colors, checked for sunlight")}
                  {feature(`White-label on the ${PLANS.club.name} plan`)}
                  {feature("Console controls named for screen readers")}
                  {feature("The kitty and the organizer's ledger", "fees in, costs out — did it balance")}
                  {feature("One-tap prize tables", "top 3, best gross & net, flights, twos, nearest the pin")}
                  {feature("Score import from a spreadsheet", "every row checked against the field first")}
                  {feature("A club handicap record", "from members' own cards — not an official index")}
                  {feature("A tournament can override the club's currency", "nothing is converted")}
                  {feature("Spoken questions at the scoring desk", "handicap, opponent, standing")}
                </ul>
              </div>
            </div>
            <div className="idx-more">
              <label>
                <input className="sr" type="checkbox" aria-controls="all-features" />
                <span className="when-closed">Show all 67 features</span>
                <span className="when-open">Show fewer</span>
              </label>
            </div>
          </div>
        </section>

        {/* ═══════════ HOW IT COMPARES ═══════════
            Named, at Ajay's decision (2026-09-27): the club platforms, side by
            side. EVERY competitor cell is from that company's own website,
            checked 27 September 2026 — golfgenius.com/products/tm and
            tm.bluegolf.com/pricing (+ /features) — and every TourneyHQ cell was
            checked against the code by TourneyHQv2 the same day. Their prices
            are theirs, in US dollars, never converted. No "cheaper" wording.
            RE-CHECK EVERY CELL AND THE DATE before changing any of it, and have
            the named comparison looked over by a lawyer before it ships. */}
        <section className="sec paper" id="compare">
          <div className="wrap">
            <div className="sec-head center reveal">
              <span className="kick">How it compares</span>
              <h2 className="h2">Side by side <span className="muted">with the club platforms.</span></h2>
              <p className="lead">TourneyHQ next to Golf Genius and BlueGolf TM, using what each company publishes on its own website.</p>
            </div>
            <div className="cmp-cards">
              <div className="cell reveal"><div className="big accent">{prices.zero}</div><h3 className="h3">A real free plan</h3><p>Up to {PLANS.free.limits.playersPerEvent} players, every format and the live board. It&rsquo;s free for good, not a trial.</p></div>
              <div className="cell reveal"><div className="big">{prices.zero} setup</div><h3 className="h3">No setup fee</h3><p>Sign up and run your first event the same day. There&rsquo;s nothing to pay to get started.</p></div>
              <div className="cell reveal"><div className="big">Public</div><h3 className="h3">Prices on the page</h3><p>Every plan&rsquo;s price is on this page. You don&rsquo;t have to ask for a quote.</p></div>
              <div className="cell reveal"><div className="big accent">0%</div><h3 className="h3">Never touches the money</h3><p>Every skin, sweep and split is recorded to the cent. TourneyHQ never collects or holds it.</p></div>
            </div>

            <div className="vs reveal">
              <div className="vs-scroll" tabIndex={0} role="region" aria-label="Side-by-side comparison">
                <table className="vs-table">
                  <caption className="sr">TourneyHQ, Golf Genius and BlueGolf TM, side by side</caption>
                  <thead>
                    <tr>
                      <th scope="col"><span className="sr">Feature</span></th>
                      <th scope="col" className="hot">TourneyHQ</th>
                      <th scope="col">Golf Genius</th>
                      <th scope="col">BlueGolf TM</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vsRow("Built for", "Clubs, courses and resorts, plus societies, leagues and one-off outings", "Private clubs, public courses, resorts and associations", "Private clubs, public courses and resorts")}
                    {vsRow(
                      "Price",
                      <>Free · {PLANS.society.name} <b>{prices.society.monthly}/mo</b> · {PLANS.club.name} <b>{prices.club.monthly}/mo</b></>,
                      <>TM Club {prices.usd(1425)} a year<br />TM Premium {prices.usd(4275)} a year</>,
                      <>{prices.usd(495)} to {prices.usd(2495)} a year</>,
                    )}
                    {vsRow("Setup fee", mk("yes", "None"), mk("no", <>{prices.usd(200)} or {prices.usd(500)}, one-time</>), mk("no", <>{prices.usd(99)} to {prices.usd(499)}, one-time</>))}
                    {vsRow("A free plan", mk("yes", `Yes, up to ${PLANS.free.limits.playersPerEvent} players, one tournament at a time. It's not a trial.`), mk("na", "None listed"), mk("na", "None listed"))}
                    {vsRow("Live scoring on players' phones", mk("yes", "On every plan, including Free"), mk("part", "TM Premium only"), mk("part", "Priced by the number of tournaments scored live (1, 10, 25 or all)"))}
                    {vsRow("Score by voice", mk("yes", "Players tap the mic and say their score, or read out the whole card"), mk("na", "Not listed. Its AI assistant (beta) takes voice commands for staff tasks"), mk("na", "Not listed"))}
                    {vsRow("Live leaderboard", mk("yes", "Yes, including a public board with no login, when you publish it"), mk("yes", "Yes; live TV leaderboards on Premium"), mk("yes", "Yes, online and on clubhouse TVs"))}
                    {vsRow("Formats", mk("yes", "16 formats (15 scored automatically, plus ‘Other’ for a club’s own)"), mk("yes", "A full library of formats"), mk("yes", "All popular formats, plus a custom builder"))}
                    {vsRow("Leagues and seasons", mk("yes", `Season standings across separate tournaments (${PLANS.society.name} plan and up)`), mk("yes", "League management and season-long competitions"), mk("yes", "Leagues with season standings"))}
                    {vsRow("Handicap service link (WHS / GHIN)", mk("no", "No"), mk("yes", "Full integration with GHIN"), mk("yes", "Integrated with WHS, including score posting"))}
                    {vsRow("Entry fees and payments", mk("part", "Records who has paid; never collects or holds the money"), mk("part", "Online registration and payment processing on TM Premium"), mk("part", "Registration with built-in payments, on every plan except the base Club plan"))}
                    <tr className="vs-srcrow">
                      <th scope="row">Source</th>
                      <td className="hot">This page</td>
                      <td><a href="https://golfgenius.com/products/tm" rel="nofollow noopener noreferrer" target="_blank">golfgenius.com/products/tm</a></td>
                      <td><a href="https://tm.bluegolf.com/pricing" rel="nofollow noopener noreferrer" target="_blank">tm.bluegolf.com/pricing</a></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="vs-hint" aria-hidden="true">Swipe to see all three →</p>
              <p className="vs-legal">
                Golf Genius and BlueGolf information is from each company&rsquo;s own website as of 27 September 2026.
                Their prices are for facilities in the US and Canada with up to 36 holes, before tax. Prices and
                features change, so check with each provider. Golf Genius and BlueGolf are trademarks of their
                respective owners. TourneyHQ is not affiliated with or endorsed by either company.
              </p>
            </div>
          </div>
        </section>

        {/* ═══════════ PRICING ═══════════
            Read from PLANS through the owner's overrides, in the visitor's
            currency, so the page cannot promise a price or a limit the code
            does not hold. Both periods are rendered and the Monthly / Yearly
            radios choose which shows — no script needed. */}
        <section className="sec" id="pricing">
          <div className="wrap">
            <div className="sec-head center reveal">
              <span className="kick">Pricing</span>
              <h2 className="h2">Priced on your field. <span className="muted">Never per player.</span></h2>
              <div className="seg bill" role="radiogroup" aria-label="Billing period">
                <label className="tab"><input className="sr" type="radio" name="bill" value="m" defaultChecked />Monthly</label>
                <label className="tab"><input className="sr" type="radio" name="bill" value="y" />Yearly <em>2 MONTHS FREE</em></label>
              </div>
              <p className="ed-note">{note}</p>
            </div>
            <div className="tiers">
              <div className="tier reveal">
                <h3>{PLANS.free.name}</h3>
                <p className="for">{PLANS.free.blurb}</p>
                <div className="price"><b>{prices.zero}</b><span>forever</span></div>
                <div className="price-sub">&nbsp;</div>
                <a className="btn btn-ghost" href="#signup">Start free</a>
                <ul>
                  {tick(<>Up to {PLANS.free.limits.playersPerEvent} in a field</>)}
                  {tick("One tournament at a time")}
                  {tick("One organizer")}
                  {tick("Every format, the live board, the money")}
                </ul>
                <p className="note">{retentionNotice("free")}</p>
              </div>
              <div className="tier hot reveal">
                <span className="badge">Leagues</span>
                <h3>{PLANS.society.name}</h3>
                <p className="for">{PLANS.society.blurb}</p>
                <div className="price">
                  <b><span className="per-m">{prices.society.monthly}</span><span className="per-y">{prices.society.yearly}</span></b>
                  <span><span className="per-m">/ month</span><span className="per-y">/ year</span></span>
                </div>
                <div className="price-sub">
                  <span className="per-m">or {prices.society.yearly} a year — two months free</span>
                  <span className="per-y">two months free</span>
                </div>
                <a className="btn btn-solid" href="#signup">Get started</a>
                <ul>
                  {tick(<>Up to {PLANS.society.limits.playersPerEvent} in a field</>)}
                  {tick("As many events as your season runs")}
                  {tick(<>Up to {PLANS.society.limits.staffSeats} organizers</>)}
                  {tick("The season table across the weeks")}
                  {tick(capitalise(retentionSummary(PLANS.society)))}
                </ul>
                <p className="note">Plan changes are arranged with us directly — nothing is charged through the app.</p>
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
                <a className="btn btn-ghost" href="#signup">Get started</a>
                <ul>
                  {tick("An unlimited field")}
                  {tick("As many tournaments as your season runs")}
                  {tick(<>Up to {PLANS.club.limits.staffSeats} organizers and assistants</>)}
                  {tick("Your club's branding, ours removed")}
                  {tick(`Season table · ${retentionSummary(PLANS.club)}`)}
                </ul>
                <p className="note">Plan changes are arranged with us directly — nothing is charged through the app.</p>
              </div>
            </div>
            {/* The top tier is priced by conversation. Honest about what exists:
                the multi-club engine is not built, so this names who it is for
                and that it is scoped with them — no invented limits. */}
            <div className="ultimate reveal">
              <span className="ic">{icon("globe")}</span>
              <div>
                <h3>Associations &amp; corporates</h3>
                <p>Running several clubs, or a corporate golf program? Tell us how you work and we&rsquo;ll scope it with you.</p>
              </div>
              <a className="btn btn-ghost" href={`mailto:${CONTACT_EMAIL}?subject=TourneyHQ%20for%20our%20organization`}>Talk to us</a>
            </div>
            <p className="metered">
              Text alerts, reading a photographed card and drafted commentary are built and not switched on for
              anybody yet — they cost per message and per call, and we won&rsquo;t bill for them until they&rsquo;re worth it.
            </p>
          </div>
        </section>

        {/* ═══════════ QUESTIONS ═══════════
            Eight here, all of them on /faq — the same answers, from one module. */}
        <section className="sec paper" id="faq">
          <div className="wrap faq">
            <div className="sec-head reveal" style={{ alignContent: "start" }}>
              <span className="kick">Common questions</span>
              <h2 className="h2">What organizers ask first.</h2>
              <p className="lead">The eight we hear most. {FAQ_COUNT} in all — handicaps, leagues, the money, plans — on the full page.</p>
              <div className="faq-more" style={{ marginTop: 4 }}>
                <a className="btn btn-ghost" href="/faq">See all {FAQ_COUNT} questions {icon("arrow", "i i-sm arr")}</a>
              </div>
            </div>
            <div className="reveal">
              {LANDING_FAQ_IDS.map((id) => {
                const item = faqItem(id);
                return (
                  <details className="q" key={id}>
                    <summary>{item.q}<span className="pm" aria-hidden="true">+</span></summary>
                    <div className="ans">{item.a(ctx)}</div>
                  </details>
                );
              })}
              <div className="faq-more"><small>Didn&rsquo;t find it? <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></small></div>
            </div>
          </div>
        </section>

        {/* ═══════════ SIGN UP / SIGN IN ═══════════ */}
        <section className="close">
          <div className="wrap">
            <div className="cta-card reveal">
              <span className="anchor" id="signup" aria-hidden="true" />
              <span className="anchor" id="signin" aria-hidden="true" />
              <span className="eyebrow"><i />Free to start · no setup fee</span>
              <h2 className="h1">Your next event, <span className="grad">sorted.</span></h2>
              <p className="lead">
                A name is enough to start. No card — and with round codes on, your players don&rsquo;t need an
                account. Organizers create an event here; players invited to one sign in with the same box.
              </p>
              <div className="authpanel" style={{ width: "min(460px, 100%)", textAlign: "left" }}>
                <LandingAuth />
              </div>
              <div className="store-block">
                <div className="stores">
                  {storeButton("ios", STORE_LINKS.ios)}
                  {storeButton("android", STORE_LINKS.android)}
                </div>
                <p className="stores-note">Until then it installs straight from the browser — add it to your home screen and it opens like an app.</p>
              </div>
            </div>
          </div>
        </section>
      </main>

      {landingFooter("home", note)}
    </div>
  );

  return inDialect(page, editionSwaps(shown));
}



/** One row of the comparison table: TourneyHQ first, then the two platforms. */
function vsRow(label: string, ours: React.ReactNode, golfGenius: React.ReactNode, blueGolf: React.ReactNode) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td className="hot">{ours}</td>
      <td>{golfGenius}</td>
      <td>{blueGolf}</td>
    </tr>
  );
}

/** A cell's mark — yes, no, partly, or not listed — and its words. The mark is decoration; the words say it. */
function mk(kind: "yes" | "no" | "part" | "na", text: React.ReactNode) {
  const glyph = { yes: "✓", no: "✕", part: "◐", na: "—" }[kind];
  return (
    <>
      <span className={`vs-mk ${kind}`} aria-hidden="true">{glyph}</span>
      {text}
    </>
  );
}

/** An app-store button: "Coming soon" and inert until its listing exists, then a real link. */
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
    <span className="store" aria-disabled="true">{inner}</span>
  );
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
