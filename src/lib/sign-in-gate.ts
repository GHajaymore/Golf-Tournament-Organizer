/**
 * SIGN-INS ARE CLOSED IN PRODUCTION UNTIL LAUNCH.
 *
 * Ajay, 2026-10-17: "block the signins until I say so or when we launch" —
 * "app is not ready yet and I dont want people to visit the site and have a bad
 * experience". The first real tournament puts the address on a poster, so
 * somebody who reads tourneyhq.club off it is told the app opens soon rather
 * than making an account in an app that is not finished.
 *
 * WHAT IS CLOSED: making a session for a PERSON — signing in, setting a first
 * password, resetting one, signing up — and honouring a session made before.
 * WHAT IS NOT: a round code (`/play` holds its own session, bound to a player
 * slot rather than a person) and every public board. A tournament scored by
 * code is played with sign-ins shut.
 *
 * WHO MAY STILL SIGN IN: the platform owners (`OWNER_EMAILS`) and anybody on
 * `SIGNIN_ALLOW_EMAILS`, both comma-separated lists in the environment.
 *
 * WHERE: production only (`VERCEL_ENV=production`). A preview deploy, the dev
 * server, CI and every e2e run are open, so nothing that tests the app is
 * changed by this.
 *
 * TO OPEN: set `SIGNINS=open` in production and redeploy, or delete this rule.
 *
 * It FAILS OPEN in one case, deliberately: closed, but with nobody on either
 * list. That is a misconfiguration, and the cost of reading it as "closed" is
 * the owner locked out of their own console on the morning of a tournament.
 * The cost of reading it as "open" is the state the app was in yesterday.
 */
import { parseOwnerEmails } from "@/lib/owner";

/** What a person is told when they try. Points a player at the one door that is open. */
export const SIGNINS_CLOSED_MESSAGE =
  "TourneyHQ is under development, and accounts open at launch. Scoring a round today? Open tourneyhq.club/play and type your round code.";

/**
 * Said ABOVE the sign-in box while it is closed (Ajay: "if we are blocking we
 * can put a message about under development"), so nobody fills in a form to be
 * refused at the end of it.
 */
export const SIGNINS_CLOSED_NOTICE = {
  lead: "TourneyHQ is under development.",
  body: "Accounts open at launch. Thank you for your interest, and we appreciate any feedback at support@tourneyhq.club.",
  play: "Scoring a round today? Open tourneyhq.club/play and type your round code.",
} as const;

type Env = Record<string, string | undefined>;

function allowList(env: Env): string[] {
  return [...parseOwnerEmails(env.OWNER_EMAILS), ...parseOwnerEmails(env.SIGNIN_ALLOW_EMAILS)];
}

/** Are sign-ins shut to everybody not on the lists? */
export function signInsClosed(env: Env = process.env): boolean {
  if (env.VERCEL_ENV !== "production") return false;
  if ((env.SIGNINS ?? "").trim().toLowerCase() === "open") return false;
  return allowList(env).length > 0;
}

/** May this address be signed in (or keep a session) right now? */
export function maySignIn(email: string | null | undefined, env: Env = process.env): boolean {
  if (!signInsClosed(env)) return true;
  const who = (email ?? "").trim().toLowerCase();
  if (!who) return false;
  return allowList(env).includes(who);
}
