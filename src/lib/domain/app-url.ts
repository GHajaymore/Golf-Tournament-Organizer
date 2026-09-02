/**
 * The address to put in a link somebody receives by email.
 *
 * Every outbound link in this app is built from `NEXT_PUBLIC_APP_URL`, and both
 * places that did it wrote the same line:
 *
 *     const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
 *
 * That fallback is right on a developer machine and silently wrong everywhere
 * else. With the variable unset on a deploy, every password-reset link and
 * every staff invitation points at `http://localhost:3000` — a link that opens
 * nothing on the recipient's phone, in the one email they actually needed. The
 * send succeeds, the provider reports no error, and `emailConfig()` reports no
 * problem, because it checks whether a key exists and whether the sender is the
 * sandbox and has no opinion about the URL inside the message.
 *
 * It is not a hypothetical: the variable was deleted and recreated on
 * 2026-09-01 to change its type from Secret to Config, and a variable that gets
 * recreated is one that can be absent for a window.
 *
 * So the fallback stays — a local dev server has to work — but it now announces
 * itself, and the Access screen says so beside the other two mail warnings.
 */

/** Where a local dev server lives, and the only place this is ever correct. */
export const DEV_FALLBACK_URL = "http://localhost:3000";

export interface AppUrl {
  /** The base to build links from. Never empty. */
  base: string;
  /**
   * True when the dev fallback is being used ON A DEPLOY, which means every
   * link this app emails is broken. False locally, where it is simply correct.
   */
  brokenLinks: boolean;
}

/**
 * Resolve the public base URL, and say whether it is trustworthy.
 *
 * Takes the environment rather than reading `process.env`, so the deployed case
 * can be tested without pretending to be deployed — the same reason the rest of
 * `src/lib/domain` takes its inputs.
 *
 * A blank string counts as unset. An environment variable that exists with an
 * empty value is the shape a half-finished dashboard edit leaves behind, and
 * treating it as configured would produce links beginning `/reset-password`
 * with no origin at all.
 */
export function appUrlFrom(env: {
  NEXT_PUBLIC_APP_URL?: string;
  VERCEL?: string;
  NODE_ENV?: string;
}): AppUrl {
  const configured = (env.NEXT_PUBLIC_APP_URL ?? "").trim();
  if (configured) return { base: stripTrailingSlash(configured), brokenLinks: false };

  /**
   * "Deployed" rather than "production", deliberately.
   *
   * A preview deployment emails real links too — a reset requested from a
   * preview build has to open that preview, not the reviewer's laptop. Gating
   * on `VERCEL_ENV === "production"` would leave every preview quietly broken
   * and looking fine.
   */
  const deployed = Boolean(env.VERCEL) || env.NODE_ENV === "production";
  return { base: DEV_FALLBACK_URL, brokenLinks: deployed };
}

/**
 * Trailing slashes are removed because every caller appends a path beginning
 * with one, and `https://host//reset-password` is a different URL — one some
 * routers redirect and others simply do not recognise.
 */
function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

/** The base URL for this process. The thin wrapper the app actually calls. */
export function appUrl(): AppUrl {
  return appUrlFrom({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    VERCEL: process.env.VERCEL,
    NODE_ENV: process.env.NODE_ENV,
  });
}
