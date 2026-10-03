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

/** Whether analytics is switched on for this build. Off unless set to exactly "on". */
export function analyticsEnabled(flag: string | undefined): boolean {
  return flag?.trim() === "on";
}
