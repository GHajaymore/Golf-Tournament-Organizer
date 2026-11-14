import { scrubText } from "./error-report";

/**
 * WHAT A PAGE VIEW MAY SAY ABOUT WHERE IT WAS (2026-10-03).
 *
 * Vercel Web Analytics counts a page view by its address, and several of this
 * app's addresses carry a credential: a board link (`/live/<token>`), an entry
 * form (`/register/<token>`), a password reset (`?token=`), a round code
 * (`?code=`). Counted as they are, each one would sit in an analytics
 * dashboard as a working link for whoever can read it. So every event passes
 * through here first, and the address is rewritten by the same `scrubText`
 * that cleans error reports — one rule for both, so they cannot drift.
 *
 * Pure, so it is testable; `SiteAnalytics` hands it to the script as
 * `beforeSend`.
 */
export interface AnalyticsEventLike {
  type?: string;
  url: string;
}

export function scrubAnalyticsEvent<T extends AnalyticsEventLike>(event: T): T {
  return { ...event, url: scrubText(event.url) };
}

/**
 * WHAT THE ANALYTICS SCRIPT IS HANDED (2026-11-13): a scrubbed page view, or
 * NOTHING for the guest player link's page (/p, J39/J40, the review's S3).
 * The link's code rides in /p's fragment until the page strips it, and a
 * beacon can race that; the fragment rule in `scrubText` redacts it, and this
 * drops the view outright, so a link page is never counted at all.
 * `SiteAnalytics` also renders nothing on /p: two locks.
 */
export function pageViewFor<T extends AnalyticsEventLike>(event: T): T | null {
  if (isPlayerLinkPage(event.url)) return null;
  return scrubAnalyticsEvent(event);
}

/** Whether an address is the player link's page, /p (with or without a fragment or a query). */
export function isPlayerLinkPage(url: string): boolean {
  let path = url;
  try {
    path = new URL(url, "https://x.invalid").pathname;
  } catch {
    return true;
  }
  return path === "/p" || path.startsWith("/p/");
}

/** Whether analytics is switched on for this build. Off unless set to exactly "on". */
export function analyticsEnabled(flag: string | undefined): boolean {
  return flag?.trim() === "on";
}
