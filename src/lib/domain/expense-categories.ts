/**
 * What a golf trip actually costs, as the categories somebody would file it
 * under.
 *
 * The column existed with no picker, so every line was filed under nothing
 * and the ledger could not answer "what did the lodging come to" — the first
 * question anybody asks when they are deciding whether to go again.
 *
 * The list is short and golf-shaped rather than a general expense taxonomy.
 * A trip has lodging, travel and food; it does not have "office supplies",
 * and a picker that offers thirty categories to describe eight lines makes
 * the form worse.
 *
 * `other` is deliberately last and deliberately present: a category list with
 * no escape hatch gets one line filed wrongly rather than filed honestly.
 */
export const EXPENSE_CATEGORIES = [
  { key: "lodging", label: "Lodging" },
  { key: "travel", label: "Travel" },
  { key: "fuel", label: "Fuel" },
  { key: "green-fee", label: "Green fees" },
  { key: "cart", label: "Cart fees" },
  { key: "caddie", label: "Caddie" },
  { key: "food", label: "Food and drinks" },
  { key: "practice", label: "Range and practice" },
  { key: "prize", label: "Prizes and trophies" },
  { key: "other", label: "Other" },
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]["key"];

const KEYS = new Set(EXPENSE_CATEGORIES.map((c) => c.key as string));

/** True when a stored value is one this app offers. */
export function isExpenseCategory(v: string): v is ExpenseCategory {
  return KEYS.has(v);
}

/**
 * The label for a stored value, falling back to the value itself.
 *
 * A row filed before this list existed, or under a category since removed,
 * still shows what it says rather than becoming blank — the ledger is a
 * record, and a record that quietly drops a word is worse than an odd one.
 */
export function expenseCategoryLabel(v: string): string {
  return EXPENSE_CATEGORIES.find((c) => c.key === v)?.label ?? v;
}

/**
 * Totals per category, largest first.
 *
 * The reason the column is worth having: "what did we spend on lodging" is
 * the question a group asks when deciding whether to do it again, and adding
 * it up by hand from a list of lines is exactly the spreadsheet this replaces.
 */
export function totalsByCategory(
  rows: ReadonlyArray<{ category: string; amountCents: number }>,
): Array<{ category: string; label: string; cents: number }> {
  const totals = new Map<string, number>();
  for (const r of rows) {
    const key = r.category?.trim() || "other";
    totals.set(key, (totals.get(key) ?? 0) + r.amountCents);
  }
  return [...totals.entries()]
    .map(([category, cents]) => ({ category, label: expenseCategoryLabel(category), cents }))
    .sort((a, b) => b.cents - a.cents || a.label.localeCompare(b.label));
}
