import type { ReactNode } from "react";
import Link from "next/link";
import { PLANS, retentionNotice } from "@/lib/plans";
import { HANDICAP_EXAMPLE } from "./example";
import type { LandingPrices } from "./pricing";

/**
 * EVERY QUESTION THE FRONT DOOR ANSWERS, in one place.
 *
 * `/` shows eight of them and `/faq` shows all of them, and both read this
 * module — so the landing's answer and the full page's answer to the same
 * question cannot say two different things. Each was checked against the app
 * on 2026-09-27 (TourneyHQv2 verified the voice, format and allowance wording
 * against the code), and anything that is a number here is READ rather than
 * typed: plan limits and seats from `PLANS`, prices from `landingPrices`, the
 * worked handicap from the scoring engine, the Free plan's retention term from
 * `retentionNotice`.
 *
 * Written in US English; the page swaps the words for the visitor's edition.
 */

export interface FaqContext {
  prices: LandingPrices;
  /** The address people write to, or null while it cannot receive mail (see CONTACT_EMAIL_LIVE). */
  email: string | null;
}

export interface FaqItem {
  /** Stable, for links and for choosing the landing's eight. */
  id: string;
  q: string;
  a: (c: FaqContext) => ReactNode;
}

export interface FaqGroup {
  id: string;
  title: string;
  desc: string;
  items: FaqItem[];
}

const free = PLANS.free.limits;
const season = PLANS.society.limits;
const club = PLANS.club.limits;
const hc = HANDICAP_EXAMPLE;

/** The sixteen format names, as the app names them. Never swapped for an edition. */
export const FORMAT_NAMES = [
  "Stroke Play", "Stableford", "Modified Stableford", "Match Play", "Four-Ball", "Best Ball", "Foursomes",
  "Alternate Shot", "Greensomes", "Chapman / Pinehurst", "Shamble", "Scramble", "Texas Scramble", "Skins", "Nassau",
  "Other, scored by hand",
] as const;

export const FAQ: FaqGroup[] = [
  {
    id: "start",
    title: "Getting started",
    desc: "From a name to a first tee time.",
    items: [
      {
        id: "setup",
        q: "How much do I have to set up to get going?",
        a: () => <p>A name is enough to start. Dates, course, the field and the format come after — and every one of them stays editable, right through the event.</p>,
      },
      {
        id: "try-free",
        q: "Can I try it for free?",
        a: () => (
          <p>
            Yes. The {PLANS.free.name} plan runs one tournament at a time with up to {free.playersPerEvent} players and one
            organizer — every format, the live board and the money side included. There&rsquo;s no card to start.
          </p>
        ),
      },
      {
        id: "reuse",
        q: "Can I reuse last year's tournament?",
        a: () => <p>Copy it in a click. Every setting — flights, rounds, format, prizes — carries over to a fresh event; last year&rsquo;s scores never do. You can also start from a template.</p>,
      },
      {
        id: "team",
        q: "Can more than one of us run it?",
        a: () => (
          <>
            <p>
              Yes. Invite organizers and assistants to run the day alongside you, all working from the same live event, so the
              scoring desk and the first tee are never out of step. Somebody helping for just one event can join as a guest, and a
              guest doesn&rsquo;t use a seat.
            </p>
            <p>
              Seats: {free.staffSeats} on {PLANS.free.name}, {season.staffSeats} on {PLANS.society.name}, {club.staffSeats} on {PLANS.club.name}.
            </p>
          </>
        ),
      },
      {
        id: "course",
        q: "Can we look up our course?",
        a: () => (
          <>
            <p>Search for it and its card and rated tee sets arrive with it. Where the public data can&rsquo;t be trusted we say so and leave the card blank, rather than hand you a par nobody has played.</p>
            <p>A round can also be played at a different course from the rest of the event, and it&rsquo;s scored off the card actually played.</p>
          </>
        ),
      },
    ],
  },
  {
    id: "players",
    title: "Players",
    desc: "What your members need — which is very little.",
    items: [
      {
        id: "app",
        q: "Do players need to download an app?",
        a: () => <p>No. Players open a link — or type the round&rsquo;s code — to see the board and enter scores, with nothing to install and no app store. It adds to the home screen if they want it, and their card keeps saving when the signal on the course doesn&rsquo;t.</p>,
      },
      {
        id: "stores",
        q: "Is there an iPhone or Android app?",
        a: () => <p>Not in the App Store or Google Play today. It installs straight from the browser: add it to your home screen and it opens in its own window, with no browser bar, on iPhone and Android alike.</p>,
      },
      {
        id: "account",
        q: "Do players need an account?",
        a: () => <p>No. Turn on round codes for a tournament and a player types an eight-character code to reach their card — no account, no password. The code leaves out letters that look alike, so nobody squints at an O and a 0 on the first tee.</p>,
      },
      {
        id: "signal",
        q: "What if there's no signal on the course?",
        a: () => <p>The card saves as you go — there&rsquo;s no Save button to forget. Your card keeps saving without signal (it works offline): holes are kept on the phone and sent as soon as the signal is back. If the card was changed in the meantime, you&rsquo;re asked which to keep — it never silently overwrites.</p>,
      },
      {
        id: "voice",
        q: "Can players say their scores instead of typing?",
        a: () => <p>Yes — say &ldquo;four&rdquo;, &ldquo;par&rdquo; or &ldquo;bogey&rdquo; on the hole, or read the whole card out in one go. Tap the mic, speak, and it stops listening when you finish. TourneyHQ keeps the scores, not what you said. It works where the phone&rsquo;s browser supports speech recognition.</p>,
      },
      {
        id: "own-scores",
        q: "Can players enter their own scores?",
        a: () => <p>Yes — hole by hole between shots, or the whole card at once to check against the paper one. Or keep the cards with your staff and enter them yourselves. Either way, standings update on every device as cards come in.</p>,
      },
      {
        id: "tee-time",
        q: "How do players find out their tee time?",
        a: () => <p>Publish the tee sheet and each player&rsquo;s time is sent to their phone, if they&rsquo;ve turned notifications on. It&rsquo;s on their Today screen too, with their group — no email nobody opens, no group chat to scroll.</p>,
      },
      {
        id: "follow",
        q: "Can family and friends follow along?",
        a: () => <p>Share the public leaderboard link — on the clubhouse screen, in the group chat. There&rsquo;s no login, it shows names and scores only, and nothing appears until you publish.</p>,
      },
      {
        id: "player-view",
        q: "What does a player actually see?",
        a: () => (
          <>
            <ul>
              <li><strong>Today</strong> — their round, tee time, group, and the club&rsquo;s pinned notices</li>
              <li><strong>Board</strong> — their own line first, and the column says whether it&rsquo;s strokes, points or match play</li>
              <li><strong>My card</strong> — opens on the hole they&rsquo;re playing</li>
              <li><strong>Events</strong> — every tournament the club runs, entered in a tap</li>
            </ul>
            <p>A Money tab appears when the event splits costs. All of it in the club&rsquo;s own colors.</p>
          </>
        ),
      },
    ],
  },
  {
    id: "scoring",
    title: "Formats & scoring",
    desc: "Every format keeps its own rules.",
    items: [
      {
        id: "formats",
        q: "What formats can we run?",
        a: () => (
          <>
            <p>Sixteen. Fifteen are scored automatically, plus &lsquo;Other&rsquo; for a club&rsquo;s own format, scored by hand. All settle onto one leaderboard:</p>
            <div className="fmts" data-no-dialect="">
              {FORMAT_NAMES.map((f) => <span key={f}>{f}</span>)}
            </div>
          </>
        ),
      },
      {
        id: "handicaps",
        q: "How are course handicaps calculated?",
        a: () => (
          <>
            <p>To the published World Handicap System method, from the tee&rsquo;s own rating and slope then the format&rsquo;s allowance: the published one where there is one, and a common club convention for scrambles and shambles. Never the raw index.</p>
            <div className="hc">
              <span>Handicap index</span><span>{hc.index.toFixed(1)}</span>
              <span>Course rating / slope</span><span>{hc.tee.courseRating} / {hc.tee.slopeRating}</span>
              <span>Course handicap</span><span>{hc.course}</span>
              <span>Four-ball allowance</span><span>{hc.allowance}%</span>
              <span className="t">Playing handicap</span><span className="t">{hc.playing}</span>
            </div>
            <p>Done for every player, every round. A tee with no rating says so rather than guessing.</p>
          </>
        ),
      },
      {
        id: "official",
        q: "Is this an official handicap?",
        a: () => <p>No. TourneyHQ works out each player&rsquo;s course and playing handicap for the round, from the index you give it. It doesn&rsquo;t calculate, post or look up an official handicap index — that stays with your golf association, and TourneyHQ never overwrites it.</p>,
      },
      {
        id: "divisions",
        q: "Can divisions play off different tees?",
        a: () => <p>Yes. Set the tees once per division — the championship off the blues, the seniors off the whites — and the course handicap does the rest, all on one leaderboard. Or set one tee for everyone, or let players choose until a card is returned.</p>,
      },
      {
        id: "ties",
        q: "How are ties broken?",
        a: () => <p>On countback — the last 9, 6, 3 and 1 holes — and shown as a tie until something separates them. A card that isn&rsquo;t complete never loses on countback.</p>,
      },
      {
        id: "cut",
        q: "Can we run a multi-round event with a cut?",
        a: () => <p>Yes. A stroke-play cut — &ldquo;top 16 and ties&rdquo;, say — is made as its round is marked finished, and scores can carry forward into the next round. Everyone tied at the cut line goes through, and players who miss it keep their scores, listed beneath the field. Try to carry a round into one scored differently, strokes into points, and it warns you and won&rsquo;t combine them.</p>,
      },
      {
        id: "brackets",
        q: "Can we run match play and brackets?",
        a: () => <p>One bracket, two flights, or a main draw with a plate, seeded from live standings with byes handled. A round robin can feed a main and a consolation knockout.</p>,
      },
    ],
  },
  {
    id: "results",
    title: "Results",
    desc: "Numbers a committee can stand behind.",
    items: [
      {
        id: "dispute",
        q: "What happens if a score is disputed?",
        a: () => <p>Cards move through entered, certified and approved. A disputed card is set aside and named — never quietly counted — and a disputed result can&rsquo;t settle the money or finish the tournament until it&rsquo;s resolved.</p>,
      },
      {
        id: "export",
        q: "Can we print, or export the results?",
        a: () => <p>Print the tee sheet and scorecards laid out as they are on paper — club mark, par and stroke index where you expect them. Export results as a spreadsheet file that&rsquo;s made safe to open: a name beginning with &ldquo;=&rdquo; stays a name, not a formula.</p>,
      },
    ],
  },
  {
    id: "leagues",
    title: "Leagues",
    desc: "A season, not twelve separate evenings.",
    items: [
      {
        id: "league",
        q: "Can we run a weekly league?",
        a: () => (
          <>
            <p>Yes. Choose how each week&rsquo;s field is decided:</p>
            <ul>
              <li>everyone plays every week</li>
              <li>in unless they opt out — the standing league</li>
              <li>out unless they opt in — the drop-in league</li>
              <li>captains send the list and the club enters it</li>
            </ul>
            <p>Players answer on their phones and the tee sheet is drawn from who&rsquo;s in — then it&rsquo;s yours to adjust.</p>
          </>
        ),
      },
      {
        id: "missed-week",
        q: "What if somebody misses a week?",
        a: () => <p>They show as having played fewer rounds — never as having scored nothing.</p>,
      },
      {
        id: "playoff",
        q: "In an interclub league, what if a play-off meeting ends level?",
        a: () => <p>It&rsquo;s settled by a play-off hole. The organizer records who won it, and the next round&rsquo;s draw waits until they do — nobody is sent through on a guess.</p>,
      },
      {
        id: "interclub",
        q: "Do you support interclub leagues?",
        a: () => <p>Yes — clubs as flights, weekly pairs, meetings and a table. Clubs level on points share the place; your own tie-break chain sets the order they&rsquo;re listed in and the play-off seeding, never the alphabet.</p>,
      },
    ],
  },
  {
    id: "money",
    title: "Money",
    desc: "Worked out to the cent. Never touched.",
    items: [
      {
        id: "money",
        q: "Does TourneyHQ handle our money?",
        a: () => <p>It works every amount out and keeps the record — skins, pots, entry fees, shared costs — and never holds, moves or takes a cut of any of it. There&rsquo;s no pay button; it reduces everything to the fewest handovers, and you mark each one settled when it&rsquo;s done.</p>,
      },
      {
        id: "trip",
        q: "Can it split the costs of a trip?",
        a: () => <p>Yes — evenly, by shares, by exact amounts or by percentage, and each cost carries its own people: everyone shares the rooms, only the three at the bar share the bar. Somebody who paid a bill they weren&rsquo;t part of is credited what they laid out and owes none of it. Golf winnings and trip costs net into one balance.</p>,
      },
      {
        id: "club-money",
        q: "We're a golf club — do we have to split costs?",
        a: () => <p>No. By default a club&rsquo;s entry fees and prizes are handled by the club, the way they are now, and the app keeps the results. Skins and side games still work. A club — or a single tournament — can switch cost-splitting on whenever it wants it.</p>,
      },
      {
        id: "currency",
        q: "What currencies does it support?",
        a: () => <p>Any currency, set once for the club, with every amount worked to that currency&rsquo;s smallest unit.</p>,
      },
    ],
  },
  {
    id: "club",
    title: "Your club",
    desc: "Your look, your members' privacy.",
    items: [
      {
        id: "branding",
        q: "Can we use our own colors and logo?",
        a: () => <p>Choose from eleven colors, thirteen ready-made pairings, or your own — and they carry across the organizer screens, the player app and the public board. Each is checked for how it reads outdoors before you choose it. On the {PLANS.club.name} plan your own logo sits on it too, with TourneyHQ stepped back to a small &ldquo;powered by&rdquo; line.</p>,
      },
      {
        id: "privacy",
        q: "Is our members' information kept private?",
        a: () => <p>Contact details never appear on the public leaderboard — it carries names and scores only, and nothing is visible at all until you choose to publish. Your roster stays yours.</p>,
      },
    ],
  },
  {
    id: "plans",
    title: "Plans & pricing",
    desc: "Priced on your field, never per player.",
    items: [
      {
        id: "cost",
        q: "How much does it cost?",
        a: ({ prices }) => (
          <>
            <div className="tierlist">
              <div><b>{PLANS.free.name}</b><span>{prices.zero}</span><small>up to {free.playersPerEvent} players · one tournament at a time</small></div>
              <div><b>{PLANS.society.name}</b><span>{prices.society.monthly}/mo</span><small>up to {season.playersPerEvent} a field · unlimited events</small></div>
              <div><b>{PLANS.club.name}</b><span>{prices.club.monthly}/mo</span><small>any size of field · your branding</small></div>
            </div>
            <p>Pay yearly and two months are free — {prices.society.yearly} a year or {prices.club.yearly} a year. A player never pays.</p>
          </>
        ),
      },
      {
        id: "compare",
        q: "How does TourneyHQ compare with other golf software?",
        a: () => (
          <p>
            See the <Link href="/#compare">side-by-side on the home page</Link>: the club platforms Golf Genius and BlueGolf TM,
            and the league and group apps Squabbit, Golf GameBook and LeagueGolfer. Every figure there is from each
            company&rsquo;s own website, dated.
          </p>
        ),
      },
      {
        id: "card",
        q: "Do I need a credit card?",
        a: () => <p>No card to start. Nothing is charged through the app — moving to a paid plan is arranged with us directly.</p>,
      },
      {
        id: "setup-fee",
        q: "Is there a setup fee?",
        a: () => <p>No. There&rsquo;s nothing to pay to get started, and the prices are published right here rather than quoted on request.</p>,
      },
      {
        id: "free-kept",
        q: "What happens to a finished tournament on the Free plan?",
        a: () => <p>{retentionNotice("free")}</p>,
      },
      {
        id: "metered",
        q: "What about text alerts, reading a photographed card, or AI commentary?",
        a: () => (
          <p>
            All three are built and not switched on for anybody yet. They cost us per message and per call, so they
            will come with {PLANS.club.name} first, once they&rsquo;re worth billing for.
          </p>
        ),
      },
      {
        id: "several-clubs",
        q: "We run several clubs, or a corporate golf program.",
        a: ({ email }) =>
          email ? (
            <p>Tell us how you work — <a href={`mailto:${email}`}>{email}</a> — and we&rsquo;ll scope it with you.</p>
          ) : (
            <p>
              That is {PLANS.enterprise.name}, priced with each organization rather than published — our contact
              address opens soon. Until then, each club can run on {PLANS.club.name}.
            </p>
          ),
      },
    ],
  },
];



/** The eight the front door shows, in the order it shows them. */
export const LANDING_FAQ_IDS = ["app", "cost", "money", "handicaps", "league", "formats", "team", "privacy"] as const;

export const FAQ_COUNT = FAQ.reduce((n, g) => n + g.items.length, 0);

export function faqItem(id: string): FaqItem {
  for (const g of FAQ) for (const item of g.items) if (item.id === id) return item;
  throw new Error(`No FAQ item "${id}"`);
}
