/**
 * WHAT A PLAYER'S INDEX SAYS ON A SCREEN.
 *
 * One function because five screens print this number, and until 2026-09-18
 * every one of them printed it raw — so a member nobody has an index for read
 * as **0**, which is a scratch golfer. `handicap-policy.ts` calls that outcome
 * catastrophic and exists to make it impossible:
 *
 *   "A 24-handicapper playing off scratch does not look like an outage; it
 *    looks like a competition, and it is settled and paid out before anybody
 *    works out why the results are absurd."
 *
 * `handicapSource: "none"` is how the rest of the app already says nobody has
 * claimed a figure. `upsertMember` writes it deliberately — a club playing off
 * association indexes gets "an unfinished roster row rather than a player at
 * zero" — and the entry path copies it onto the Player, so every screen that
 * shows a field can tell the two apart. They just have to ask.
 *
 * ONE READER RATHER THAN FIVE, for the reason this codebase gives every time:
 * the sixth screen is written by somebody who never read this paragraph, and a
 * rule that lives in five components is five chances to print a zero.
 */
export interface IndexLike {
  handicap: number;
  /** "18" or "9" — which index the figure represents. */
  handicapType?: string | null;
  /** ghin | manual | none. "none" means nobody has claimed a figure. */
  handicapSource?: string | null;
}

/** The words for a missing index. One string, so five screens cannot differ. */
export const NO_INDEX = "no index";

export function indexLabel(p: IndexLike): string {
  if ((p.handicapSource ?? "manual") === "none") return NO_INDEX;
  // The nine-hole marker rides along, because "12.4" and "12.4 over nine" are
  // different figures and a screen that drops the distinction is wrong in the
  // direction that allocates the wrong shots.
  return p.handicapType === "9" ? `${p.handicap} (9)` : `${p.handicap}`;
}

/**
 * Whether this figure is safe to play off.
 *
 * Separate from the label because a screen asking "may I sort by this" is
 * asking something different from "what do I print". A missing index is not a
 * small number: it is the absence of one, and code that sorts, balances
 * flights or pairs on it is making a decision from nothing.
 */
export function hasIndex(p: IndexLike): boolean {
  return (p.handicapSource ?? "manual") !== "none";
}
