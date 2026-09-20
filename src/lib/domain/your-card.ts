/**
 * WHAT TO TELL A PLAYER WHOSE ROUND IS SCORED FOR THEM.
 *
 * Two shapes reach this: a team round, where the card belongs to the side, and
 * a match, where the score is kept against an opponent. Neither gives the
 * player a card of their own, which is the thing they have just tapped on.
 *
 * The screen said both at once — "a match is recorded against your opponent,
 * and a team round on your side's card" — on a round that is only ever one of
 * them, and then ended "it appears on the board as soon as it's in" WHATEVER
 * had happened. Read off the seeded club on 2026-09-20, four inches under a
 * panel saying "Round complete · 35 gross, 26 net · 5th of 8 sides".
 *
 * A sentence that is true before the round and false after it is a sentence
 * nobody can act on. `/me/card` was fixed for exactly this on the same day;
 * this is the rule both screens read, so the pair cannot drift apart again.
 *
 * HERE RATHER THAN IN THE PAGE because a server component cannot be rendered
 * in a unit test, and a rule that can only be checked by looking at it is a
 * rule that goes wrong quietly. See `matrix.test.ts` on asserting the rule
 * rather than the current behaviour.
 */
export interface SideProgress {
  /** Holes the side has written down. */
  played: number;
}

export function yourCardNote(input: { side: SideProgress | null; holes: number }): string {
  const { side, holes } = input;
  const whose = side
    ? "This round is played in sides, so the card belongs to your side rather than to you."
    : "This round is scored by your organizer — your score is recorded against your opponent rather than as your own card.";

  /**
   * "In" means every hole, not "somebody has written something down".
   *
   * The same line `roundProgress` draws for a side: a `TeamScorecard` carries
   * no marker's signature, so the strongest thing that can honestly be said
   * about it is that there is nothing left to write down. Below that, the
   * player is told where their side has got to rather than being promised an
   * arrival that has already half happened.
   */
  if (!side || side.played <= 0) return `${whose} It appears on the board as soon as it’s in.`;
  if (holes > 0 && side.played >= holes) return `${whose} Your side’s card is in.`;
  return `${whose} Your side is thru ${side.played}.`;
}
