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
  /**
   * FOOD AND DRINKS ARE TWO LINES, because some people do not drink.
   *
   * Ajay, 2026-09-19. The bar is the one cost on a golf trip that regularly
   * belongs to a different set of people from the meal, and a single category
   * hid that: "Food and drinks £420" tells a non-drinker nothing about what
   * they are being asked to pay for.
   *
   * THE SPLIT REPORTS IT; THE SHARE PICKER FIXES IT. Fairness comes from
   * putting the bar on its own line with only the drinkers on it — which this
   * ledger has always supported — and this makes that line add up to something
   * a reader can see. One without the other is half the answer.
   *
   * `food` KEEPS ITS KEY, so no stored row moves category. What does change is
   * what those rows READ: a line filed under "Food and drinks" now says
   * "Food", and some of them were the bar. Said plainly rather than implied,
   * because it is the one cost of this split — nothing can tell which old rows
   * were which, and inventing a `food-and-drinks` label to preserve the
   * ambiguity would keep every future row ambiguous too.
   */
  { key: "food", label: "Food" },
  { key: "drinks", label: "Drinks and bar" },
  { key: "practice", label: "Range and practice" },
  { key: "prize", label: "Prizes and trophies" },
  /**
   * THE EVENING, which a golf trip has as surely as it has green fees.
   * Ajay's example on 2026-09-19: a few members go to a casino and share what
   * it cost them. That is a shared cost like any other and the ledger should
   * file it as itself rather than as "Other", where it stops adding up to
   * anything.
   *
   * IT RECORDS A COST, NOT A BET. Hard rule 7 — this app works money out and
   * writes it down, it never moves any — so a night at the tables is a line
   * somebody paid, exactly like dinner. Nothing here stakes, settles or
   * returns a wager.
   */
  { key: "entertainment", label: "Entertainment and nights out" },
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
 * WHICH CATEGORY SOMEBODY MEANT, FROM WHAT THEY TYPED.
 *
 * The form asked the same question twice: "What was it for?" and then
 * "Category", so a line read "Buggies · Cart fees" and the person entering it
 * had answered the same thing in two controls. Walked on 2026-09-19.
 *
 * Deleting the category was the other option and is worse: a society deciding
 * whether to go again wants the lodging total, and a free-text line cannot be
 * added up. So the description stays the one thing anybody must type, and this
 * fills the picker in — still editable, because a guess that cannot be
 * corrected is worse than no guess.
 *
 * WORD-BOUNDED, NOT `includes`. "carts" must match `cart` while "cartilage"
 * and — the one that matters on a golf ledger — "Carnoustie" must not. Matched
 * against the whole phrase a person types, so "green fee" wins over "fee".
 *
 * Returns "" rather than "other" when nothing matches, so a caller can tell
 * "no opinion" from "deliberately filed under Other".
 */
const GUESSES: ReadonlyArray<{ category: ExpenseCategory; words: readonly string[] }> = [
  { category: "lodging", words: ["lodging", "hotel", "inn", "motel", "room", "rooms", "bnb", "airbnb", "accommodation", "lodge"] },
  { category: "travel", words: ["travel", "flight", "flights", "train", "taxi", "uber", "bus", "coach", "minibus", "ferry", "parking", "toll", "tolls"] },
  { category: "fuel", words: ["fuel", "petrol", "gas", "diesel"] },
  { category: "green-fee", words: ["green fee", "green fees", "greenfee", "greenfees", "tee time", "tee times", "round", "rounds"] },
  { category: "cart", words: ["cart", "carts", "buggy", "buggies", "trolley", "trolleys"] },
  { category: "caddie", words: ["caddie", "caddies", "caddy", "forecaddie"] },
  { category: "food", words: ["food", "lunch", "dinner", "breakfast", "meal", "meals", "halfway house", "snacks", "sandwiches", "buffet"] },
  { category: "drinks", words: ["drink", "drinks", "bar", "beer", "beers", "pint", "pints", "wine", "whisky", "whiskey", "bar tab", "round of drinks", "nineteenth"] },
  { category: "practice", words: ["range", "practice", "balls", "lesson", "lessons", "pro shop"] },
  { category: "prize", words: ["prize", "prizes", "trophy", "trophies", "medal", "medals", "engraving"] },
  { category: "entertainment", words: ["casino", "poker", "blackjack", "roulette", "tables", "show", "tickets", "night out", "cards night", "karaoke", "bowling", "pool", "darts", "greyhounds", "races", "racing"] },
];

export function guessExpenseCategory(description: string): ExpenseCategory | "" {
  const text = (description ?? "").toLowerCase();
  if (!text.trim()) return "";
  let best: { category: ExpenseCategory; length: number } | null = null;
  for (const { category, words } of GUESSES) {
    for (const word of words) {
      // Whole words only, built without a regex escape: the phrase is padded
      // and searched with the word padded too, so "cart" cannot match inside
      // "Carnoustie". See CLAUDE.md on what a backslash costs in this repo.
      const padded = ` ${text.replace(/[^a-z0-9]+/g, " ").trim()} `;
      if (padded.includes(` ${word} `) && (!best || word.length > best.length)) {
        best = { category, length: word.length };
      }
    }
  }
  return best?.category ?? "";
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
