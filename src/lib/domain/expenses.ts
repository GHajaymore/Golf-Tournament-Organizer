/**
 * Shared expenses on an outing, and the one number that makes this worth
 * building.
 *
 * Splitwise splits costs and does it well, so copying it adds nothing. The
 * feature worth having is the ONE LEDGER: Dave owes $40 in skins, lost $20 on
 * the Nassau, and paid $260 for dinner, and the app answers with a single net
 * figure. No general expense app can do that, because none of them know the
 * golf.
 *
 * Pure — no Prisma, no clock, no formatting. Integer cents throughout: a float
 * is how a settle-up ends up a penny out and an evening ends up an argument.
 * Settlement itself is NOT here; this produces `nets` and hands them to the
 * one `settle()` in domain/money.ts, because two settlement implementations
 * that can disagree about money is precisely the defect class the 2026-08-12
 * audit was full of.
 *
 * The app calculates and records money. It never moves it.
 */

import { splitExactly } from "./money";

export interface ExpenseShare {
  playerId: string;
  /** Relative weight. 1 each is an even split; 0 excludes without deleting. */
  weight: number;
}

export interface Expense {
  id: string;
  description: string;
  /**
   * Integer cents. NEGATIVE is allowed and means a refund or credit — a
   * returned deposit, a cancelled cart, a club that took too much off the
   * card. It is split exactly like a charge and lands the other way round, so
   * a refund shared by four is four people each owed a quarter of it.
   */
  amountCents: number;
  /** The player who actually paid the bill (or received the refund). */
  paidBy: string;
  shares: ExpenseShare[];
}

export interface Net {
  playerId: string;
  /** Positive is owed TO them; negative is owed BY them. */
  netCents: number;
}

/** Whole cents only, and no infinities — this feeds arithmetic about money. */
const clean = (cents: number): number =>
  Number.isFinite(cents) ? Math.round(cents) : 0;

/**
 * What each participant owes for one expense.
 *
 * Sums EXACTLY to `amountCents`, including for a refund: the magnitude is
 * split by the shared largest-remainder rule and the parts are then negated,
 * so a -£10.01 refund across three is -334/-334/-333 and not -334/-334/-334.
 *
 * A share with weight 0 is in the list and owes nothing — the difference
 * between "not on this bill" and "not in the outing" is worth keeping, and
 * deleting the row would lose it.
 */
export function shareOf(expense: Expense): Map<string, number> {
  const amount = clean(expense.amountCents);
  const out = new Map<string, number>();

  // Duplicate ids collapse to one share rather than charging somebody twice.
  const weights = new Map<string, number>();
  for (const s of expense.shares) {
    const w = Number.isFinite(s.weight) ? Math.max(0, Math.round(s.weight)) : 0;
    weights.set(s.playerId, (weights.get(s.playerId) ?? 0) + w);
  }

  const ids = [...weights.keys()];
  const parts = splitExactly(Math.abs(amount), ids.map((id) => weights.get(id) ?? 0));
  const sign = amount < 0 ? -1 : 1;
  ids.forEach((id, i) => out.set(id, parts[i] * sign));
  return out;
}

/**
 * The standing position across a set of expenses.
 *
 * For each expense the payer is credited what they laid out and every
 * participant is debited their share. Positive means the field owes them.
 *
 * **Sums to zero, always** — that is the invariant the whole ledger rests on,
 * and it is why anybody who appears in an expense appears in the result even
 * if they are not in `playerIds`. A player deleted from the field mid-trip
 * would otherwise take their side of the balance with them and leave the
 * ledger short; the screen can render an unknown name, but it must not render
 * money that does not add up.
 *
 * An expense whose weights are ALL zero is nobody's to share, so it is left
 * out entirely rather than being dumped on the payer: it means "I paid for
 * this myself", which is not a debt in either direction.
 */
export function balances(expenses: Expense[], playerIds: string[] = []): Net[] {
  const totals = new Map<string, number>();
  const bump = (id: string, cents: number) => {
    if (!id) return;
    totals.set(id, (totals.get(id) ?? 0) + cents);
  };

  for (const id of playerIds) if (id) totals.set(id, totals.get(id) ?? 0);

  for (const expense of expenses) {
    const amount = clean(expense.amountCents);
    if (amount === 0) continue;
    const shares = shareOf(expense);
    const shared = [...shares.values()].reduce((a, c) => a + c, 0);
    // Nothing was actually shared — a personal line on a group list.
    if (shared === 0 && [...shares.values()].every((c) => c === 0)) continue;

    bump(expense.paidBy, amount);
    for (const [playerId, cents] of shares) bump(playerId, -cents);
  }

  return [...totals.entries()]
    .map(([playerId, netCents]) => ({ playerId, netCents }))
    .sort((a, b) => b.netCents - a.netCents || a.playerId.localeCompare(b.playerId));
}

/**
 * The differentiator, in one function: the expense ledger plus the side-game
 * ledger.
 *
 * Both sides are already `netCents` in this app — skins and Nassau produce
 * exactly this shape — so combining them is addition, and the value is that it
 * happens at all. Somebody who is owed $60 for dinner and lost $45 in skins is
 * owed $15, and settles with one handshake instead of two.
 *
 * Both inputs sum to zero on their own, so the total does too. A player in
 * only one of the two ledgers appears with their side of it, which is the
 * common case for a guest who ate but did not bet.
 */
export function combinedBalances(expenseNets: Net[], gameNets: Net[]): Net[] {
  const totals = new Map<string, number>();
  for (const n of [...expenseNets, ...gameNets]) {
    if (!n.playerId) continue;
    totals.set(n.playerId, (totals.get(n.playerId) ?? 0) + clean(n.netCents));
  }
  return [...totals.entries()]
    .map(([playerId, netCents]) => ({ playerId, netCents }))
    .sort((a, b) => b.netCents - a.netCents || a.playerId.localeCompare(b.playerId));
}

/**
 * One player's line, ready for a screen that must never show a split which
 * does not add up.
 *
 * Kept here rather than in the component so the parts and the total are
 * computed once, together: the week view already has a display that shows a
 * refunded skins pot as if everyone won money — correct arithmetic, wrong
 * display — and in an expense ledger that is the bug that ends friendships.
 */
export interface PlayerPosition {
  playerId: string;
  /** What the expenses alone say. */
  expensesCents: number;
  /** What the side games alone say. */
  gamesCents: number;
  /** The one number: expenses + games. */
  netCents: number;
}

export function positionFor(
  playerId: string,
  expenseNets: Net[],
  gameNets: Net[],
): PlayerPosition {
  const of = (nets: Net[]) => nets.find((n) => n.playerId === playerId)?.netCents ?? 0;
  const expensesCents = of(expenseNets);
  const gamesCents = of(gameNets);
  return { playerId, expensesCents, gamesCents, netCents: expensesCents + gamesCents };
}

/** Even weights for the common case: everyone in, split down the middle. */
export function evenShares(playerIds: string[]): ExpenseShare[] {
  return [...new Set(playerIds.filter(Boolean))].map((playerId) => ({ playerId, weight: 1 }));
}

/** WHS-style sanity bounds, in cents. A single line on a golf trip is not
 *  £2m, and an unbounded integer here reaches the settlement maths. */
export const MAX_EXPENSE_CENTS = 100_000_000;

export function isValidAmount(cents: number): boolean {
  return (
    Number.isFinite(cents) &&
    Number.isInteger(cents) &&
    Math.abs(cents) <= MAX_EXPENSE_CENTS
  );
}
