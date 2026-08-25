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
