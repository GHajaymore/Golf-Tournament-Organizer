import { unplacedWorking } from "./figure-working";

/**
 * CLOSING A ROUND WITH A CARD MISSING (R12): who is missing, and the two answers a committee gives for each.
 *
 * NO DIRECTIVE, so the page (server) and the panel (client) both read it. Nothing here writes: "No card returned" is not a
 * stored fact but what closing the round MEANS for somebody with no card (`missedAClosedRound`: no place on a stroke
 * board, and the board says why with `unplacedWorking`), and "Withdrew" is the withdrawal path that already exists
 * (`removeSignup`, which after launch always keeps the player, so the sheet lists WD). Two answers, no new store.
 */

export interface MissingCardPlayer {
  id: string;
  name: string;
}

/**
 * The players this round is still owed a card from: in the round's field, not marked out for the week, and holding no
 * hole on any card for it. `withACard` is the ids whose card for the round has at least one stroke (`hasAnyStroke`, the close check's own line).
 * `field` is the round's own field: after a cut, the players it left in (`strokeCutField`), never the whole entry.
 */
export function playersWithNoCard(
  field: readonly MissingCardPlayer[],
  withACard: ReadonlySet<string>,
  markedOut: ReadonlySet<string>,
): MissingCardPlayer[] {
  return field.filter((p) => !withACard.has(p.id) && !markedOut.has(p.id));
}

/**
 * What "No card returned" means for this round, in the board's own sentence (`unplacedWorking`, with its Rule), so the
 * panel before the press and the board after it are one fact in one set of words.
 */
export function noCardReturnedWords(round: string): { says: string; cite: string } {
  const w = unplacedWorking({ ranked: false, thru: 0, missedRound: round });
  // `missedRound` is non-empty, so the board always has a sentence for it.
  return { says: w?.says ?? "", cite: w?.cite ?? "" };
}

/** The word on a missing player's line: the answer the board will give if nothing else is pressed. */
export function noCardReturnedLabel(round: string): string {
  return `No card returned: ${round}`;
}

/** What the other answer does, said before it is pressed: event-wide, kept on the sheet, and undone by Put back. */
export const WITHDREW_WORDS =
  "Withdrew is for a player who has left or will not play again: it takes them out of the rest of the event as well and lists them WD on the results sheet (DNS if they never began). A player who only missed this round and plays the next is No card returned. Put back, on Players, undoes it.";

/** Said beside the list: somebody away for the week is not a missing card, and the filter that leaves them out is named. */
export const MARKED_OUT_WORDS = "Somebody who is away only this week is marked out for the week on Players, and is not listed here.";

/** The panel's one-line state, shown on its folded line on a phone. */
export function closingState(closed: boolean, missing: number, round: string): string {
  if (closed) return `${round} is closed`;
  if (missing > 0) return `${missing} ${missing === 1 ? "card" : "cards"} to come`;
  return "Cards are in";
}
