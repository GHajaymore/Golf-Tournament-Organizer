/**
 * A PLAYER FOUND BY ADDRESS — the one rule, as a piece of a query.
 *
 *     prisma.player.findMany({ where: { eventId, ...byAddress(session.email), status: "confirmed" } })
 *
 * Matched without regard to case: an address typed into a roster import is not
 * necessarily cased the way the same person typed it when signing up.
 *
 * AN EMPTY ADDRESS MATCHES NOBODY. `email: { equals: "" }` does not mean "no
 * rows": it means every entry made without an address, and those exist (round
 * codes, a committee's own typing). Asked "which entries are mine", the answer
 * would not be a blank screen — it would be one signed-in person handed every
 * address-less player's card, score entry, match and money. Sessions only carry
 * a real address today, which is a circumstance, not a guarantee.
 *
 * So the refusal is inside the piece itself: for an empty address it is a
 * condition no row meets, and there is nothing for a caller to remember or to
 * get round. Until 2026-10-14, 27 player queries wrote the match out for
 * themselves, and most had no refusal at all (`docs/one-rule-one-place.md`,
 * step 2); `my-entries-are-asked-one-way.test.ts` refuses another.
 */
export function byAddress(
  email: string | null | undefined,
): { email: { equals: string; mode: "insensitive" } } | { id: { in: string[] } } {
  const address = (email ?? "").trim();
  if (!address) return { id: { in: [] } };
  return { email: { equals: address, mode: "insensitive" } };
}
