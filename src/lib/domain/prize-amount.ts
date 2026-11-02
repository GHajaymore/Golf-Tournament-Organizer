import { MAX_EXPENSE_CENTS } from "./expenses";

/**
 * WHAT A PRIZE LINE MAY HOLD — one answer for `addPrize`, `updatePrize` and the
 * boxes on Prizes (the text-box crawl, 2026-10-21).
 *
 * The amount box made "-1" and "1e9" into no prize at all and said nothing, and
 * an empty Category made "Add" do nothing and say nothing. A prize's amount is in
 * whole units of the club's currency (not minor units, unlike a stake), held to
 * the same ceiling every money action uses.
 */
export const PRIZE_AMOUNT_MAX = MAX_EXPENSE_CENTS / 100;
export const PRIZE_CATEGORY_MAX = 80;
export const PRIZE_DETAIL_MAX = 120;

/** A blank Category, said beside Add. */
export const PRIZE_CATEGORY_BLANK = "Name the prize first, like Flight 1 — Winner.";

/** Null when this amount will do; otherwise what to say. NaN is a box with no figure in it. */
export function prizeAmountRefusal(amount: number): string | null {
  if (Number.isNaN(amount)) return "Enter the amount as a figure, like 50.";
  if (amount < 0) return "A prize can't be less than nothing.";
  if (!Number.isFinite(amount) || amount > PRIZE_AMOUNT_MAX) return "That amount is too large to record.";
  return null;
}
