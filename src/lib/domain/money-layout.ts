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
/**
 * EVERY SIDE GAME, AND WHEN ITS AMOUNT MAY BE REPORTED (2026-10-23).
 *
 * The question is never "has the event happened" — it is "CAN THE AMOUNT STILL
 * CHANGE" (CLAUDE.md, "Money: what may be reported while a round is live"):
 *
 *   when-the-round-is-final   the amount is a share RELATIVE to everybody else's
 *                             card, so any hole still to play can move it. A skin
 *                             carries into the next hole; a birdie on the 3rd is a
 *                             fifth of the pot once four more are made; low gross
 *                             and low net mid-round are whoever is furthest round.
 *   as-each-bet-is-decided    a wager between two sides on a match or a segment
 *                             of one. A front nine that is over, or a match closed
 *                             out 3&2, cannot be re-decided by holes still to come,
 *                             so it pays the moment it is decided — withholding it
 *                             would hide a settled result.
 *   when-a-winner-is-named    nobody's card records who was nearest the pin: the
 *                             committee names the winner, and the naming is the
 *                             result.
 *
 * `gameNets` asks this of every game it settles, and `saveSideGame` offers no
 * kind that is not here, so a game added later has to say which it is.
 */
export const SIDE_GAME_PAYS = {
  skins: "when-the-round-is-final",
  "low-gross": "when-the-round-is-final",
  "low-net": "when-the-round-is-final",
  birdies: "when-the-round-is-final",
  eagles: "when-the-round-is-final",
  twos: "when-the-round-is-final",
  nassau: "as-each-bet-is-decided",
  match: "as-each-bet-is-decided",
  contest: "when-a-winner-is-named",
} as const;

export type SideGameKind = keyof typeof SIDE_GAME_PAYS;
export type WhenItPays = (typeof SIDE_GAME_PAYS)[SideGameKind];

/** The games a round's cards (or its matches) settle: every kind but a contest and skins, which have their own tables. */
export const CARD_SIDE_GAMES = ["low-gross", "low-net", "birdies", "eagles", "twos", "nassau", "match"] as const;

export function isSideGameKind(kind: string): kind is SideGameKind {
  return Object.prototype.hasOwnProperty.call(SIDE_GAME_PAYS, kind);
}

/** When this game's amount may be reported, or null for a kind the app does not know (which pays nothing). */
export function paysWhen(kind: string): WhenItPays | null {
  return isSideGameKind(kind) ? SIDE_GAME_PAYS[kind] : null;
}

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
