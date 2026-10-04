import { editionFor } from "@/lib/landing/edition";
import { countryCode } from "./country";
import { isCurrencyCode } from "./money-format";

/**
 * A CASUAL ROUND'S CURRENCY, FROM WHERE IT IS BEING SET UP (Ajay, 2026-10-04:
 * "default the currency based on the current location but provide option to
 * toggle it to USD").
 *
 * The same policy the front door has had since 2026-09-27 — local by default,
 * US dollars one tap away — so it starts from the landing's own edition table
 * (`editionFor`), which already knows the US, Canada, the UK, Ireland, the
 * eurozone, Australia, New Zealand and South Africa. A casual round is played
 * wherever its players are, though, so the other countries golf is commonly
 * played in are named here rather than falling to dollars: a fourball in Osaka
 * playing for yen should not be told it is playing for dollars.
 *
 * Anything unrecognised is USD, which is what every round was before.
 */
const ALSO: Record<string, string> = {
  JP: "JPY", IN: "INR", CH: "CHF", SE: "SEK", NO: "NOK", DK: "DKK", MX: "MXN",
  SG: "SGD", HK: "HKD", KR: "KRW", CN: "CNY", TH: "THB", MY: "MYR", AE: "AED",
  PH: "PHP", BR: "BRL", AR: "ARS", CL: "CLP", CO: "COP", PL: "PLN", CZ: "CZK",
  HU: "HUF", TR: "TRY", IS: "ISK", IL: "ILS", SA: "SAR", QA: "QAR", MA: "MAD",
  KE: "KES", NG: "NGN", ID: "IDR", VN: "VND", TW: "TWD",
};

export function localCurrency(country: string | null | undefined): string {
  const code = countryCode(country ?? "");
  const named = code === "UK" ? "GB" : code;
  const extra = ALSO[named];
  if (extra && isCurrencyCode(extra)) return extra;
  return editionFor(named).currency;
}

/**
 * Where the request comes from: Vercel's own reading of the connection
 * (`x-vercel-ip-country`) when there is one, and otherwise the region of the
 * browser's first language ("en-GB" -> GB) — which is what a phone on the
 * course has when the app runs anywhere but Vercel. Neither asks the player
 * for anything, and neither is a location permission prompt on the first tee.
 */
export function requestCountry(vercelCountry: string | null | undefined, acceptLanguage: string | null | undefined): string {
  const direct = (vercelCountry ?? "").trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(direct)) return direct;
  const first = (acceptLanguage ?? "").split(",")[0]?.trim() ?? "";
  const region = /^[a-z]{2,3}[-_]([A-Za-z]{2})\b/.exec(first)?.[1];
  return region ? region.toUpperCase() : "";
}
