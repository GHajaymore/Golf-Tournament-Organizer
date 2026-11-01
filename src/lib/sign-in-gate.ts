/**
 * SIGN-INS CLOSED UNTIL LAUNCH.
 *
 * Ajay, 2026-10-17: "block the signins until I say so or when we launch" —
 * "app is not ready yet and I dont want people to visit the site and have a bad
 * experience". The first real tournament puts the address on a poster, so
 * somebody who reads tourneyhq.club off it is told the app opens soon rather
 * than making an account in an app that is not finished.
 *
 * PRODUCTION IS HELD (2026-10-21), its owners on `OWNER_EMAILS` let through,
 * and anybody on `SIGNIN_ALLOW_EMAILS` too — see `signInsClosed`. Elsewhere
 * a non-empty `SIGNIN_ALLOW_EMAILS` closes it, to try the closed state on a
 * preview. The list alone was the switch until that day, and production's was
 * never set, so the door stood open.
 *
 * TO LAUNCH: the Go live press on /owner (`services/signins-switch.ts`), which
 * changes every held page at once (`go-live.ts` lists them). `SIGNINS=open` in
 * Vercel's production variables still opens it too, at the next deploy.
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

// The held words live with their live counterparts, in the one module (`go-live.ts`).
export { SIGNINS_CLOSED_MESSAGE, SIGNINS_CLOSED_NOTICE, HELD_FRONT_DOOR } from "@/lib/go-live";

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
 * Previews, dev, CI and e2e are not production and stay open.
 */
export function signInsClosed(env: Env = process.env): boolean {
  return holdRule(env) === "holds";
}

/**
 * WHY this deployment holds accounts, or why it does not — said on the owner card, so a switch
 * that a variable overrides says so rather than appearing to do nothing.
 *
 *   holds            the switch decides (production with an owner, or an allow-list)
 *   signins-open     SIGNINS=open is set: live whatever the switch says
 *   no-owners        production with nobody on OWNER_EMAILS: never held, or nobody could get in
 *   not-production   dev, CI or a preview: never held
 */
export type HoldRule = "holds" | "signins-open" | "no-owners" | "not-production";

export function holdRule(env: Env = process.env): HoldRule {
  if ((env.SIGNINS ?? "").trim().toLowerCase() === "open") return "signins-open";
  if (parseOwnerEmails(env.SIGNIN_ALLOW_EMAILS).length > 0) return "holds";
  if (env.VERCEL_ENV !== "production") return "not-production";
  return parseOwnerEmails(env.OWNER_EMAILS).length > 0 ? "holds" : "no-owners";
}

/** May this address be signed in (or keep a session) right now? */
export function maySignIn(email: string | null | undefined, env: Env = process.env): boolean {
  if (!signInsClosed(env)) return true;
  const who = (email ?? "").trim().toLowerCase();
  if (!who) return false;
  return [...parseOwnerEmails(env.SIGNIN_ALLOW_EMAILS), ...parseOwnerEmails(env.OWNER_EMAILS)].includes(who);
}
