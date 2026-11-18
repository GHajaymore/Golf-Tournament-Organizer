import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { SECURE_COOKIES } from "./secure-cookies";
import { sign, verify } from "./auth";
import {
  GUEST_COOKIE,
  GUEST_COOKIE_MAX_SECONDS,
  PLAYER_VIEW_COOKIE,
  guestCookieRefusal,
  guestCookieValue,
  readGuestCookieValue,
} from "./domain/player-link";
import { livePass, type LivePass } from "./services/player-link";

/**
 * THE GUEST SESSION: a tap on a player link (J39/J40 PR 1; design §2.5).
 *
 * Deliberately separate from the account session, as `play-auth.ts` is: this
 * identifies ONE GUEST ENTRY IN ONE EVENT, not a person. There is no User row,
 * no role beyond a player's, and it never calls `createSession` — the link is
 * not a sign-in, and adding an email never turns it into one.
 *
 * IT DOES NOT ASK THE SIGN-IN HOLD (`maySignInNow`, `signInsHeld`): Ajay, 7 Nov
 * (D9) — guest links work in production before launch, like round codes. That
 * exception is listed in `NOT_SWITCHED` (`go-live.ts`, `player-links`) and
 * `go-live-switch.test.tsx` pins it.
 *
 * The cookie holds `guest1~<passId>:<version>:<issued>` signed (S6): an exact
 * prefix, so no other cookie's signed value can stand in for it; a server-side
 * age check (180 days), because `maxAge` is a request to the browser; and the
 * pass's VERSION, so New link ends every phone holding the old one. It never
 * holds the code. Re-verified against the database on every request.
 */

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax",
  secure: SECURE_COOKIES,
  path: "/",
  maxAge: GUEST_COOKIE_MAX_SECONDS,
} as const;

export type GuestSession = LivePass;

/** Hold this pass on this browser (after a TAP, `openPlayerLink`). */
export async function setGuestCookie(passId: string, version: number): Promise<void> {
  const jar = await cookies();
  jar.set(GUEST_COOKIE, sign(guestCookieValue(passId, version, new Date())), COOKIE_OPTS);
}

/** "Forget me on this phone": this browser only. Revokes nothing. */
export async function clearGuestCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(GUEST_COOKIE);
  jar.delete(PLAYER_VIEW_COOKIE);
}

/** Whether this browser carries a guest cookie at all, good or not (to send a dead one to /p, not to sign-in). */
export async function holdsGuestCookie(): Promise<boolean> {
  const jar = await cookies();
  return !!jar.get(GUEST_COOKIE)?.value;
}

/**
 * ONE COOKIE THIS BROWSER SENT, FOR READING ONLY — or undefined when there is
 * no request to read it from (a script, a test calling an action directly:
 * `cookies` then throws "called outside a request scope"). An unreadable cookie
 * is NO guest and no chosen view: nothing is granted by it, and the account
 * path never comes through here. Next's own control-flow errors (dynamic
 * rendering, redirects) are rethrown, never swallowed.
 */
async function readCookie(name: string): Promise<string | undefined> {
  let jar: Awaited<ReturnType<typeof cookies>>;
  try {
    jar = await cookies();
  } catch (e) {
    unstable_rethrow(e);
    return undefined;
  }
  return jar.get(name)?.value;
}

/**
 * The live guest pass this browser holds, or null. Once per request (`cache`):
 * the layout and the page ask it, and both must get one answer.
 */
export const getGuestSession = cache(async (): Promise<GuestSession | null> => {
  const held = readGuestCookieValue(verify(await readCookie(GUEST_COOKIE)));
  if (!held) return null;
  if (guestCookieRefusal(held, new Date())) return null;
  return livePass(held.passId, held.version);
});

/** Which way a browser holding both a sign-in and a link chose to look (S4). Null: not chosen. */
export async function playerViewChosen(): Promise<"guest" | "account" | null> {
  const v = await readCookie(PLAYER_VIEW_COOKIE);
  return v === "guest" || v === "account" ? v : null;
}

export async function choosePlayerViewCookie(view: "guest" | "account"): Promise<void> {
  const jar = await cookies();
  jar.set(PLAYER_VIEW_COOKIE, view, { ...COOKIE_OPTS });
}
