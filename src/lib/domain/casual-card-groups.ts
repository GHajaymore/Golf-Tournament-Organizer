/**
 * WHO SHARES A CARD IN A CASUAL ROUND, which has no tee sheet to say.
 *
 * Score entry's hole-by-hole view scores a tee GROUP — every player on the
 * card, hole by hole — and falls back to one player at a time when the round
 * has no tee sheet. A casual round never has one, so a two-ball scored at the
 * course meant eighteen holes for one player, then switching the picker and
 * doing it again for the other: walked at 393px on 2026-10-04. The scorer
 * standing on the green wants the hole, with everybody on it.
 *
 * So a casual round's players ARE the card, in the field's order. A group of
 * golf is four at most — a fourball, and every tee sheet's — so five to eight
 * players are two cards, split evenly.
 */

/** The most players one card is scored for at a time. */
export const CARD_GROUP_MAX = 4;

export interface CardGroup {
  name: string;
  time: string;
  playerIds: string[];
}

export function casualCardGroups(playerIds: readonly string[]): CardGroup[] {
  if (playerIds.length === 0) return [];
  const groups: string[][] = [];
  // Even halves rather than four-then-the-rest: five players is a three and a
  // two, not a four and a single left to score on their own.
  const count = Math.ceil(playerIds.length / CARD_GROUP_MAX);
  const size = Math.ceil(playerIds.length / count);
  for (let i = 0; i < playerIds.length; i += size) groups.push(playerIds.slice(i, i + size));
  return groups.map((ids, i) => ({
    name: groups.length === 1 ? "Everyone" : `Group ${i + 1}`,
    time: "",
    playerIds: ids,
  }));
}
