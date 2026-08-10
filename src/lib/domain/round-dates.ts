/**
 * Working out when each week of a league is played.
 *
 * All calendar days, never instants. A league night is "Tuesday 19 May", not a
 * moment in time, and the moment you involve a timezone somebody sees Monday
 * for a round the whole club played on Tuesday.
 *
 * That is also why the arithmetic here is done on the date parts rather than
 * by adding milliseconds: adding 7 × 24 × 60 × 60 × 1000 across a daylight
 * saving change lands an hour out, and eventually a day out — so a season
 * generated in March quietly slips to Mondays in November.
 */

/** "2026-05-19" — the only shape this module accepts or returns. */
export type IsoDate = string;

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(v: string): v is IsoDate {
  if (!ISO_DATE.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth(y, m);
}

/** Empty for anything unparseable, so a bad value never becomes a wrong date. */
export function cleanIsoDate(v: string | null | undefined): IsoDate | "" {
  const s = (v ?? "").trim();
  return isIsoDate(s) ? s : "";
}

function daysInMonth(year: number, month: number): number {
  // Month is 1-based here; day 0 of the next month is the last of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Add whole days to a calendar date.
 *
 * Goes through UTC purely as a calendar, never as a clock — midday guards
 * against any residual rounding.
 */
export function addDays(date: IsoDate, days: number): IsoDate {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, 12));
  t.setUTCDate(t.getUTCDate() + days);
  const yy = t.getUTCFullYear();
  const mm = String(t.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(t.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * The dates for a run of rounds: a start, then every `intervalDays` after it.
 *
 * Returns as many dates as rounds asked for. An interval of 0 or less gives
 * every round the same date, which is what a two-round weekend played on one
 * day would want, and is never an error.
 */
export function roundDates(start: IsoDate, count: number, intervalDays: number): IsoDate[] {
  const n = Math.max(0, Math.round(count));
  const step = Math.max(0, Math.round(intervalDays));
  const out: IsoDate[] = [];
  for (let i = 0; i < n; i += 1) out.push(addDays(start, step * i));
  return out;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Which weekday a date falls on, so the UI can say "every Tuesday". */
export function weekdayOf(date: IsoDate): string {
  const [y, m, d] = date.split("-").map(Number);
  return DAY_NAMES[new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()];
}

/** "Tue 19 May" — short, and never shows a year the reader already knows. */
export function shortDate(date: IsoDate): string {
  if (!isIsoDate(date)) return "";
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, 12));
  const wd = DAY_NAMES[t.getUTCDay()].slice(0, 3);
  const month = t.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  return `${wd} ${d} ${month}`;
}

/** Common cadences, in the words a club uses. */
export const INTERVAL_OPTIONS = [
  { days: 7, label: "Every week" },
  { days: 14, label: "Every fortnight" },
  { days: 1, label: "Consecutive days" },
  { days: 0, label: "All on the same day" },
] as const;
