/**
 * SIGN-INS CLOSED UNTIL LAUNCH.
 *
 * Ajay, 2026-10-17: "block the signins until I say so or when we launch" —
 * "app is not ready yet and I dont want people to visit the site and have a bad
 * experience". The first real tournament puts the address on a poster, so
 * somebody who reads tourneyhq.club off it is told the app is under
 * development rather than making an account in an app that is not finished.
 *
 * THE SWITCH IS THE LIST. Sign-ins close when `SIGNIN_ALLOW_EMAILS` (comma-
 * separated) names anybody, and only the people it names — plus the platform
 * owners on `OWNER_EMAILS` — may sign in. Empty or unset: open, as before.
 * So the person who closes the door has, in the same keystroke, typed the
 * address that still opens it. It was first written to close on its own in
 * production with the owners let through, and production's `OWNER_EMAILS` was
 * then measured to NOT hold the owner's address (/owner answered 404 to him,
 * signed in): that version would have locked him out of his own console the
 * night before a real tournament.
 *
 * TO OPEN: delete the variable (or set `SIGNINS=open`) and redeploy. An
 * environment variable reaches the app at deploy time on Vercel, so either way
 * it takes a redeploy.
 *
 * WHAT IS CLOSED: making a session for a PERSON — signing in, setting a first
 * password, resetting one, signing up — and honouring a session made before.
 * WHAT IS NOT: a round code (`/play` holds its own session, bound to a player
 * slot rather than a person) and every public board. A tournament scored by
 * code is played with sign-ins shut.
 *
 * Every environment is ruled by the same variable, so the closed state can be
 * tried on a preview before production. Dev, CI and e2e never set it.
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
  // The early-subscriber offer (panel, 2026-10-17; Ajay: "25% discount is only
  // for the first term (month or year)"). Honoured with a code made on /owner
  // and sent in the reply — domain/discount.ts takes it off the first payment.
  offer: "Clubs that write before we open get 25% off their first payment — the first month, or the first year if they pay yearly.",
  playLead: "Playing today?",
  playLink: "Go to tourneyhq.club/play",
  playTail: "and enter the round code your organizer gave you.",
} as const;

type Env = Record<string, string | undefined>;

/** Are sign-ins shut to everybody not on the lists? */
export function signInsClosed(env: Env = process.env): boolean {
  if ((env.SIGNINS ?? "").trim().toLowerCase() === "open") return false;
  return parseOwnerEmails(env.SIGNIN_ALLOW_EMAILS).length > 0;
}

/** May this address be signed in (or keep a session) right now? */
export function maySignIn(email: string | null | undefined, env: Env = process.env): boolean {
  if (!signInsClosed(env)) return true;
  const who = (email ?? "").trim().toLowerCase();
  if (!who) return false;
  return [...parseOwnerEmails(env.SIGNIN_ALLOW_EMAILS), ...parseOwnerEmails(env.OWNER_EMAILS)].includes(who);
}
