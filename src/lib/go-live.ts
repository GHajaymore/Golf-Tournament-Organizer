/**
 * THE ONE GO-LIVE SWITCH — every pre-launch state, and both of its wordings, in one place.
 *
 * Ajay, 2026-10-23: "I just need one switch to say let's go live and that should change coming soon
 * or any blockades to online." The switch already existed (the Accounts card on /owner, read through
 * `signInsHeld`), and most screens asked it — but each held its OWN live words inline, a few held
 * no live words at all (/interest said "Opening soon" for ever), and nothing listed what one press
 * changed. So he could not rely on it.
 *
 * This module is that list and those words:
 *
 *   - `LaunchState` is the one answer — "held" or "live" — and every screen below takes it as a
 *     REQUIRED argument, so a new caller is found by the compiler, never by a visitor.
 *   - Every word a screen says differently held and live is here, both ways. A screen picks with
 *     the state; it never writes either wording itself (`go-live-words-live-here.test.ts`).
 *   - `LAUNCH_SURFACES` is the inventory: what each place shows held, what it shows live. The owner
 *     card's "Pressing Go live will:" is built from it, `docs/go-live-switch.md` carries the same
 *     table, and the browser sweep (`e2e/go-live-switch.spec.ts`) walks every `probe` both ways.
 *   - `NOT_SWITCHED` is what deliberately does NOT move with it, and why.
 *
 * Where the state comes from is unchanged: `signInsHeld()` in `services/signins-switch.ts` — the
 * deploy's rule (`signInsClosed`), unless the owner pressed Go live — and a database fault keeps the
 * hold. Pure: no server import, so the owner card (a client component) reads the same list.
 *
 * Held, the words are the marketing panel's (2026-10-21): the manager wrote them and the ad director
 * checked them as an ad's landing page. Never the word "closed" on screen.
 */
import { PLANS } from "@/lib/plans";
import { SALES_EMAIL } from "@/lib/contact";
import type { HoldRule } from "@/lib/sign-in-gate";

/** The one answer. Held: accounts held for launch. Live: TourneyHQ is open to everybody. */
export type LaunchState = "held" | "live";

/** From the switch's yes/no, as `signInsHeld()` answers it. */
export function launchStateOf(held: boolean): LaunchState {
  return held ? "held" : "live";
}

const FREE_FIELD = PLANS.free.limits.playersPerEvent;

/* ─────────────────────────── held: the sign-in doors ─────────────────────────── */

/** What a person is told when they try. Points a player at the one door that is open. */
// Never the word "closed" (Ajay: "instead of closed can we say not opened yet
// or something better?"): a visitor is told what is coming, not shut out.
// Worded by the panel's marketing manager, 2026-10-21; "under development" went on the ad director's
// word — Google reads an "under construction" page as a reason to refuse the ad that lands on it.
export const SIGNINS_CLOSED_MESSAGE =
  "TourneyHQ opens soon. Sign-ups are paused until launch. Playing today? Go to tourneyhq.club/play and enter your organizer's round code.";

/*
 * Said ABOVE the sign-in box while it is held (Ajay: "if we are blocking we can put a message about
 * under development"), so nobody fills in a form to be refused at the end of it.
 *
 * THE WORDS ARE THE MARKETING PANEL'S (2026-10-21, Ajay: "always involve the experts"). The marketing
 * manager wrote them and the ad agency creative director checked them as an ad's landing page:
 * "paused", not "under development"; the 25% leads; its terms sit right under it, because an offer
 * on an ad's destination needs its terms on the same page. The CODE is never printed (Ajay: "do not
 * publish the discount code") — it is emailed at launch.
 */
export const SIGNINS_CLOSED_NOTICE = {
  lead: "TourneyHQ opens soon.",
  body: "Sign-ups are paused until launch while we add the finishing touches.",
  offer: "Get 25% off your first term. Join the early list and we'll email your code at launch, good on the paid plan you choose.",
  // The way in is the /interest form; the address stays for anybody who would rather write.
  joinLink: "Join the early list",
  emailLead: "Rather email? Write to",
  interestedEmail: SALES_EMAIL,
  interestedSubject: "Early list: 25% off at launch",
  // "First term" is the term they sign up on (Ajay, 2026-10-21): billing takes the percent off the
  // first invoice only (`domain/discount.ts`, a Stripe coupon with duration "once").
  terms: "25% off the first term of one paid plan: your first month if you pay monthly, your first year if you pay yearly. For clubs that join the early list before launch. One code per club, emailed at launch.",
  playLead: "Playing today?",
  playLink: "Go to tourneyhq.club/play",
  playTail: "and enter your organizer's round code.",
} as const;

/** The front door's own words while held (the marketing manager's). */
export const HELD_FRONT_DOOR = {
  heading: "Opening soon. Get in early.",
  lead: "New accounts open at launch. Register your interest now and we'll email you 25% off your first paid term. Got a round code? You can play today.",
  // The one quiet way in for the owners, folded under the notice: no login boxes for a visitor.
  // The UI/UX designer and the ad director: not "Team" (a golf team presses it), not "Staff" alone
  // (a club's secretaries are staff too, and are held out) — "TourneyHQ" says who it is for.
  staffLink: "TourneyHQ staff sign-in",
  signInTitle: "TourneyHQ staff",
  signInSub: "Sign in with your TourneyHQ account. Club accounts open at launch.",
  pricingNote: "Paid plans start at launch. Join the early list now and we'll email you 25% off your first term.",
  // The ad director: a button that promises "Start free" and lands on a paused door reads as bait.
  // And not "Get early access" (second round): joining gets a code, not use of the app before launch.
  cta: "Join the early list",
  // The ad director's second placement, in the hero's announcement pill.
  pill: "Opening soon: join the early list for 25% off your first term",
  // The facts under the hero while held. "Free for fields of up to 10" and "No card" are out: the
  // free plan is not offered until launch (Ajay: "I dont want it until go live") and its limits are
  // not yet enforced, and "No card" read as a trial there is not.
  facts: ["Handicaps by the Rules", "No app for players"],
  // The free plan's card: no date, and no 25% — the code is for paid plans.
  freeCard: "Opens at launch.",
  // "Join for", not "Claim": the discount is emailed at launch, not handed over now.
  planButton: (plan: string) => `Join for 25% off ${plan}`,
} as const;

/* ─────────────────────────── the front door, both ways ─────────────────────────── */

/** Every word the front door (and its nav on /faq, /privacy, /terms, /interest) says by the switch. */
export interface FrontDoorWords {
  /** Where every "start" button goes. `home` is "" on `/` and "/" on the other public pages. */
  startHref: (home: string) => string;
  /** The top bar's button. */
  navCta: string;
  /** The hero's and the phone dock's first button. */
  heroCta: string;
  /** The hero's announcement pill: an optional badge, the words, and where it leads. */
  pill: { badge: string | null; text: string; href: string };
  /** The short facts under the hero. */
  facts: readonly string[];
  /** The free plan's card: the line under its price, and its button. */
  freeYear: string;
  freeButton: string;
  /** A paid plan's button. */
  planButton: (plan: string) => string;
  /** The sentence under the plans, before "Nothing is charged through the app." */
  pricingNote: string;
  /** The closing section, above the sign-up and sign-in box. */
  closeHeading: string;
  closeLead: string;
  /** /faq's last call to action, drawn only while the contact address cannot receive mail. */
  faqCta: { heading: string; body: string; button: string };
}

export const FRONT_DOOR: Record<LaunchState, FrontDoorWords> = {
  held: {
    startHref: () => "/interest",
    navCta: HELD_FRONT_DOOR.cta,
    heroCta: HELD_FRONT_DOOR.cta,
    pill: { badge: null, text: HELD_FRONT_DOOR.pill, href: "/interest" },
    facts: HELD_FRONT_DOOR.facts,
    freeYear: HELD_FRONT_DOOR.freeCard,
    freeButton: HELD_FRONT_DOOR.cta,
    planButton: HELD_FRONT_DOOR.planButton,
    pricingNote: HELD_FRONT_DOOR.pricingNote,
    closeHeading: HELD_FRONT_DOOR.heading,
    closeLead: HELD_FRONT_DOOR.lead,
    faqCta: { heading: HELD_FRONT_DOOR.heading, body: HELD_FRONT_DOOR.lead, button: HELD_FRONT_DOOR.cta },
  },
  // The words the front door said open before 2026-10-23, moved here unchanged.
  live: {
    startHref: (home) => `${home}#signup`,
    navCta: "Start free",
    heroCta: "Run an event",
    pill: { badge: "New", text: "Ryder-style cups, on every player’s phone", href: "#does" },
    facts: [`Free for fields of up to ${FREE_FIELD}`, "No card", "No app for players"],
    freeYear: "Free for good",
    freeButton: "Start free",
    planButton: (plan) => `Choose ${plan}`,
    pricingNote: "Paid plans are arranged with us directly: create your account and we move it to the plan.",
    closeHeading: "Run your first event.",
    closeLead:
      "A name is enough to start. No card, and with round codes on your players don’t need an account. Organizers create an event here; players invited to one sign in with the same box.",
    faqCta: { heading: "The quickest answer is to try it.", body: `Free for up to ${FREE_FIELD} players, with no card and no setup fee.`, button: "Start free" },
  },
};

/** The front door's words for the switch's answer. */
export function frontDoorWords(state: LaunchState): FrontDoorWords {
  return FRONT_DOOR[state];
}

/* ─────────────────────────── /faq, both ways ─────────────────────────── */

/**
 * The two answers on /faq that offer the free plan. Held, the front door has taken "Free for fields
 * of up to 10" and "No card" down (Ajay: "I dont want it until go live") — and /faq went on saying
 * "Yes … There's no card to start" to the same visitor until 2026-10-23.
 */
export function faqWords(state: LaunchState): { tryFree: string; card: string } {
  const plan = `The ${PLANS.free.name} plan`;
  const what = `one tournament at a time with up to ${FREE_FIELD} players and one organizer — every format, the live board and the money side included.`;
  const charged = "Nothing is charged through the app — moving to a paid plan is arranged with us directly.";
  return state === "held"
    ? {
        tryFree: `Not yet: the ${PLANS.free.name} plan opens at launch. It will run ${what} Playing today? A round code needs no account.`,
        card: `No. ${charged}`,
      }
    : {
        tryFree: `Yes. ${plan} runs ${what} There’s no card to start.`,
        card: `No card to start. ${charged}`,
      };
}

/* ─────────────────────────── /interest, both ways ─────────────────────────── */

export interface InterestWords {
  kicker: string;
  h1: string;
  sub: string;
  /** The page's search and share description. */
  description: string;
  /** A way straight in, shown under the bullets once accounts are open. */
  createLink: { text: string; href: string } | null;
  /** Said under the form. */
  reassure: string;
  /** Said after a note is sent. */
  sent: (name: string, email: string) => string;
  /** Said to an organizer after a note is sent, with the link the button copies. */
  share: string;
  shareUrl: string;
  /** The line in the copy sent to inquiries@: what this person was promised. */
  toldInquiries: string;
}

export const INTEREST_PAGE: Record<LaunchState, InterestWords> = {
  // Worded with the panel's marketing manager (2026-10-21).
  held: {
    kicker: "Opening soon",
    h1: "Be first on the tee when TourneyHQ opens",
    sub: "Register now and we'll email you a code for 25% off the paid plan you choose at launch. It covers your first term: your first month, or your first year if you pay yearly.",
    description: "Register your interest in TourneyHQ and get a code for 25% off your first term when it opens.",
    createLink: null,
    reassure: "We'll use these details only to tell you when TourneyHQ opens, to send your code, and — if you leave a number — to call you about your events. We never sell them, and we'll delete them whenever you ask.",
    sent: (name, email) => `Thanks, ${name}, you're on the list. We'll email ${email} when TourneyHQ opens, with your 25% code inside. Nothing else until then.`,
    share: "Know another club or society that runs competitions? Send them tourneyhq.club/interest and they'll get the same offer.",
    shareUrl: "https://tourneyhq.club/interest",
    toldInquiries: "They were told they will be emailed a code for 25% off their first term when TourneyHQ opens. Reply to this email to write to them.",
  },
  // Once live the early list is over (its terms: "for clubs that join the early list before launch"),
  // so the page says so and points at the front door; the form stays, for a club that would rather
  // talk first. Written 2026-10-23 for the go-live switch — for Ajay's preview with the landing.
  live: {
    kicker: "Now open",
    h1: "Tell us about your club",
    sub: "TourneyHQ is open: create your account on the front page and run your first event today. Or leave your details here and we'll be in touch about your club's events.",
    description: "TourneyHQ is open. Create your account, or tell us about your club and we'll be in touch.",
    createLink: { text: "Set up your club", href: "/#signup" },
    reassure: "We'll use these details only to answer you and — if you leave a number — to call you about your events. We never sell them, and we'll delete them whenever you ask.",
    sent: (name, email) => `Thanks, ${name}. We'll be in touch at ${email} about your club's events.`,
    share: "Know another club or society that runs competitions? Send them tourneyhq.club.",
    shareUrl: "https://tourneyhq.club",
    toldInquiries: "They wrote after launch, so no early-list code was promised. Reply to this email to write to them.",
  },
};

/** /interest's words for the switch's answer. */
export function interestWords(state: LaunchState): InterestWords {
  return INTEREST_PAGE[state];
}

/* ─────────────────────────── the owner card ─────────────────────────── */

/** The owner card's own words (`components/OwnerAccounts.tsx`). */
export const OWNER_CARD = {
  title: "Accounts",
  held: "Held until launch. Visitors see “opening soon”; only you can sign in, and nobody can sign up.",
  live: (since: string) => (since ? `Live since ${since}. Anybody can sign up and sign in.` : "Live. Anybody can sign up and sign in."),
  willGoLive: "Pressing Go live will:",
  willHold: "Pressing Hold again will:",
  goLive: "Go live",
  holdAgain: "Hold again",
  goLiveTitle: "Go live: open TourneyHQ to everybody",
  holdTitle: "Hold TourneyHQ again until launch",
  goLiveConfirm: "Yes, go live",
  holdConfirm: "Yes, hold again",
  goLiveNote: (n: number) =>
    `Anybody can sign up and sign in, and every page drops “opening soon” — the ${n} changes listed on the card, on the next page anybody opens. You can hold it again here.`,
  holdNote: "Everybody but you is signed out at their next page, and every page says “opening soon” again.",
  wentLive: "TourneyHQ is live. Every page now shows the open words.",
  heldAgain: "Held again. Only you can sign in.",
  keepHeld: "Keep it held",
  keepLive: "Keep it live",
  notSwitched: "Not changed by this switch",
  /** Said when this deployment does not let the switch decide (`holdRule`). */
  rule: {
    holds: "",
    "signins-open": "SIGNINS=open is set in Vercel, so TourneyHQ is live here whatever this switch says. Remove it, and redeploy, to let this switch decide.",
    "no-owners": "OWNER_EMAILS is empty here, so nothing is held: holding with nobody let through would lock everybody out. Production reads the switch.",
    "not-production": "This deployment never holds accounts (it is not production), so here the switch changes nothing. Production reads it.",
  } satisfies Record<HoldRule, string>,
} as const;

/* ─────────────────────────── the inventory ─────────────────────────── */

/** A place that is different while held. */
export interface LaunchSurface {
  id: string;
  /** Where it is, for a person. */
  where: string;
  /** What it shows held, and what it shows live — both read as what happens. */
  held: string;
  live: string;
  /**
   * Whether it already asked the switch before 2026-10-23 (it did, but held its live words itself),
   * or was wired that day. For the record in `docs/go-live-switch.md`; nothing branches on it.
   */
  before: "followed" | "wired";
  /**
   * What the browser sweep looks for: a page, a phrase only the held page carries and a phrase only
   * the live one does. `owner` pages are opened signed in as the owner. None where a page cannot
   * show it (a door is a refusal, held to real rows in `the-launch-switch.audit.test.ts`).
   */
  probe?: { path: string; held: string; live: string; as?: "owner" };
}

const FAQ_HELD = faqWords("held");
const FAQ_LIVE = faqWords("live");

export const LAUNCH_SURFACES: readonly LaunchSurface[] = [
  {
    id: "accounts",
    where: "Every way in: signing in, setting or resetting a password, signing up, and keeping a session (createSession, getSession, the sign-in actions)",
    held: "Only the owners (and anybody on SIGNIN_ALLOW_EMAILS) can sign in or keep a session; nobody can sign up; everybody else is told TourneyHQ opens soon",
    live: "Anybody can sign up, sign in, and set or reset a password",
    before: "followed",
  },
  {
    id: "front-door-box",
    where: "The front door's sign-up and sign-in box",
    held: "The “opens soon” notice with the early-list offer and its terms; signing in only, folded behind “TourneyHQ staff sign-in”",
    live: "The sign-up form, with its Sign up and Sign in tabs",
    before: "followed",
    probe: { path: "/", held: SIGNINS_CLOSED_NOTICE.lead, live: "Create your account" },
  },
  {
    id: "front-door-buttons",
    where: "The front door's start buttons (the hero, the phone dock)",
    held: `“${FRONT_DOOR.held.heroCta}”, to /interest`,
    live: `“${FRONT_DOOR.live.heroCta}”, to the sign-up form`,
    before: "followed",
    probe: { path: "/", held: FRONT_DOOR.held.heroCta, live: FRONT_DOOR.live.heroCta },
  },
  {
    id: "front-door-pill",
    where: "The front door's announcement above the headline",
    held: `“${FRONT_DOOR.held.pill.text}”`,
    live: `“${FRONT_DOOR.live.pill.badge} ${FRONT_DOOR.live.pill.text}”`,
    before: "followed",
    probe: { path: "/", held: FRONT_DOOR.held.pill.text, live: FRONT_DOOR.live.pill.text },
  },
  {
    id: "front-door-facts",
    where: "The facts under the front door's headline",
    held: FRONT_DOOR.held.facts.join(" · "),
    live: FRONT_DOOR.live.facts.join(" · "),
    before: "followed",
    probe: { path: "/", held: "Handicaps by the Rules", live: FRONT_DOOR.live.facts[0] },
  },
  {
    id: "pricing",
    where: "The front door's pricing",
    held: `The free plan “${FRONT_DOOR.held.freeYear}”; each button “${FRONT_DOOR.held.planButton("…")}”; “${FRONT_DOOR.held.pricingNote}”`,
    live: `The free plan “${FRONT_DOOR.live.freeYear}” with “${FRONT_DOOR.live.freeButton}”; each button “${FRONT_DOOR.live.planButton("…")}”; the note on arranging a paid plan`,
    before: "followed",
    probe: { path: "/", held: FRONT_DOOR.held.pricingNote, live: FRONT_DOOR.live.pricingNote },
  },
  {
    id: "front-door-close",
    where: "The front door's closing section, above the box",
    held: `“${FRONT_DOOR.held.closeHeading}”`,
    live: `“${FRONT_DOOR.live.closeHeading}”`,
    before: "followed",
    probe: { path: "/", held: FRONT_DOOR.held.closeHeading, live: FRONT_DOOR.live.closeHeading },
  },
  {
    id: "nav",
    where: "The top bar's button on /faq, /privacy, /terms and /interest",
    held: `“${FRONT_DOOR.held.navCta}”, to /interest`,
    live: `“${FRONT_DOOR.live.navCta}”, to the sign-up form`,
    before: "followed",
    probe: { path: "/privacy", held: FRONT_DOOR.held.navCta, live: FRONT_DOOR.live.navCta },
  },
  {
    id: "faq-answers",
    where: "/faq: “Can I try it for free?” and “Do I need a credit card?”",
    held: "The free plan “opens at launch”; no “no card to start”",
    live: "“Yes …”, and “No card to start”",
    before: "wired",
    probe: { path: "/faq", held: FAQ_HELD.tryFree.slice(0, 40), live: FAQ_LIVE.tryFree.slice(0, 40) },
  },
  {
    id: "faq-cta",
    where: "/faq's last call to action (drawn only while the contact address is switched off)",
    held: `“${FRONT_DOOR.held.faqCta.button}”, to /interest`,
    live: `“${FRONT_DOOR.live.faqCta.button}”, to the sign-up form`,
    before: "wired",
  },
  {
    id: "interest-page",
    where: "/interest: its heading and offer",
    held: `“${INTEREST_PAGE.held.kicker}” · “${INTEREST_PAGE.held.h1}” · 25% off at launch`,
    live: `“${INTEREST_PAGE.live.kicker}” · “${INTEREST_PAGE.live.h1}” · a link to create an account`,
    before: "wired",
    probe: { path: "/interest", held: INTEREST_PAGE.held.h1, live: INTEREST_PAGE.live.h1 },
  },
  {
    id: "interest-form",
    where: "/interest: the line under the form, the thanks after it, and the copy sent to inquiries@",
    held: "Promises the 25% code by email at launch",
    live: "Promises a reply, and no code",
    before: "wired",
    probe: { path: "/interest", held: INTEREST_PAGE.held.reassure.slice(0, 60), live: INTEREST_PAGE.live.reassure.slice(0, 60) },
  },
  {
    id: "interest-meta",
    where: "/interest: its search and link-preview description",
    held: `“${INTEREST_PAGE.held.description}”`,
    live: `“${INTEREST_PAGE.live.description}”`,
    before: "wired",
    probe: { path: "/interest", held: INTEREST_PAGE.held.description, live: INTEREST_PAGE.live.description },
  },
  {
    id: "owner-card",
    where: "/owner: this card",
    held: "“Held until launch”, what Go live will change, and the Go live button",
    live: "“Live since …”, what Hold again will change, and the Hold again button",
    before: "wired",
    probe: { path: "/owner", held: OWNER_CARD.willGoLive, live: OWNER_CARD.willHold, as: "owner" },
  },
];

/* ─────────────────────────── what does not move with it ─────────────────────────── */

/** Something that reads like a launch state and deliberately does not follow the switch. */
export interface NotSwitched {
  id: string;
  what: string;
  why: string;
  /** Something for Ajay to decide, where it is his call. */
  ask?: string;
}

export const NOT_SWITCHED: readonly NotSwitched[] = [
  {
    id: "app-stores",
    what: "“Coming soon to the App Store / on Google Play”, and the App Store and Google Play in the “Coming” strip",
    why: "True until a store lists the app, which is not launch day. Each button turns into a store link when TOURNEYHQ_IOS_URL or TOURNEYHQ_ANDROID_URL is set.",
  },
  {
    id: "handicap-services",
    what: "“Coming soon” beside handicap services (GHIN, WHS) in the comparison and the “Coming” strip",
    why: "A feature not built yet, not a hold.",
  },
  {
    id: "metered",
    what: "Text alerts, reading a photographed card and drafted commentary — “not switched on for anybody yet”",
    why: "They cost per use and come with the top plan first; unrelated to accounts.",
  },
  {
    id: "prices",
    what: "Every price and plan term: the front door's prices and its “Compare the plans” table, the schema.org offers (the free plan's $0 among them), /faq's prices and the owner's price editor",
    why: "Prices and plan terms are Ajay's decisions, set on the owner console. Going live never moves a figure.",
    ask: "While held, the front door hides the free plan, but its search-engine data still lists it at $0 and “Compare the plans” still says “free for good”. Keep them, or hide them until launch?",
  },
  {
    id: "plan-limits",
    what: "Plan limits (the Enforce switch on the owner console's limits)",
    why: "Refusing a club over its plan is money. It has its own switch and is not tied to launch here.",
    ask: "Should going live also switch on plan-limit enforcement, or stay a separate press?",
  },
  {
    id: "launch-codes",
    what: "Emailing the 25% code to everybody on the early list",
    why: "No such action exists yet. The list is on the owner console; the codes are made there (Discount codes) and sent by hand. A note's date against “Live since” says whether it was written before launch.",
    ask: "Build a “Send the early-list codes” press on the owner console, separate from Go live?",
  },
  {
    id: "round-codes",
    what: "/play, round codes, and every public board (/live)",
    why: "Never held: a tournament is scored by code with accounts held.",
  },
  {
    id: "entry-windows",
    what: "“Opens soon” on a tournament's entries",
    why: "A tournament's own entry window, set by its organizer.",
  },
  {
    id: "contact-address",
    what: "/faq's “our contact address opens soon”",
    why: "Drawn only while the contact address cannot receive mail (CONTACT_EMAIL_LIVE), which is about mail, not launch.",
  },
  {
    id: "sitemap",
    what: "/interest in the sitemap and robots.txt",
    why: "The page answers in both states — the early list held, “Now open” live — so a link from an old post or ad still lands somewhere true.",
  },
  {
    id: "not-production",
    what: "Development, CI and every preview",
    why: "Never held, whatever the switch says; the switch can only open what production's hold shut.",
  },
];
