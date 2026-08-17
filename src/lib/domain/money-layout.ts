/**
 * What the money screen is for, which depends on who is running the golf.
 *
 * Two different things were being served by one page.
 *
 * A CLUB or golf course runs competitions. Money means the pots — the skins,
 * the sweep, closest to the pin — won round by round and settled round by
 * round, usually in cash at the bar the same evening. Nobody splits a cart fee
 * with the club; they pay the pro shop. A shared expense ledger on that screen
 * is a feature from somebody else's outing, and worse than useless: it invites
 * a member to think the club owes them for the buggy.
 *
 * A SOCIETY or a private outing has both. They play for the same pots AND they
 * share real costs — the minibus, the green fees, dinner — which somebody
 * fronted and everybody owes a share of. That is what the ledger is for, and
 * it is the reason it was built rather than pointing people at Splitwise.
 *
 * The payout is round-based either way. Money is won on a given day, by a
 * given card, and a season-long running total is meaningless to a league that
 * settles every Thursday. What differs is whether there is also a ledger, and
 * — for the outings that have one — whether it is read daily or at the end.
 */

import { orgProfile } from "./org-profile";

export interface MoneyLayout {
  /**
   * Round-by-round winnings. Always on: a pot belongs to the round it was
   * played for.
   */
  rounds: true;
  /** Shared costs and the settle-up. Off for a club. */
  ledger: boolean;
  /** One line saying what this screen covers, in the club's own terms. */
  blurb: string;
}

export function moneyLayoutFor(orgKind: string): MoneyLayout {
  // The kind decides it, and org-profile is where the kinds are defined —
  // this asks rather than re-deciding what a club is.
  const { ledger } = orgProfile(orgKind);
  return {
    rounds: true,
    ledger,
    blurb: ledger
      ? "What each round's pots paid out, and what everyone owes on the shared costs."
      : "What each round's pots paid out, once the round is final.",
  };
}

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
