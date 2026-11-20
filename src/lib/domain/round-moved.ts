import { formatDay } from "./locale";

/**
 * WHETHER A ROUND'S MOVE IS NEWS, AND WHAT IT SAYS (J39/J40 PR 2; design
 * §4.3, the stand-up's proposal P2).
 *
 * A guest has no email and no phone (ruled 7 Nov), so when the committee moves
 * a round's day after the field could see it, a push is the only way the
 * guest hears of it before turning up on the wrong Saturday. Pure, so the
 * three branches are tested without a database:
 *
 *   - a first dating (no day before) is not a move: nobody planned around it;
 *   - the same day again is not a move;
 *   - before the field could see the day (`told` false: the event not yet
 *     launched to players), nobody is told — the organizer is still building.
 *
 * Clearing a day IS news ("no longer on Sat 21 Nov"): somebody planned around it.
 *
 * `playedOn` is a club DAY string, never an instant: it is written through
 * `formatDay` (`date-words.ts`) in the club's own language, and never through
 * `new Date(playedOn)` in the server's zone (the club-clock rule).
 */

export interface RoundMove {
  /** The round's day before the save, "" when it had none. */
  before: string;
  /** The day saved, "" when it was cleared. */
  after: string;
  /** Whether the field could see the old day: the event has been launched to players. */
  told: boolean;
  /** "Round 2", or "" for a one-round event. */
  roundLabel: string;
  eventName: string;
  /** The club's locale, for the day's words. */
  locale: string;
  /** The club's word for who runs it: organizer or organiser (`golf-terms.ts`). */
  organizer: string;
}

export interface RoundMovedWords {
  title: string;
  body: string;
}

export function roundMovedNotice(m: RoundMove): RoundMovedWords | null {
  const before = (m.before ?? "").trim();
  const after = (m.after ?? "").trim();
  if (!before || after === before || !m.told) return null;
  const round = m.roundLabel || "Your round";
  const event = m.eventName || "your event";
  if (!after) {
    return {
      title: `${round} is no longer on ${formatDay(before, m.locale)}`,
      body: `Your ${m.organizer || "organizer"} will say when it is. · ${event}`,
    };
  }
  return {
    title: `${round} has moved to ${formatDay(after, m.locale)}`,
    body: `It was on ${formatDay(before, m.locale)}. · ${event}`,
  };
}

/**
 * THE ORGANIZER'S LINE BESIDE PUBLISH AND BESIDE A MOVED DAY: how many entries
 * a push cannot reach (no account with notices on, no guest phone with them
 * on). A count, never names. Empty when everybody can be reached.
 */
export function noticesOffWords(count: number): string {
  if (count <= 0) return "";
  return `${count} ${count === 1 ? "player has" : "players have"} notices off. Tell them in person.`;
}
