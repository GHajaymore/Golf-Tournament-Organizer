"use client";
import { createContext, useContext, useMemo } from "react";
import {
  money as formatMoney,
  minorUnitsFrom as parseMoney,
  currencySymbol,
  DEFAULT_CURRENCY,
} from "@/lib/domain/money-format";
import { DEFAULT_LOCALE, type Formatting } from "@/lib/domain/locale";

/**
 * The club's currency, provided once for every screen that shows an amount.
 *
 * Set in the layout beside the theme, and for the same reason: it is one
 * decision belonging to the club, read by a dozen screens. The alternative
 * was a `currency` prop threaded through eight client components and every
 * page that renders one, and the prop somebody forgets is a screen quietly
 * back in dollars.
 *
 * Defaults to USD with no provider, which is what every screen did before
 * this existed — so a surface nobody has wired yet is unchanged rather than
 * broken.
 */
/**
 * IT CARRIES THE LOCALE TOO, because it is the same decision.
 *
 * This held a currency code alone, and `money()` then wrote it with
 * `Intl.NumberFormat("en-US")` — so the club's currency was honoured and the
 * club's CONVENTIONS were not. A club set to EUR read "€1,234.00" where its
 * members write "1.234,00 €": the symbol looks right, which is why nobody
 * noticed.
 *
 * Extending this provider rather than adding a second one beside it. They
 * would be two contexts holding two halves of one answer, set in the same two
 * layouts from the same two rows — and the screen that read one and forgot the
 * other would be wrong in exactly the way described above.
 */
const FormattingContext = createContext<Formatting>({
  locale: DEFAULT_LOCALE,
  currency: DEFAULT_CURRENCY,
});

export function CurrencyProvider({
  currency,
  locale,
  children,
}: {
  currency: string | null | undefined;
  /**
   * The club's BCP-47 tag, already resolved against any tournament override.
   *
   * Optional so a caller not yet teaching it gets US English — which is what
   * every screen did before this existed, so an unwired surface is unchanged
   * rather than broken.
   */
  locale?: string | null;
  children: React.ReactNode;
}) {
  const value = useMemo(
    () => ({ locale: locale || DEFAULT_LOCALE, currency: currency || DEFAULT_CURRENCY }),
    [locale, currency],
  );
  return <FormattingContext.Provider value={value}>{children}</FormattingContext.Provider>;
}

/**
 * The club's way of writing a DATE, for the screens that show one.
 *
 * The other half of `useMoney`, from the same context, so a screen showing a
 * date and an amount cannot get one from the club and the other from the
 * reader's browser.
 */
export function useFormatting(): Formatting {
  return useContext(FormattingContext);
}

/**
 * The club's way of writing an amount in minor units.
 *
 * `money` prefixes the symbol; `plain` is the same number without one, for
 * the places that put the symbol in a label or an input prefix instead —
 * both from the same formatter, so a currency with no minor unit rounds the
 * same way in both.
 */
export function useMoney() {
  const { currency, locale } = useContext(FormattingContext);
  return useMemo(
    () => ({
      currency,
      locale,
      symbol: currencySymbol(currency),
      money: (minorUnits: number) => formatMoney(minorUnits, currency, locale),
      /** The digits only — no symbol — for an input or a column that labels itself. */
      plain: (minorUnits: number) =>
        formatMoney(minorUnits, currency, locale).replace(/[^\d.,-]/g, "").trim(),
      /**
       * What somebody typed, as minor units. The inverse of `money`, and the
       * half that was missed: every input multiplied by a hundred, so a ¥500
       * buy-in became ¥50,000.
       */
      parse: (text: string) => parseMoney(text, currency),
    }),
    [currency, locale],
  );
}
