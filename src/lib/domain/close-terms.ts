import { keepsDataForever, PLANS } from "../plans";

/**
 * DOES COMPLETING THIS TOURNAMENT DELETE IT?
 *
 * Ajay, 2026-09-29: on the Free plan a tournament's data is wiped the moment
 * it is closed, and the terms apply to NEW clubs only. Kept pure and apart from
 * anything that deletes, for the reason `retention.ts` gives: this decides what
 * gets destroyed, so it must be provable on its own.
 *
 * Every condition must hold, and each one fails SAFE (towards keeping):
 *   - the club is held to the published terms (`planTermsApply`). An existing
 *     club is grandfathered, and a club with no subscription row is treated
 *     as grandfathered too, never as new;
 *   - its plan does not keep data (`keepsDataForever` false, so Free only);
 *   - it is a tournament, not a casual round. A quick round has its own 24-hour
 *     expiry (`round-expiry.ts`) and is not what this rule is about;
 *   - nobody has put an explicit hold on it (`retainUntil` in the future). A
 *     hold only ever extends, the same rule `retentionDecision` keeps.
 */
export interface CloseTermsInput {
  planTermsApply: boolean | null | undefined;
  plan: string | null | undefined;
  shape: string;
  retainUntil?: Date | null;
}

/**
 * THE PLAN KEYS WHOSE TOURNAMENTS ARE DELETED — every plan that does not keep
 * data (Par, today). Derived so the sweep's `where` and `wipesOnClose` cannot
 * name different plans.
 */
export const PLANS_THAT_DELETE: string[] = Object.values(PLANS)
  .filter((p) => !keepsDataForever(p.key))
  .map((p) => p.key);

export function wipesOnClose(input: CloseTermsInput, now: Date = new Date()): boolean {
  if (input.planTermsApply !== true) return false;
  if (keepsDataForever(input.plan ?? "free")) return false;
  if (input.shape === "match") return false;
  if (input.retainUntil && now.getTime() < new Date(input.retainUntil).getTime()) return false;
  return true;
}

/**
 * A PAR TOURNAMENT IS A ONE-OFF (Ajay, 2026-09-29), and the rule has to hold
 * whether or not anybody presses Complete:
 *
 *   - its rounds fall within ROUND_WINDOW_DAYS of each other — a weekend, a
 *     rain delay, a two-day outing; a season of weekly rounds is Birdie;
 *   - it closes LIFESPAN_DAYS after its golf began, whatever happens after.
 *
 * The clock starts at the FIRST golf and is never extended. The first draft
 * counted from the LAST score, and a club entering one score a week would have
 * kept it alive for ever — activity must not buy time.
 */
export const ROUND_WINDOW_DAYS = 7;
export const LIFESPAN_DAYS = 14;
const DAY = 24 * 3600 * 1000;

/**
 * When the golf began, from what can be seen: the earliest round date that has
 * arrived, or the moment a result was first seen (`resultSeenAt`, the sweep's
 * own clock — no result table carries a timestamp). Null while neither has
 * happened: a tournament with nothing played has nothing to close.
 */
export function golfBeganAt(
  roundDates: readonly string[],
  resultSeenAt: Date | null,
  now: Date = new Date(),
): Date | null {
  const dated = roundDates
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .map((d) => new Date(`${d}T00:00:00Z`))
    .filter((d) => d.getTime() <= now.getTime());
  const candidates = [...dated, ...(resultSeenAt ? [resultSeenAt] : [])];
  if (candidates.length === 0) return null;
  return new Date(Math.min(...candidates.map((d) => d.getTime())));
}

export function closesAtFrom(began: Date): Date {
  return new Date(began.getTime() + LIFESPAN_DAYS * DAY);
}

/**
 * Refuses a round date outside the window the other rounds set. Null when it
 * fits. Dates are `yyyy-mm-dd`; an empty or unreadable one is not refused
 * here, because an undated round is not a date outside anything.
 */
export function roundWindowRefusal(date: string, otherDates: readonly string[]): string | null {
  const ms = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T00:00:00Z`).getTime() : NaN);
  const t = ms(date);
  if (Number.isNaN(t)) return null;
  const others = otherDates.map(ms).filter((n) => !Number.isNaN(n));
  if (others.length === 0) return null;
  const all = [...others, t];
  if (Math.max(...all) - Math.min(...all) <= ROUND_WINDOW_DAYS * DAY) return null;
  return (
    `On the free ${PLANS.free.name} plan a tournament's rounds fall within ${ROUND_WINDOW_DAYS} days — ` +
    `a one-off event. A season of weekly rounds is ${PLANS.society.name}: upgrade to add this date.`
  );
}

/** What the organizer is told before they complete a tournament that this deletes. */
export const WIPE_ON_CLOSE =
  `On the free ${PLANS.free.name} plan, completing a tournament deletes it for good — entries, cards, results, prizes and money. ` +
  "Nobody can open it afterwards, not you and not the players. Download anything you want to keep from Reports first.";
