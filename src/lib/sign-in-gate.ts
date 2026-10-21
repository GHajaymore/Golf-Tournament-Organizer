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
export const SIGNINS_CLOSED_MESSAGE =
  "TourneyHQ opens soon. It's under development, and accounts aren't open yet. Playing today? Go to tourneyhq.club/play and enter your round code.";

/**
 * Said ABOVE the sign-in box while it is closed (Ajay: "if we are blocking we
 * can put a message about under development"), so nobody fills in a form to be
 * refused at the end of it.
 */
export const SIGNINS_CLOSED_NOTICE = {
  lead: "TourneyHQ opens soon.",
  body: "It's under development, and accounts aren't open yet.",
  // Ajay: "may be we can add interested and divert it to inquiry@" — the live
  // mailbox is inquiries@ (contact.ts), so a visitor who wants in is not lost.
  interestedLead: "Interested?",
  interestedEmail: SALES_EMAIL,
  interestedTail: "and we'll let you know when it opens.",
  // NO OFFER IS PRINTED HERE (Ajay, 2026-10-21: "do not publish the discount
  // code"). The early-subscriber discount is still honoured — a code made on
  // /owner and sent in the reply — but the notice only invites them to write.
  playLead: "Playing today?",
  playLink: "Go to tourneyhq.club/play",
  playTail: "and enter the round code your organizer gave you.",
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
