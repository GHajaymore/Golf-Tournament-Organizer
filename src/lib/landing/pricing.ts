import { money, wholeMoney } from "@/lib/domain/money-format";
import { DEFAULT_LOCALE } from "@/lib/domain/locale";
import { PLANS, effectiveAnnualPrice, effectivePrice, type PricingOverrides } from "@/lib/plans";
import type { Edition } from "./edition";

/** One paid plan's price, written for the edition. */
export interface PlanPrices {
  monthly: string;
  yearly: string;
}

export interface LandingPrices {
  /** Nothing, in the visitor's currency: "$0", "£0". */
  zero: string;
  society: PlanPrices;
  club: PlanPrices;
  /**
   * A figure quoted from a US company's own website, which stays in US dollars
   * whoever is reading — "$1,425" in the US edition, "US$1,425" elsewhere so a
   * British reader never takes it for pounds. Never converted: it is their
   * number, not ours.
   */
  usd: (amount: number) => string;
}

/**
 * Every price the front door shows, for one edition.
 *
 * Read through `effectivePrice` / `effectiveAnnualPrice` with the owner's
 * stored overrides, so the landing, the FAQ, the settings panel and the
 * schema.org offer quote one number. Written with `wholeMoney`, so a set price
 * of £39 never reads "£39.00".
 */
export function landingPrices(edition: Edition, overrides: PricingOverrides): LandingPrices {
  const fmt = (n: number) => wholeMoney(n, edition.currency, edition.locale);
  const plan = (key: "society" | "club"): PlanPrices => ({
    monthly: fmt(effectivePrice(PLANS[key], overrides, edition.currency)),
    yearly: fmt(effectiveAnnualPrice(PLANS[key], overrides, edition.currency)),
  });
  // Whole where the company quotes a whole price ("$1,425"), to the cent where
  // it quotes cents ("$99.99") — their number exactly as they print it.
  const dollars = (amount: number) =>
    Number.isInteger(amount) ? wholeMoney(amount, "USD", DEFAULT_LOCALE) : money(Math.round(amount * 100), "USD", DEFAULT_LOCALE);
  return {
    zero: fmt(0),
    society: plan("society"),
    club: plan("club"),
    usd: (amount) => (edition.currency === "USD" ? dollars(amount) : `US${dollars(amount)}`),
  };
}
