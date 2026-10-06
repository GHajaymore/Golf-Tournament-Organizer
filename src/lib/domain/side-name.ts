/**
 * IS A SIDE NAMED AFTER ITS PLAYERS? (2026-10-06)
 *
 * A side nobody named is called by its players — "Ann Doyle / Bob Ellery",
 * the way `actions/league.ts` builds one — and every board printed that name
 * and then the same two names again underneath as its members. On a phone
 * that was the side's row twice over; on the team board it was most of a 230px
 * row, a 72-side board seventeen screens long.
 *
 * So the members line is printed only where it says something the name does
 * not: a side with a name of its own ("The Bandits"), or with nobody in it.
 * One reader, so the boards cannot drift into four different answers.
 */
export function namedAfterPlayers(name: string, members: string[]): boolean {
  return members.length > 0 && members.join(" / ") === name;
}
