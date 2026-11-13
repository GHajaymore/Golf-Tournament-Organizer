import { isCurrencyCode, minorUnitsFrom, moneyBoxRefusal } from "./money-format";
import {
  COST_CADENCES, MAX_COST_MINOR, isCostCategory, isDay, isMonth, microsFromText, monthsBetween,
  type CostCadence, type CostCategory,
} from "./finance";

/**
 * WHAT THE OWNER TYPES, READ ONCE (B44). The Finance tab's two forms and the server actions behind them
 * read a box through these and nothing else, so the screen's refusal and the server's are one rule, and a
 * `"use server"` export (a public endpoint) validates its own arguments instead of trusting the form.
 *
 * An amount goes through `minorUnitsFrom` in the CHOSEN currency (so "12,50" in a comma-decimal hand and
 * a zero-decimal yen are both read right) and through `moneyBoxRefusal` (so "abc" is refused, never saved
 * as nothing). Pure.
 */

export type Read<T> = { ok: true; value: T } | { ok: false; error: string };

export interface CostBoxes {
  month: string;
  category: string;
  vendor: string;
  currency: string;
  /** The amount as typed. */
  amount: string;
  cadence: string;
  /** The last month of a recurring cost, or "" while it goes on. */
  endsMonth: string;
  note: string;
}

export interface CostToSave {
  month: string;
  category: CostCategory;
  vendor: string;
  currency: string;
  amountMinor: number;
  cadence: CostCadence;
  endsMonth: string | null;
  note: string;
}

const text = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

export function readCostBoxes(raw: CostBoxes): Read<CostToSave> {
  const month = text(raw?.month, 7);
  if (!isMonth(month)) return { ok: false, error: "Pick the month the service was used." };
  const category = text(raw?.category, 20);
  if (!isCostCategory(category)) return { ok: false, error: "Pick what the cost is for." };
  const note = text(raw?.note, 300);
  if (category === "other" && !note) return { ok: false, error: "Say what \"Other\" is in the note." };
  const currency = text(raw?.currency, 3).toUpperCase();
  if (!isCurrencyCode(currency)) return { ok: false, error: "Pick the currency it was paid in." };
  const typed = String(raw?.amount ?? "");
  const amountMinor = minorUnitsFrom(typed, currency);
  const refusal = moneyBoxRefusal(typed, amountMinor, MAX_COST_MINOR);
  if (refusal) return { ok: false, error: refusal };
  const cadence = text(raw?.cadence, 10);
  if (!(COST_CADENCES as readonly string[]).includes(cadence)) return { ok: false, error: "Say how often it repeats: once, monthly or yearly." };
  const ends = text(raw?.endsMonth, 7);
  if (ends) {
    if (cadence === "once") return { ok: false, error: "A cost that happens once has no last month." };
    if (!isMonth(ends)) return { ok: false, error: "The last month must be a month." };
    if (monthsBetween(month, ends) < 0) return { ok: false, error: "The last month is before the first." };
  }
  return {
    ok: true,
    value: { month, category, vendor: text(raw?.vendor, 80), currency, amountMinor, cadence: cadence as CostCadence, endsMonth: ends || null, note },
  };
}

export interface RateBoxes {
  currency: string;
  day: string;
  /** US dollars per one whole unit, as typed: "1.27". */
  rate: string;
  reason: string;
}

export interface RateToSave {
  currency: string;
  rateDate: string;
  usdMicrosPerUnit: number;
  reason: string;
}

export function readRateBoxes(raw: RateBoxes): Read<RateToSave> {
  const currency = text(raw?.currency, 3).toUpperCase();
  if (!isCurrencyCode(currency)) return { ok: false, error: "Pick a currency." };
  if (currency === "USD") return { ok: false, error: "US dollars need no rate." };
  const rateDate = text(raw?.day, 10);
  if (!isDay(rateDate)) return { ok: false, error: "Give the day the rate is for, as year-month-day." };
  const micros = microsFromText(String(raw?.rate ?? ""));
  if (micros === null) return { ok: false, error: "Type the rate as dollars per one unit, like 1.27 (up to six decimals, above zero)." };
  const reason = text(raw?.reason, 200);
  if (!reason) return { ok: false, error: "Say where the rate comes from — a typed rate needs a reason." };
  return { ok: true, value: { currency, rateDate, usdMicrosPerUnit: micros, reason } };
}
