import "server-only";
import { createHash } from "node:crypto";
import { passwordProblem, type PasswordContext } from "@/lib/domain/password";
import { PASSWORD_SEEN_IN_BREACH, breachRangeParts, seenInRange } from "@/lib/domain/password-breach";

/**
 * THE ONE GATE FOR A NEW PASSWORD (2026-10-21; Ajay: "go with your
 * recommendations" — a leaked-password check before launch).
 *
 * Every action that sets a password asks `passwordRefusal`, never
 * `passwordProblem` on its own: the rules in `password.ts` first, because they
 * are the ones a person can act on without thinking, then whether the
 * password is known from somebody else's leak (`domain/password-breach.ts`).
 * `a-new-password-asks-about-leaks.test.ts` holds every action to it.
 *
 * TWO RULES, the same two the sign-up bot check keeps (`bot-check.ts`):
 *
 *   - ONLY ON VERCEL. Off Vercel — dev, CI, the e2e server, the desktop shell
 *     — nothing is asked, so no test reaches the internet and no run depends
 *     on a service it does not own.
 *   - A CHECK THAT CANNOT ANSWER LETS THE PASSWORD THROUGH. The service down,
 *     slow (two seconds) or answering nonsense must not stop a club signing
 *     up; it costs only this one protection, and it is logged so it is seen.
 *     Only a definite "this was leaked" refuses.
 */

export interface BreachCheck {
  /** Asks the range API for one prefix; injectable so the decision is testable. */
  fetchRange?: (prefix: string) => Promise<string>;
  onVercel?: boolean;
}

const RANGE_URL = "https://api.pwnedpasswords.com/range/";
const TIMEOUT_MS = 2000;

async function fetchRangeFromService(prefix: string): Promise<string> {
  const res = await fetch(RANGE_URL + prefix, {
    headers: { "Add-Padding": "true", "User-Agent": "TourneyHQ" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`range API answered ${res.status}`);
  return res.text();
}

/** True only when the password is definitely in a known leak. */
export async function passwordSeenInBreach(password: string, deps: BreachCheck = {}): Promise<boolean> {
  const onVercel = deps.onVercel ?? Boolean(process.env.VERCEL);
  if (!onVercel) return false;
  const { prefix, suffix } = breachRangeParts(createHash("sha1").update(password, "utf8").digest("hex"));
  try {
    const body = await (deps.fetchRange ?? fetchRangeFromService)(prefix);
    return seenInRange(body, suffix);
  } catch (err) {
    console.error("[password-breach] the leak check could not answer; the password was let through:", String(err).slice(0, 200));
    return false;
  }
}

/** What is wrong with this new password, or null: the rules, then the leaks. */
export async function passwordRefusal(password: string, ctx?: PasswordContext, deps?: BreachCheck): Promise<string | null> {
  const weak = passwordProblem(password, ctx);
  if (weak) return weak;
  return (await passwordSeenInBreach(password, deps)) ? PASSWORD_SEEN_IN_BREACH : null;
}
