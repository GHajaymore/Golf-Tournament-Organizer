/**
 * How long a casual round is kept, and what may be swept away when it is not.
 *
 * A quick round is disposable by design. It is created in one screen, played
 * the same morning, and read once — and the app should not accumulate a
 * lifetime of "zz v Sam, Sunday" events between the tournaments somebody
 * actually runs. So a casual round carries an expiry and a tournament does
 * not.
 *
 * EVERYTHING HERE IS ABOUT MAKING A DELETION UNABLE TO REACH THE WRONG ROW.
 * That is not caution for its own sake: this is the only scheduled DELETE in
 * the product, it runs unattended against production, and a tournament it
 * removed would take its field, its cards, its money and its history with it,
 * with nobody watching and no way back. The rules are therefore:
 *
 *   1. An expiry is STORED, never inferred. `expiresAt` is set by exactly one
 *      caller and every other row in the database has null. The condition is
 *      `expiresAt < now` and nothing else, so a tournament is unreachable even
 *      if every other part of the query is wrong. The rejected alternative —
 *      "delete anything with shape = 'match' older than a day" — reads a
 *      row's LIFETIME off a description of the GAME, and those come apart.
 *   2. It is CLEARABLE. `keepForever` sets it back to null, so a round worth
 *      keeping is one button away from permanent. A default that destroys
 *      something has to have an exit before it ships.
 *   3. The window is generous and stated. Nobody is told a round is kept for
 *      a day and then finds it gone in twenty hours.
 */

/**
 * How long a casual round lives.
 *
 * A day, measured from when it was SET UP rather than when it was finished.
 * Finishing is the more flattering clock and the wrong one: a round nobody
 * ever entered a score on never finishes, so it would never expire, and those
 * are precisely the rows this exists to clear — the abandoned "let's play
 * Sunday" that never happened.
 *
 * A day is comfortably longer than the gap between setting a round up and
 * playing it, which is the case that must never lose data. Somebody arranging
 * a game more than a day ahead is doing something the round-expiry rule should
 * not silently punish, which is why `keepForever` exists.
 */
export const QUICK_ROUND_TTL_HOURS = 24;

const HOUR_MS = 60 * 60 * 1000;

/** When a round set up now should stop existing. */
export function expiryFrom(createdAt: Date): Date {
  return new Date(createdAt.getTime() + QUICK_ROUND_TTL_HOURS * HOUR_MS);
}

/**
 * Whether this row may be swept, given only what the row says.
 *
 * The whole rule, in one place, so the query and the screen cannot disagree
 * about what is about to happen. A row with no expiry is never expired — that
 * is the tournament case and it is checked FIRST, before anything about dates,
 * because a null compared against a date is the class of bug that quietly
 * answers "yes".
 */
export function isExpired(
  event: { expiresAt?: Date | null },
  now: Date = new Date(),
): boolean {
  const at = event.expiresAt;
  if (!at) return false;
  return at.getTime() <= now.getTime();
}

/**
 * How long is left, in whole hours, or null for a round that never expires.
 *
 * Rounded DOWN and floored at zero, so the screen never promises time that has
 * already gone. "1 hour left" on a round with fifty minutes on it is the
 * direction that loses somebody's card.
 */
export function hoursLeft(
  event: { expiresAt?: Date | null },
  now: Date = new Date(),
): number | null {
  const at = event.expiresAt;
  if (!at) return null;
  return Math.max(0, Math.floor((at.getTime() - now.getTime()) / HOUR_MS));
}

/**
 * What the player is told, before it happens rather than afterwards.
 *
 * Deliberately plain about the consequence — "deleted", not "archived" or
 * "cleared" — because those read as recoverable and this is not. The sentence
 * always names the way out, because a warning with no action attached is just
 * bad news.
 *
 * NO COUNTDOWN, and that is a correction rather than a simplification. The
 * first version said "deleted in about 7 hours", read straight off
 * `hoursLeft`, and it would have been a lie: the sweep runs once a day, so a
 * round that expires at 07:00 is not actually removed until the next pass.
 * Promising an hour the app cannot keep is worse than promising a day it can,
 * because the person who believes the precise version is the one who waits.
 *
 * `hoursLeft` is still the right reading of the COLUMN, and stays for anything
 * that wants it. It is just not what the player should be told.
 */
export function expiryNotice(hours: number | null): string {
  if (hours === null) return "";
  if (hours <= 0) {
    return "This round has passed its day and will be deleted shortly. Keep it to hold on to the scores.";
  }
  return "This round is temporary — it's deleted about a day after it was set up. Keep it to hold on to the scores.";
}
