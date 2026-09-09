/**
 * Whether a player's own standing has anything in it yet.
 *
 * The player screen leads with one card carrying the biggest type on the
 * phone: their position on the left, their score on the right. It is built as
 * two independent halves, and each half falls back to the words "Not started"
 * on its own — so before a ball is struck it rendered
 *
 *     Not started                    Not started
 *     –                                        –
 *     0-0-0
 *
 * a screen-height of display type saying one word, twice, and nothing else.
 * That is the state the screen is in MOST often: a player opens it walking to
 * the first tee.
 *
 * Read off a launched tournament on 2026-09-09, on a 375px viewport.
 *
 * TWO TESTS, NOT ONE, and the second is the one that matters. A position is
 * the ordinary signal, but a card that stopped short holds holes and NO
 * position — `isRanked` refuses to rank it, deliberately, because ranking a
 * fourteen-hole card against an eighteen-hole one presents two numbers as
 * comparable when they are not. Asking about the position alone would hide the
 * card of a player who has actually played, which is the opposite failure and
 * a worse one: they have something to see and the app would show them nothing.
 */
export interface PlayerStandingSummary {
  /** "1", "T2", or "" where no position was awarded. */
  position?: string;
  /** Holes this player's own cards cover. */
  thru?: number;
}

export function hasStandingToShow(standing: PlayerStandingSummary | null | undefined): boolean {
  if (!standing) return false;
  return !!standing.position || (standing.thru ?? 0) > 0;
}
