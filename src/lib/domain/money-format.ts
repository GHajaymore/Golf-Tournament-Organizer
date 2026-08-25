/**
 * One way to write an amount, for a club anywhere.
 *
 * There were TWELVE of these — a `money()` in nearly every screen that shows
 * a number, each hard-coding a dollar sign and dividing by a hundred. A club
 * in Britain saw dollars on every one of them, and `Organization.currency`
 * was read by exactly one place in the whole app.
 *
 * That is the fault this codebase keeps paying for: one rule with many
 * readers. Money is the worst place for it, because a wrong symbol is not a
 * crash — it is a number somebody acts on.
 *
 * WHY Intl RATHER THAN A TABLE OF SYMBOLS. A hand-kept map gets the symbol
 * right and the DECIMALS wrong. Amounts are stored in minor units, and not
 * every currency has two of them: 100 stored is $1.00, and also ¥100. A club
 * in Tokyo reading every prize at a hundredth of its value would never
 * suspect the app; they would think they had typed it wrong. Intl knows how
 * many minor units a currency has, so this asks rather than assumes.
 */

/** The default, and what every existing row already means. */
export const DEFAULT_CURRENCY = "USD";

/**
 * The currencies offered in the picker.
 *
 * Deliberately a short list of the ones golf is actually organised in, rather
 * than every ISO code — a hundred-row dropdown is a worse answer to "which
 * currency is this club in" than eight. Anything else stored still FORMATS
 * correctly, because the formatter asks Intl rather than this list.
 */
export const CURRENCIES = [
  { code: "USD", label: "US dollar" },
  { code: "GBP", label: "Pound sterling" },
  { code: "EUR", label: "Euro" },
  { code: "CAD", label: "Canadian dollar" },
  { code: "AUD", label: "Australian dollar" },
  { code: "NZD", label: "New Zealand dollar" },
  { code: "ZAR", label: "South African rand" },
  { code: "JPY", label: "Japanese yen" },
] as const;

/**
 * The currency codes this runtime can actually write — 162 of them.
 *
 * Asked of `Intl.supportedValuesOf`, which IS the list, rather than inferred
 * from whether formatting produces a symbol. The inference was written first
 * and it was wrong: Intl writes the rand as "ZAR 1.00", because the rand has
 * no distinct symbol in this locale — so a symbol test rejected ZAR, a
 * currency the picker itself offers. Every currency written with its own code
 * (CHF, SEK, and a long tail) failed the same way.
 *
 * That is the shape of guard this codebase has been bitten by before: one
 * that refuses real data because the rule was a proxy for the question rather
 * than the question. Ask the list.
 */
const KNOWN_CODES: Set<string> = (() => {
  try {
    return new Set(Intl.supportedValuesOf("currency"));
  } catch {
    // A runtime without it: fall back to the offered list rather than to
    // nothing, so a club can still be set to one of the eight.
    return new Set(CURRENCIES.map((c) => c.code));
  }
})();

/**
 * Whether this is a currency code the app can actually format.
 *
 * Asked of Intl rather than of `CURRENCIES` above, and the difference matters
 * in both directions. The list is what the PICKER offers — eight, because a
 * hundred-row dropdown is a worse answer to "which currency is this club in".
 * What may be STORED is anything Intl can write, so a club that already has a
 * code from outside the list keeps it, and shortening the list later cannot
 * quietly invalidate somebody's setting.
 *
 * A `"use server"` export is a public HTTP endpoint, so this is what stands
 * between the column and whatever a caller posts.
 */
export function isCurrencyCode(v: string): boolean {
  const code = (v ?? "").trim().toUpperCase();
  // Intl accepts any three-letter string as a currency, so the shape alone
  // proves nothing: "ABC" formats happily as "ABC 1.00" and a typo would land
  // in the database looking deliberate.
  if (!/^[A-Z]{3}$/.test(code)) return false;
  return KNOWN_CODES.has(code);
}


/** How many minor units this currency divides into: 2 for most, 0 for yen. */
export function minorUnitDigits(currency: string): number {
  try {
    return (
      new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

/**
 * An amount in minor units, written for a club's currency.
 *
 * An unrecognised or empty code falls back to the default rather than
 * throwing: a bad row must not take a money screen down, and showing the
 * number in dollars is recoverable where showing nothing is not.
 */
export function money(minorUnits: number, currency: string = DEFAULT_CURRENCY): string {
  const code = (currency || DEFAULT_CURRENCY).toUpperCase();
  const value = Number.isFinite(minorUnits) ? minorUnits : 0;
  try {
    const fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: code });
    const digits = fmt.resolvedOptions().maximumFractionDigits ?? 2;
    return fmt.format(value / 10 ** digits);
  } catch {
    const fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: DEFAULT_CURRENCY });
    return fmt.format(value / 100);
  }
}

/**
 * What somebody typed, as minor units — the exact inverse of `money`.
 *
 * The formatter was made currency-aware and the PARSER was not, which left the
 * bug in the more dangerous half. Every input did `parseFloat(text) * 100`, so
 * a club in Tokyo entering a ¥500 buy-in stored 50,000 minor units and ran a
 * pot for ¥50,000. Reading a prize at a hundredth of its value is alarming and
 * obvious; charging a hundred times the stake is alarming and looks deliberate.
 *
 * Asks `minorUnitDigits` the same question `money` asks, so the two cannot
 * disagree: whatever this parses, that formats back to the same string.
 */
export function minorUnitsFrom(text: string, currency: string = DEFAULT_CURRENCY): number {
  // Digits, one decimal point and a leading minus — a refund is negative, and
  // thousands separators and a currency symbol are things people paste.
  const cleaned = String(text ?? "").replace(/[^0-9.-]/g, "");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10 ** minorUnitDigits(currency));
}

/**
 * Just the symbol, for a label or an input prefix.
 *
 * Derived from the code rather than stored beside it, so the two cannot
 * disagree — a club whose symbol said "£" and whose code said USD would round
 * its money to the wrong number of places while looking correct.
 */
export function currencySymbol(currency: string = DEFAULT_CURRENCY): string {
  const code = (currency || DEFAULT_CURRENCY).toUpperCase();
  try {
    const parts = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
    }).formatToParts(0);
    return parts.find((p) => p.type === "currency")?.value ?? code;
  } catch {
    return "$";
  }
}
