/**
 * WHAT A FIXTURE SIGNS TO BE SIGNED IN.
 *
 * A session cookie carries who is signed in AND when they signed in — the user
 * id, a tilde, and the issue time in seconds, base 36 — and the app refuses one
 * without the time (`src/lib/domain/session-token.ts`, 2026-10-11). Until then
 * every fixture signed the bare user id, in about twenty places, each with its
 * own copy of the signing line.
 *
 * So the VALUE is made here, once, and each fixture signs it with the secret
 * it already has:
 *
 *   sign(signedInNow(user.id))
 *
 * `session-token.test.ts` holds this to the app's own `sessionValue`, so the
 * two cannot drift into a fixture the app turns away — which would look, on
 * every screen, exactly like a sign-in that is broken.
 *
 * Plain JavaScript with no imports: the verify scripts run it under bare
 * `node`, and the browser specs import it through TypeScript.
 */

/** @param {string} userId @param {number} [at] milliseconds; now when omitted */
export function signedInNow(userId, at = Date.now()) {
  return `${userId}~${Math.floor(at / 1000).toString(36)}`;
}
