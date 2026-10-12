/**
 * WHETHER THIS SERVER MARKS ITS COOKIES `Secure`.
 *
 * In production, always: a session must never travel over plain HTTP. In
 * development it cannot — the dev server is http://localhost, and a browser
 * does not send a Secure cookie there.
 *
 * ONE EXCEPTION, for testing on Safari's engine (2026-10-11). The end-to-end
 * suite runs a PRODUCTION build over plain http://localhost. Chromium sends a
 * Secure cookie to localhost anyway; WebKit, correctly, does not — so on
 * WebKit every flow where the SERVER sets the cookie (signing up, a round code)
 * signed nobody in, and the flows that matter most on an iPhone could not be
 * tested on the engine an iPhone uses. `E2E_PLAIN_HTTP=1` drops the flag for
 * that run.
 *
 * It is refused on Vercel whatever it is set to, so it cannot be switched on
 * in production by a stray environment variable, and `secure-cookies.test.ts`
 * holds both halves.
 */
export function cookiesAreSecure(env: Record<string, string | undefined> = process.env): boolean {
  if (env.NODE_ENV !== "production") return false;
  if (env.E2E_PLAIN_HTTP === "1" && !env.VERCEL) return false;
  return true;
}

export const SECURE_COOKIES = cookiesAreSecure();
