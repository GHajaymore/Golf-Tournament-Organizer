/**
 * SIGN-INS CLOSED UNTIL LAUNCH.
 *
 * Ajay, 2026-10-17: "block the signins until I say so or when we launch" —
 * "app is not ready yet and I dont want people to visit the site and have a bad
 * experience". The first real tournament puts the address on a poster, so
 * somebody who reads tourneyhq.club off it is told the app is under
 * development rather than making an account in an app that is not finished.
 *
 * PRODUCTION IS HELD (2026-10-21), its owners on `OWNER_EMAILS` let through,
 * and anybody on `SIGNIN_ALLOW_EMAILS` too — see `signInsClosed`. Elsewhere
 * a non-empty `SIGNIN_ALLOW_EMAILS` closes it, to try the closed state on a
 * preview. The list alone was the switch until that day, and production's was
 * never set, so the door stood open.
 *
 * TO LAUNCH: `SIGNINS=open` in Vercel's production variables, and redeploy —
 * an environment variable reaches the app at deploy time.
 *
 * WHAT IS CLOSED: making a session for a PERSON — signing in, setting a first
 * password, resetting one, signing up — and honouring a session made before.
 * WHAT IS NOT: a round code (`/play` holds its own session, bound to a player
 * slot rather than a person) and every public board. A tournament scored by
 * code is played with sign-ins shut.
 *
 * Dev, CI and e2e are not production and never set the list, so they are open.
 */
import { parseOwnerEmails } from "@/lib/owner";
import { SALES_EMAIL } from "@/lib/contact";

/** What a person is told when they try. Points a player at the one door that is open. */
// Never the word "closed" (Ajay: "instead of closed can we say not opened yet
// or something better?"): a visitor is told what is coming, not shut out.
// Worded by the panel's marketing manager, 2026-10-21; "under development" went on the ad director's
// word — Google reads an "under construction" page as a reason to refuse the ad that lands on it.
export const SIGNINS_CLOSED_MESSAGE =
  "TourneyHQ opens soon. Sign-ups are paused until launch. Playing today? Go to tourneyhq.club/play and enter your organizer's round code.";

/**
 * Said ABOVE the sign-in box while it is closed (Ajay: "if we are blocking we
 * can put a message about under development"), so nobody fills in a form to be
 * refused at the end of it.
 */
/*
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
  // The address is the link's words, so a phone with no mail app still shows it to copy.
  interestedEmail: SALES_EMAIL,
  interestedSubject: "Early list: 25% off at launch",
  terms: "25% off the first billing term of one paid plan, for clubs that join the early list before launch. One code per club, emailed at launch.",
  playLead: "Playing today?",
  playLink: "Go to tourneyhq.club/play",
  playTail: "and enter your organizer's round code.",
} as const;

/** The front door's own words while held (the marketing manager's). */
export const HELD_FRONT_DOOR = {
  heading: "Opening soon. Get in early.",
  lead: "New accounts open at launch. Register your interest now and we'll email you 25% off your first paid term. Got a round code? You can play today.",
  signInTitle: "Already have access?",
  signInSub: "Sign in below. New accounts open at launch.",
  pricingNote: "Paid plans start at launch. Join the early list now and we'll email you 25% off your first term.",
  // The ad director: a button that promises "Start free" and lands on a paused door reads as bait.
  cta: "Get early access",
  // The ad director's second placement, in the hero's announcement pill.
  pill: "Opening soon: join the early list for 25% off your first term",
} as const;

type Env = Record<string, string | undefined>;

/**
 * Are sign-ins shut to everybody not on the lists?
 *
 * HELD IN PRODUCTION UNTIL LAUNCH (Ajay, 2026-10-21: "we need to block/hold the
 * signup/signin until when we say let's Launch"). The list alone was the switch,
 * and production's list was never set, so the front door stood open. Now
 * production is held by itself — but ONLY with an owner to let through: an empty
 * `OWNER_EMAILS` leaves it open, which is the lock-out the first draft of this
 * file nearly shipped. Measured before this was written: production's owner list
 * holds his address (/owner answered 200 to his session).
 *
 * TO LAUNCH: `SIGNINS=open` in Vercel's production variables, and redeploy.
 * Previews, dev, CI and e2e are not production and stay open.
 */
export function signInsClosed(env: Env = process.env): boolean {
  if ((env.SIGNINS ?? "").trim().toLowerCase() === "open") return false;
  if (parseOwnerEmails(env.SIGNIN_ALLOW_EMAILS).length > 0) return true;
  return env.VERCEL_ENV === "production" && parseOwnerEmails(env.OWNER_EMAILS).length > 0;
}

/** May this address be signed in (or keep a session) right now? */
export function maySignIn(email: string | null | undefined, env: Env = process.env): boolean {
  if (!signInsClosed(env)) return true;
  const who = (email ?? "").trim().toLowerCase();
  if (!who) return false;
  return [...parseOwnerEmails(env.SIGNIN_ALLOW_EMAILS), ...parseOwnerEmails(env.OWNER_EMAILS)].includes(who);
}
