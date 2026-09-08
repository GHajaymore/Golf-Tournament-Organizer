/**
 * How a bill divided, in the four words a person can check.
 *
 * THE DIVISION, NOT THE COUNT. This line once said "6 shares". A count is not
 * checkable; a division is — "$1,986.00 ÷ 6" is arithmetic somebody can do in
 * their head and then trust, which is the whole job of a ledger nobody
 * audited.
 *
 * And it says ÷ only when the split really is even. Printing "÷ 4" over a
 * 2:2:2:1 room-night split would be a tidy lie: the numbers would not come out
 * and the one person who checked would stop believing the rest of the screen.
 * An uneven or exact-amount line says "across" instead, which claims nothing
 * about how.
 *
 * Lifted out of `MoneyClient` because it is a rule about money rather than a
 * piece of layout, and because a rule living in a component's private helper
 * is a rule no test can reach without rendering the screen — which for this
 * one means seeding a whole ledger.
 */

export interface SplitShare {
  weight: number;
  /** The exact amount typed for this person, or null when split by weight. */
  exactCents: number | null;
}

/**
 * The words after the payer's name — WITHOUT a leading separator.
 *
 * The separator is the caller's, deliberately. This used to return its own
 * " · " while the caller also printed one, so every expense row on the money
 * screen rendered "Paid by Priya Nair · · $30.00 ÷ 2". A fragment that
 * carries its own punctuation cannot be composed, and the doubled dot was the
 * proof.
 */
export function splitLabel(
  amountCents: number,
  shares: ReadonlyArray<SplitShare>,
  money: (cents: number) => string,
): string {
  // On the bill means carrying weight OR having had an exact amount typed —
  // somebody at a weight of zero is present and owing nothing, which is a
  // different fact from never having been on it.
  const on = shares.filter((s) => s.weight > 0 || (s.exactCents ?? 0) !== 0);
  if (on.length === 0) return "no shares";

  const exact = on.some((s) => s.exactCents !== null && s.exactCents !== 0);
  const even = !exact && on.every((s) => s.weight === on[0].weight);
  return `${money(amountCents)} ${even ? "÷" : "across"} ${on.length}`;
}
