import { minorUnitDigits } from "./money-format";

/**
 * THE OWNER'S BOOKS, AS ARITHMETIC (B44, 2026-11-13). A record of what TourneyHQ earned and spent.
 * It is a record and nothing moves: no payment rails here (CLAUDE.md, Hard rule 7).
 *
 * THE RULES THIS FILE HOLDS, each of them tested:
 *
 *   1. MINOR UNITS ONLY. Every amount is a whole number of the currency's smallest unit (cents, pence) in
 *      the currency it was paid in. No float is made, read or rounded through anywhere in this file
 *      (`finance-has-no-floats.test.ts` refuses the spellings). The arithmetic that must divide does it
 *      in BigInt.
 *   2. A CURRENCY IS NEVER MIXED. A total is a total PER CURRENCY (`totalsByCurrency`); two currencies
 *      become one number only by going through a dated rate to US dollars, row by row.
 *   3. ROUNDED ONCE, THEN SUMMED. Each row is converted to US dollar minor units on its own, half away
 *      from zero (so a refund is exactly the negative of its charge), and the report's total is the sum
 *      of the rows as shown — so the total equals what is on the screen, in any order of rows.
 *   4. THE RATE TRAVELS WITH THE FIGURE. A converted line says which rate, of which day, from which
 *      source it used. A currency with no rate on or before that day is NOT converted and NOT skipped:
 *      the line says "no rate" and its month is incomplete.
 *   5. A MONTH THAT IS MISSING A REQUIRED COST (hosting, database) IS INCOMPLETE, and its margin is never
 *      a clean number.
 *   6. TIME IS PASSED IN. Nothing here reads a clock; a month is "YYYY-MM", a day is "YYYY-MM-DD".
 *
 * Pure: no database, no server, no clock. `services/owner-finance.ts` reads the rows and hands them in.
 */

/** "YYYY-MM": a calendar month in UTC (the spec's fiscal month until an accountant says otherwise). */
export type Month = string;

export const COST_CADENCES = ["once", "monthly", "yearly"] as const;
export type CostCadence = (typeof COST_CADENCES)[number];

/** The costs the owner can type. "other" asks for a note. */
export const COST_CATEGORIES = [
  { key: "hosting", label: "Hosting" },
  { key: "database", label: "Database" },
  { key: "messaging", label: "Messaging (email, SMS)" },
  { key: "ai", label: "AI" },
  { key: "domains", label: "Domains" },
  { key: "app-stores", label: "App stores" },
  { key: "tools", label: "Tools" },
  { key: "other", label: "Other" },
] as const;

export type CostCategory = (typeof COST_CATEGORIES)[number]["key"];

/** A month with none of these entered is incomplete: it cannot show a clean margin. */
export const REQUIRED_COST_CATEGORIES: readonly CostCategory[] = ["hosting", "database"];

export function isCostCategory(v: string): v is CostCategory {
  return COST_CATEGORIES.some((c) => c.key === v);
}

export function costCategoryLabel(key: string): string {
  return COST_CATEGORIES.find((c) => c.key === key)?.label ?? key;
}

// ---------------------------------------------------------------------------------------------
// Whole-number arithmetic
// ---------------------------------------------------------------------------------------------

/** A whole number the machine holds exactly: refuses a float, NaN and anything past 2^53. */
export function isMinor(n: unknown): n is number {
  return typeof n === "number" && Number.isSafeInteger(n);
}

function minorOrThrow(n: number, what: string): number {
  if (!isMinor(n)) throw new Error(`${what} must be a whole number of minor units, got ${String(n)}`);
  return n;
}

/** n / d, rounded to the nearest whole number, halves AWAY from zero. d > 0. BigInt: exact. */
function divideHalfAway(n: bigint, d: bigint): bigint {
  const negative = n < BigInt(0);
  const magnitude = negative ? -n : n;
  const q = (BigInt(2) * magnitude + d) / (BigInt(2) * d);
  return negative ? -q : q;
}

function toSafe(n: bigint, what: string): number {
  const asNumber = Number(n);
  if (!Number.isSafeInteger(asNumber)) throw new Error(`${what} is too large to hold exactly`);
  return asNumber;
}

/**
 * `total` shared across `parts` slices so that THE SLICES ADD BACK TO THE TOTAL EXACTLY. Slice i is
 * the rounded running share to i+1 minus the rounded running share to i, so every boundary is rounded
 * once, no slice is more than one minor unit from another, and the sum telescopes to the total.
 */
export function spreadEvenly(total: number, parts: number): number[] {
  minorOrThrow(total, "an amount");
  if (!Number.isSafeInteger(parts) || parts < 1) throw new Error("a spread needs at least one part");
  const t = BigInt(total);
  const p = BigInt(parts);
  const out: number[] = [];
  let before = BigInt(0);
  for (let i = 1; i <= parts; i++) {
    const upTo = divideHalfAway(t * BigInt(i), p);
    out.push(toSafe(upTo - before, "a slice"));
    before = upTo;
  }
  return out;
}

/** The sum of whole numbers, which must stay whole and exact. */
export function sumMinor(amounts: readonly number[]): number {
  let total = BigInt(0);
  for (const a of amounts) total += BigInt(minorOrThrow(a, "an amount"));
  return toSafe(total, "a total");
}

/** A total PER CURRENCY: two currencies are never added together. Sorted by code, so output is stable. */
export function totalsByCurrency(rows: readonly { currency: string; amountMinor: number }[]): Record<string, number> {
  const sums = new Map<string, bigint>();
  for (const r of rows) {
    const code = r.currency.toUpperCase();
    sums.set(code, (sums.get(code) ?? BigInt(0)) + BigInt(minorOrThrow(r.amountMinor, "an amount")));
  }
  const out: Record<string, number> = {};
  for (const code of [...sums.keys()].sort()) out[code] = toSafe(sums.get(code)!, "a total");
  return out;
}

// ---------------------------------------------------------------------------------------------
// Months and days
// ---------------------------------------------------------------------------------------------

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DAY = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function isMonth(s: string): boolean {
  return MONTH.test(s);
}

export function isDay(s: string): boolean {
  const m = DAY.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const last = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  return d <= last;
}

/** Months since year 0, so two months subtract. */
function ordinal(m: Month): number {
  const parts = MONTH.exec(m);
  if (!parts) throw new Error(`not a month: ${m}`);
  return Number(parts[1]) * 12 + (Number(parts[2]) - 1);
}

export function addMonths(m: Month, n: number): Month {
  const o = ordinal(m) + n;
  const year = Math.floor(o / 12);
  const mo = o - year * 12 + 1;
  return `${String(year).padStart(4, "0")}-${String(mo).padStart(2, "0")}`;
}

/** Whole months from a to b (negative when b is earlier). */
export function monthsBetween(a: Month, b: Month): number {
  return ordinal(b) - ordinal(a);
}

/** Every month from `from` to `to`, inclusive; empty when `to` is before `from`. */
export function monthRange(from: Month, to: Month): Month[] {
  const n = monthsBetween(from, to);
  const out: Month[] = [];
  for (let i = 0; i <= n; i++) out.push(addMonths(from, i));
  return out;
}

/** The rate day a month's figures are converted on: its first day. */
export function firstDayOf(m: Month): string {
  return `${m}-01`;
}

// ---------------------------------------------------------------------------------------------
// Costs, spread by month
// ---------------------------------------------------------------------------------------------

export interface CostRow {
  id: string;
  month: Month;
  category: string;
  vendor: string;
  currency: string;
  /** For "yearly", the whole year's amount. */
  amountMinor: number;
  cadence: CostCadence;
  /** The last month a recurring cost covers, or null while it goes on. */
  endsMonth: Month | null;
  source: string;
  note: string;
  enteredByEmail: string;
}

export interface CostSlice {
  costId: string;
  month: Month;
  category: string;
  vendor: string;
  currency: string;
  amountMinor: number;
  source: string;
  note: string;
  enteredByEmail: string;
}

/**
 * What one cost puts on one month, or null when it puts nothing there. "once" is that month only;
 * "monthly" is the amount every month from its first to its last (open-ended: every month asked for);
 * "yearly" is a year's amount spread over twelve months, and again for the next twelve, so a year's
 * slices add back to the year's amount exactly.
 */
export function sliceFor(cost: CostRow, month: Month): number | null {
  const offset = monthsBetween(cost.month, month);
  if (offset < 0) return null;
  if (cost.endsMonth && monthsBetween(cost.endsMonth, month) > 0) return null;
  if (cost.cadence === "once") return offset === 0 ? cost.amountMinor : null;
  if (cost.cadence === "monthly") return cost.amountMinor;
  return spreadEvenly(cost.amountMinor, 12)[offset % 12];
}

/** Every slice of every cost that falls in [from, to]. */
export function costSlices(costs: readonly CostRow[], from: Month, to: Month): CostSlice[] {
  const out: CostSlice[] = [];
  for (const month of monthRange(from, to)) {
    for (const c of costs) {
      const amount = sliceFor(c, month);
      if (amount === null) continue;
      out.push({
        costId: c.id,
        month,
        category: c.category,
        vendor: c.vendor,
        currency: c.currency.toUpperCase(),
        amountMinor: amount,
        source: c.source,
        note: c.note,
        enteredByEmail: c.enteredByEmail,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Rates and conversion to US dollars
// ---------------------------------------------------------------------------------------------

export interface Rate {
  currency: string;
  /** "YYYY-MM-DD" */
  rateDate: string;
  /** Millionths of a US dollar that one WHOLE unit of the currency buys. */
  usdMicrosPerUnit: number;
  /** "ecb" | "override" | "usd" (US dollars need no rate) */
  source: string;
}

const MICROS = BigInt(1_000_000);

/**
 * The rate in force on a day: the latest rate dated on or before it, for that currency. On one date an
 * owner's override beats a published rate. US dollars are 1 and need no row. Null when none is dated
 * on or before the day: the caller says "no rate", it does not guess.
 */
export function rateOn(rates: readonly Rate[], currency: string, day: string): Rate | null {
  const code = currency.toUpperCase();
  if (code === "USD") return { currency: "USD", rateDate: day, usdMicrosPerUnit: Number(MICROS), source: "usd" };
  let best: Rate | null = null;
  for (const r of rates) {
    if (r.currency.toUpperCase() !== code || r.rateDate > day) continue;
    if (!best || r.rateDate > best.rateDate || (r.rateDate === best.rateDate && r.source === "override" && best.source !== "override")) best = r;
  }
  return best;
}

/** `amountMinor` of `currency` as US dollar minor units at `usdMicrosPerUnit`, rounded ONCE, half away from zero. */
export function toUsdMinor(amountMinor: number, currency: string, usdMicrosPerUnit: number): number {
  minorOrThrow(amountMinor, "an amount");
  if (!Number.isSafeInteger(usdMicrosPerUnit) || usdMicrosPerUnit <= 0) throw new Error("a rate must be a positive whole number of millionths");
  const digits = minorUnitDigits(currency);
  // usd cents = amountMinor / 10^digits (whole units) * rate / 10^6 (dollars) * 100 (cents)
  const numerator = BigInt(amountMinor) * BigInt(usdMicrosPerUnit) * BigInt(100);
  const denominator = BigInt(10) ** BigInt(digits) * MICROS;
  return toSafe(divideHalfAway(numerator, denominator), "a converted amount");
}

export interface UsdLine {
  usdMinor: number;
  /** The rate used, kept with the figure so an old month does not change when rates move. */
  rate: Rate;
}

/** One row to US dollars on a day, or null when no rate is dated on or before it. */
export function convertRow(row: { currency: string; amountMinor: number }, rates: readonly Rate[], day: string): UsdLine | null {
  const rate = rateOn(rates, row.currency, day);
  if (!rate) return null;
  return { usdMinor: toUsdMinor(row.amountMinor, row.currency, rate.usdMicrosPerUnit), rate };
}

// ---------------------------------------------------------------------------------------------
// The monthly cost report
// ---------------------------------------------------------------------------------------------

export interface CostLine extends CostSlice {
  /** Null when no rate is dated on or before the month's first day. */
  usd: UsdLine | null;
}

export interface MonthReport {
  month: Month;
  lines: CostLine[];
  /** The sum of the lines that converted, each rounded before it was added. */
  usdMinor: number;
  /** What was paid, in each currency it was paid in (never mixed). */
  byCurrency: Record<string, number>;
  /** US dollars per category. */
  byCategory: Record<string, number>;
  /** Lines with no rate: named, never skipped. */
  noRate: { currency: string; day: string }[];
  /** Required categories with no entry that month. */
  missingCategories: CostCategory[];
  /** True when something required is missing or a rate is: the margin cannot be a clean number. */
  incomplete: boolean;
}

export function monthReport(costs: readonly CostRow[], rates: readonly Rate[], month: Month): MonthReport {
  const lines: CostLine[] = costSlices(costs, month, month).map((s) => ({ ...s, usd: convertRow(s, rates, firstDayOf(month)) }));
  const converted = lines.filter((l) => l.usd !== null);
  const byCategory: Record<string, number> = {};
  for (const l of converted) byCategory[l.category] = (byCategory[l.category] ?? 0) + l.usd!.usdMinor;
  const noRate = lines
    .filter((l) => l.usd === null)
    .map((l) => ({ currency: l.currency, day: firstDayOf(month) }))
    .filter((v, i, all) => all.findIndex((o) => o.currency === v.currency) === i);
  const present = new Set(lines.map((l) => l.category));
  const missingCategories = REQUIRED_COST_CATEGORIES.filter((c) => !present.has(c));
  return {
    month,
    lines,
    usdMinor: sumMinor(converted.map((l) => l.usd!.usdMinor)),
    byCurrency: totalsByCurrency(lines),
    byCategory,
    noRate,
    missingCategories: [...missingCategories],
    incomplete: noRate.length > 0 || missingCategories.length > 0,
  };
}

// ---------------------------------------------------------------------------------------------
// Margin
// ---------------------------------------------------------------------------------------------

export type MarginState = "none" | "partial" | "clean";

export interface Margin {
  state: MarginState;
  /** revenue minus cost, in US dollar minor units; null when there is no revenue figure. */
  marginMinor: number | null;
  /** The margin as a share of revenue, in basis points (1/100 of a percent), rounded once; null when it has no meaning. */
  basisPoints: number | null;
}

/**
 * Margin = recognised revenue minus cost. With NO revenue record (`revenueUsdMinor` null) there is no
 * margin ("none", never a negative number worked from nothing); with an incomplete month it is "partial";
 * otherwise "clean". Cost is the cost TO DATE the caller holds, never an estimate.
 */
export function grossMargin(revenueUsdMinor: number | null, costUsdMinor: number, complete: boolean): Margin {
  minorOrThrow(costUsdMinor, "a cost");
  if (revenueUsdMinor === null) return { state: "none", marginMinor: null, basisPoints: null };
  minorOrThrow(revenueUsdMinor, "revenue");
  const marginMinor = toSafe(BigInt(revenueUsdMinor) - BigInt(costUsdMinor), "a margin");
  const basisPoints = revenueUsdMinor === 0 ? null : toSafe(divideHalfAway(BigInt(marginMinor) * BigInt(10000), BigInt(revenueUsdMinor)), "a margin share");
  return { state: complete ? "clean" : "partial", marginMinor, basisPoints };
}

// ---------------------------------------------------------------------------------------------
// Typed figures and how they are written
// ---------------------------------------------------------------------------------------------

/** The most one typed cost may be, in minor units: far beyond any real bill, well inside what is held exactly. */
export const MAX_COST_MINOR = 100_000_000_00;

/**
 * A typed rate such as "1.27" or "0.0067" as millionths. Dot decimal, up to six places, nothing else:
 * a rate is not a figure to guess at. Null when it is not one, or is zero.
 */
export function microsFromText(text: string): number | null {
  const m = /^(\d{1,6})(?:\.(\d{1,6}))?$/.exec(String(text ?? "").trim());
  if (!m) return null;
  const micros = Number(m[1]) * 1_000_000 + Number((m[2] ?? "").padEnd(6, "0"));
  return micros > 0 && Number.isSafeInteger(micros) ? micros : null;
}

/** Millionths written back as a decimal with six places: 1270000 is "1.270000". */
export function microsText(micros: number): string {
  minorOrThrow(micros, "a rate");
  const whole = Math.floor(micros / 1_000_000);
  return `${whole}.${String(micros - whole * 1_000_000).padStart(6, "0")}`;
}

/** Minor units as plain decimal text in the currency's own digits, no grouping: -1250 USD is "-12.50". */
export function decimalText(amountMinor: number, currency: string): string {
  minorOrThrow(amountMinor, "an amount");
  const digits = minorUnitDigits(currency);
  const negative = amountMinor < 0;
  const magnitude = String(negative ? -amountMinor : amountMinor).padStart(digits + 1, "0");
  const whole = magnitude.slice(0, magnitude.length - digits);
  const frac = digits > 0 ? `.${magnitude.slice(magnitude.length - digits)}` : "";
  return `${negative ? "-" : ""}${whole}${frac}`;
}

function grouped(wholeDigits: string): string {
  return wholeDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** US dollars for the screen: "$1,234.56", "-$12.00". */
export function usdText(usdMinor: number): string {
  const text = decimalText(usdMinor, "USD");
  const negative = text.startsWith("-");
  const [whole, frac] = (negative ? text.slice(1) : text).split(".");
  return `${negative ? "-" : ""}$${grouped(whole)}.${frac}`;
}

/** An amount in its own currency for the small type beside a dollar figure: "GBP 1,234.56". */
export function originalText(amountMinor: number, currency: string): string {
  const text = decimalText(amountMinor, currency);
  const negative = text.startsWith("-");
  const [whole, frac] = (negative ? text.slice(1) : text).split(".");
  return `${negative ? "-" : ""}${currency.toUpperCase()} ${grouped(whole)}${frac ? `.${frac}` : ""}`;
}

// ---------------------------------------------------------------------------------------------
// The CSV
// ---------------------------------------------------------------------------------------------

/**
 * One cell of free text, safe to open in a spreadsheet. A cell that begins with = + - @ (or a tab or
 * return) is read by a spreadsheet as a formula, and a vendor or a note is typed by a person: it is
 * prefixed with an apostrophe so it is read as text. Quoted when it holds a comma, a quote or a line break.
 */
export function csvText(value: string): string {
  let v = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\n\r]/.test(v) ? `"${v.split('"').join('""')}"` : v;
}

export const COST_CSV_HEADER = [
  "month", "line", "category", "vendor", "currency", "original_amount", "rate_usd_per_unit", "rate_date", "rate_source", "usd_amount", "source", "entered_by",
] as const;

/**
 * The rows behind the cost table, one per month and cost: no club, no player, no id that names one.
 * Numbers are written by `decimalText` (never typed text, so never a formula); the free text goes through
 * `csvText`. A line with no rate leaves its dollar columns empty and says so in `rate_source`.
 */
export function costCsv(months: readonly MonthReport[]): string {
  const rows: string[] = [COST_CSV_HEADER.join(",")];
  for (const report of months) {
    for (const l of report.lines) {
      rows.push([
        report.month,
        "cost",
        csvText(costCategoryLabel(l.category)),
        csvText(l.vendor),
        l.currency,
        decimalText(l.amountMinor, l.currency),
        l.usd ? microsText(l.usd.rate.usdMicrosPerUnit) : "",
        l.usd ? l.usd.rate.rateDate : "",
        l.usd ? l.usd.rate.source : "no rate",
        l.usd ? decimalText(l.usd.usdMinor, "USD") : "",
        csvText(l.source),
        csvText(l.enteredByEmail),
      ].join(","));
    }
  }
  return `${rows.join("\r\n")}\r\n`;
}

/** The UTC calendar month an instant falls in. The caller supplies the instant: this file never reads a clock. */
export function monthOfInstant(at: Date): Month {
  return at.toISOString().slice(0, 7);
}

/** The UTC day an instant falls in, "YYYY-MM-DD". */
export function dayOfInstant(at: Date): string {
  return at.toISOString().slice(0, 10);
}
