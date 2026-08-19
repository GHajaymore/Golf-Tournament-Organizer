/**
 * Whether a round's money can be shown yet.
 *
 * Final only, never live. A skins pot mid-round is money that can still move:
 * a player looking at £40 on the 14th who finishes with nothing has been told
 * something the app had no business claiming, and he will remember it. The
 * carry is the whole character of skins — one hole can take the lot — so a
 * running position is not an early view of the answer, it is a different
 * number that happens to look like one.
 *
 * A round is final when every hole that will be played has been returned. An
 * abandoned round never reaches that, which is correct: its pot has not been
 * won and should not be reported as if it had.
 *
 * ── This file used to also hold `moneyLayoutFor` ──────────────────────────
 *
 * It answered "does this screen have a ledger?" from the org KIND. That is a
 * second implementation of a rule `resolveMoneyMode` already owns, and it
 * disagreed the moment a club set one tournament to split: the override was
 * honoured by the tab and overruled by the layout, so the organizer got a
 * money screen with no ledger on it. `me/money/page.tsx` was fixed to stop
 * asking it, which left the function dead — imported by nothing but its own
 * test, and still wrong.
 *
 * Removed on 2026-08-18 rather than left lying about. Dead code that encodes a
 * superseded rule is not inert: the next person to need "should this screen
 * show a ledger?" finds a function with exactly that name and reintroduces the
 * bug. One rule, one reader — `resolveMoneyMode` for the ledger and the kitty,
 * `moneyScreenApplies` for whether the screen exists at all.
 */
export function roundMoneyIsFinal(input: {
  /** Holes with a returned score, across the pot's entrants. */
  holesReturned: number;
  /** Holes the round is played over. */
  holeCount: number;
  /** The organizer has closed the round. */
  roundComplete: boolean;
}): boolean {
  if (input.holeCount <= 0) return false;
  if (input.roundComplete) return true;
  return input.holesReturned >= input.holeCount;
}
