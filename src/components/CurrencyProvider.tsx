"use client";
import { createContext, useContext, useMemo } from "react";
import {
  money as formatMoney,
  minorUnitsFrom as parseMoney,
  currencySymbol,
  DEFAULT_CURRENCY,
} from "@/lib/domain/money-format";

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
const CurrencyContext = createContext<string>(DEFAULT_CURRENCY);

export function CurrencyProvider({
  currency,
  children,
}: {
  currency: string | null | undefined;
  children: React.ReactNode;
}) {
  return (
    <CurrencyContext.Provider value={currency || DEFAULT_CURRENCY}>{children}</CurrencyContext.Provider>
  );
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
  const currency = useContext(CurrencyContext);
  return useMemo(
    () => ({
      currency,
      symbol: currencySymbol(currency),
      money: (minorUnits: number) => formatMoney(minorUnits, currency),
      /** The digits only — no symbol — for an input or a column that labels itself. */
      plain: (minorUnits: number) =>
        formatMoney(minorUnits, currency).replace(/[^\d.,-]/g, "").trim(),
      /**
       * What somebody typed, as minor units. The inverse of `money`, and the
       * half that was missed: every input multiplied by a hundred, so a ¥500
       * buy-in became ¥50,000.
       */
      parse: (text: string) => parseMoney(text, currency),
    }),
    [currency],
  );
}
