"use client";
import { useMoney } from "@/components/CurrencyProvider";
import { money as formatMoney, minorUnitDigits } from "@/lib/domain/money-format";

/**
 * A prize, in the CLUB'S currency.
 *
 * `currency: "USD"` was once written here literally, so a club in Britain read
 * its whole prize list in dollars — on the screen it uses to tell members what
 * they won.
 *
 * NOTE the unit. `Prize.amount` is a Float in WHOLE units, unlike every other
 * money column in this app, which stores minor units. That is why this scales
 * by the currency's own minor-unit count before formatting rather than calling
 * `money()` directly: handing whole pounds to a formatter expecting pence
 * would divide the purse by a hundred.
 *
 * Its own file so the committee's prize screen and the player's prize list
 * share it without the player app carrying the committee screen.
 */
export function usePrizeMoney() {
  const { currency } = useMoney();
  return (n: number) =>
    n > 0 ? formatMoney(Math.round(n * 10 ** minorUnitDigits(currency)), currency) : "—";
}
