import "server-only";
import { checkBotId } from "botid/server";

/**
 * IS THIS SIGN-UP A SCRIPT? (2026-10-03)
 *
 * Creating an account had no limit at all, and the rate limiter deliberately
 * refuses to key on an IP address (see `domain/rate-limit.ts`: spoofable, and a
 * whole club shares one clubhouse wifi). A script inventing a fresh address per
 * attempt could create clubs by the thousand. Its own comment says that attack
 * "wants a different control" — this is it: Vercel BotID, an invisible check
 * that a real browser passes without anyone seeing it.
 *
 * TWO RULES, both measured against the package rather than its docs:
 *
 *   - ONLY ON VERCEL. Off Vercel, in production mode — CI's `next start`, the
 *     Electron shell — `checkBotId` THROWS, because it needs a Vercel OIDC
 *     token. So nothing is asked there, and every local and CI sign-up is
 *     unaffected.
 *   - A CHECK THAT FAILS LETS THE PERSON IN. On Vercel it also throws when the
 *     project's OIDC setting is off. Refusing then would stop every real club
 *     signing up because of a setting nobody can see from the form; letting
 *     them in costs only the protection, and the failure is logged so it gets
 *     noticed. Only a definite "this is a bot" refuses.
 *
 * `check` is injectable so the decision is testable without Vercel.
 */
export async function signUpLooksAutomated(
  check: () => Promise<{ isBot: boolean }> = checkBotId,
  onVercel: boolean = Boolean(process.env.VERCEL),
): Promise<boolean> {
  if (!onVercel) return false;
  try {
    const verdict = await check();
    return verdict.isBot === true;
  } catch (err) {
    console.error("[botid] sign-up check unavailable; letting it through:", err instanceof Error ? err.message : err);
    return false;
  }
}

/** What a refused sign-up is told: what to do, not why the machine doubted them. */
export const AUTOMATED_SIGNUP =
  "We couldn't confirm this sign-up came from a person using a browser. Refresh the page and try again.";
