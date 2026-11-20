/**
 * Money arithmetic, owned by neither feature that uses it.
 *
 * `splitExactly` and `settle` were written for the skins pot and are now also
 * the foundation of the shared-expense ledger. They live here so neither
 * feature owns the other's maths, and — the part that matters — so there is
 * exactly ONE settlement implementation in this app. Two implementations that
 * can disagree about money is the defect class the 2026-08-12 audit was full
 * of, and it is far worse when the disagreement is about what somebody owes.
 *
 * Everything is INTEGER CENTS. A float is how a settle-up ends up a penny out
 * and an evening ends up an argument.
 *
 * `domain/skins-pot.ts` re-exports both, so existing callers are untouched.
 */

/**
 * Split `totalCents` in proportion to `weights`, exactly.
 *
 * Largest remainder: give everyone their whole-cent share, then hand the odd
 * cents to whoever was rounded down hardest. Ties broken by order, so the
 * result is deterministic rather than depending on sort stability.
 *
 * The point is the guarantee — the parts always sum to the whole. A pot of £60
 * across 7 skins is £8.571428..., and any method that rounds each share
 * independently loses or invents a few pence.
 *
 * Positive totals only: a negative total is meaningless for a pot, and the
 * expense ledger handles a refund by splitting its magnitude and negating the
 * parts, which keeps that decision where the refund is (see domain/expenses).
 */
export function splitExactly(totalCents: number, weights: number[]): number[] {
  const total = Math.max(0, Math.round(totalCents));
  /**
   * IN WHOLE NUMBERS, NOT FLOATS (2026-11-09). Each share is
   * `floor(total x w / sum)` and its remainder `(total x w) mod sum` — an exact
   * integer, so two remainders that are equal ARE equal and "ties broken by
   * order" holds. It took `exact - Math.floor(exact)` in floating point, where
   * 1166.67 - 1166 comes out a hair under 166.67 - 166: a $5 skins game of
   * three, skins 1 / 1 / 7, every remainder exactly two-thirds, was paid
   * 167 / 166 / 1167 where its own rule says 167 / 167 / 1166.
   *
   * Weights are whole numbers — skins won, shares of an expense, pots made —
   * and are rounded to them here, since a remainder is only exact over integers.
   */
  const whole = weights.map((w) => (Number.isFinite(w) ? Math.max(0, Math.round(w)) : 0));
  const sum = whole.reduce((a, w) => a + w, 0);
  if (sum <= 0 || total === 0) return weights.map(() => 0);

  const floors = whole.map((w) => (total * w - ((total * w) % sum)) / sum);
  let left = total - floors.reduce((a, f) => a + f, 0);

  // Biggest remainder first; index order settles a dead heat.
  const order = whole
    .map((w, i) => ({ i, rem: (total * w) % sum }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);

  const out = [...floors];
  for (const { i } of order) {
    if (left <= 0) break;
    out[i] += 1;
    left -= 1;
  }
  return out;
}

/**
 * WHAT IS IN A POT: the stake times the entrants, in whole cents.
 *
 * One function since 2026-10-23. Six places multiplied it out for themselves,
 * and the tournament report's side-game line multiplied by the wrong count:
 * the players whose net was not nought, which leaves out anybody whose share
 * came to exactly their stake — "2 in: a $10 pot" for a pot of five at $5. The
 * entrants are the people who put the stake in, never the people it moved.
 */
export function potCents(stakeCents: number, entrants: number): number {
  const stake = Math.max(0, Math.round(stakeCents));
  const count = Math.max(0, Math.floor(entrants));
  return stake * count;
}

export interface Transfer {
  fromPlayerId: string;
  toPlayerId: string;
  cents: number;
}

/**
 * Who actually hands money to whom.
 *
 * Everybody-pays-everybody is arithmetically correct and socially useless: a
 * twelve-player league would settle with sixty-six handshakes. Netting it out
 * turns that into a handful.
 *
 * Greedy largest-debtor against largest-creditor. It does not always find the
 * theoretical minimum number of transfers — that problem is NP-hard — but it
 * is within one of it in practice, runs instantly, and produces a sheet a
 * treasurer can read. Deterministic: ties broken by player id so the same
 * week always settles the same way.
 */
export function settle(nets: Array<{ playerId: string; netCents: number }>): Transfer[] {
  const debtors = nets
    .filter((n) => n.netCents < 0)
    .map((n) => ({ id: n.playerId, owed: -n.netCents }))
    .sort((a, b) => b.owed - a.owed || a.id.localeCompare(b.id));
  const creditors = nets
    .filter((n) => n.netCents > 0)
    .map((n) => ({ id: n.playerId, due: n.netCents }))
    .sort((a, b) => b.due - a.due || a.id.localeCompare(b.id));

  const out: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].owed, creditors[j].due);
    if (pay > 0) {
      out.push({ fromPlayerId: debtors[i].id, toPlayerId: creditors[j].id, cents: pay });
      debtors[i].owed -= pay;
      creditors[j].due -= pay;
    }
    if (debtors[i].owed === 0) i += 1;
    if (creditors[j].due === 0) j += 1;
  }
  return out;
}
