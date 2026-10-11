/**
 * WHAT A SIGN-IN COOKIE SAYS, AND WHEN IT STOPS BEING GOOD (2026-10-11).
 *
 * The cookie used to carry the signed user id and nothing else. So it was the
 * same string for one person for ever: every device they had ever signed in
 * on held an identical value, and nothing on the server could tell an old one
 * from a new one. Three things followed, none of them visible on any screen:
 *
 *   - the seven days the cookie claims was a request to the browser. A copy
 *     of the value — off a shared clubhouse PC, a backup, a proxy log — went
 *     on working after the browser had dropped it, with no end date;
 *   - signing out removed the cookie from that browser and revoked nothing;
 *   - RESETTING A PASSWORD ended nobody's session. That is the one moment a
 *     person is saying "somebody else may be in my account", and whoever was
 *     in it stayed in.
 *
 * So the value now carries WHEN it was issued, inside the signature:
 *
 *   <user id>~<issued at, seconds, base 36>
 *
 * and the server holds it to two rules. It is good for `SESSION_SECONDS` from
 * that moment, whatever the browser does. And it is good only if it was issued
 * at or after the person's `sessionsValidFrom` — a date a password reset moves
 * to now, which ends every earlier sign-in at once, on every device.
 *
 * A value with no date in it is an old cookie, and is refused: everybody signs
 * in once more after this ships, and from then on a sign-in has an end.
 *
 * What this does NOT do: end one device's session when that device signs out
 * elsewhere, or a single session picked from a list. That needs a session
 * table. Signing out still removes the cookie from the browser it is pressed
 * in, and a reset is the way to end the rest.
 *
 * Pure — no clock of its own, no database — so every rule here is unit-tested.
 */

/** How long a sign-in lasts. The cookie's own max-age is this, and the server now agrees. */
export const SESSION_SECONDS = 60 * 60 * 24 * 7;

/**
 * How far ahead of the server's clock an issue time may be. Two servers a few
 * seconds apart must not sign somebody out; a value dated next week is not a
 * clock difference.
 */
const CLOCK_SKEW_SECONDS = 5 * 60;

const seconds = (d: Date) => Math.floor(d.getTime() / 1000);

/** The value to sign into a session cookie for this person, signing in now. */
export function sessionValue(userId: string, now: Date = new Date()): string {
  return `${userId}~${seconds(now).toString(36)}`;
}

export interface HeldSession {
  userId: string;
  /** Seconds since the epoch. */
  issuedAt: number;
}

/**
 * Read a VERIFIED cookie value. Null for anything that is not a user id and an
 * issue time — including the bare user id an old cookie holds.
 */
export function readSessionValue(value: string | null | undefined): HeldSession | null {
  if (!value) return null;
  const at = value.lastIndexOf("~");
  if (at <= 0) return null;
  const userId = value.slice(0, at);
  const stamp = value.slice(at + 1);
  if (!/^[0-9a-z]{1,12}$/.test(stamp)) return null;
  const issuedAt = parseInt(stamp, 36);
  if (!Number.isSafeInteger(issuedAt) || issuedAt <= 0) return null;
  return { userId, issuedAt };
}

export type SessionRefusal = "expired" | "ended" | "not yet";

/**
 * Why a session that reads correctly is still not good, or null when it is.
 *
 *   expired   older than a sign-in lasts
 *   ended     issued before the person's cutoff — a password reset since
 *   not yet   dated in the future, which no sign-in of ours is
 *
 * The cutoff is compared by the SECOND, like the issue time: a reset signs the
 * person straight back in, and that new session is issued in the same second
 * the cutoff was moved to. Comparing milliseconds would end it at birth.
 */
export function sessionRefusal(
  held: HeldSession,
  sessionsValidFrom: Date | null | undefined,
  now: Date = new Date(),
): SessionRefusal | null {
  const at = seconds(now);
  if (held.issuedAt > at + CLOCK_SKEW_SECONDS) return "not yet";
  if (at - held.issuedAt > SESSION_SECONDS) return "expired";
  if (sessionsValidFrom && held.issuedAt < seconds(sessionsValidFrom)) return "ended";
  return null;
}
