/**
 * THE NUMBER THE COURSE GIVES A HOLE — which is not always its position on
 * the card being scored.
 *
 * A nine-hole round played over the BACK nine is narrowed by `applyNine` to
 * holes 10-18, stored at indexes 0-8, and every screen printed `index + 1`. A
 * member standing on the 10th tee read "Hole 1"; the printed card headed its
 * columns 1-9 under a course name reading "(back nine)"; a shotgun group told
 * it was "starting on hole 3" walked to the 3rd rather than the 12th. Found
 * 2026-09-29, and never seen before because the seeded club has no back-nine
 * round — a US league alternating nines week to week lives in it half the
 * season.
 *
 * `applyNine` stamps `firstHole: 10` on the card it narrows to the back nine,
 * and every screen reads it through `firstHoleOf`. DISPLAY ONLY: every score,
 * stroke and pin is still stored and scored by index.
 */

export function firstHoleOf(card: object | null | undefined): number {
  const n = (card as { firstHole?: unknown } | null | undefined)?.firstHole;
  return n === 10 ? 10 : 1;
}

/** The number to print for the hole at `index` (0-based) on a card whose first hole is `firstHole`. */
export function holeNumber(index: number, firstHole = 1): number {
  return index + firstHole;
}

/**
 * The same answer from the ROUND, for the screens that hold a round and no
 * card — a tee time, a push notice. A nine-hole round set to the back nine
 * starts at 10; anything else at 1. Agrees with `applyNine` for every round
 * that can be set up: the back nine is only offered on an eighteen-hole card.
 */
export function firstHoleForRound(stage: { holes?: number | null; nine?: string | null } | null | undefined): number {
  return stage?.holes === 9 && stage.nine === "back" ? 10 : 1;
}

/**
 * A tee sheet's start hole — stored as a POSITION on the round's card, 1..n —
 * as the number on the course. "Hole 3" on a back-nine shotgun is the 12th.
 */
export function startHoleNumber(startHole: number, firstHole = 1): number {
  return startHole - 1 + firstHole;
}
