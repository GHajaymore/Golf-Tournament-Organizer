/**
 * Days laid out in months, with nothing on them.
 *
 * Extracted from `availability-calendar.ts` when a SECOND calendar was needed —
 * the club-wide one, which carries a member's commitments across every
 * tournament rather than one league's rounds. Both calendars ask the same
 * question of the calendar itself ("which squares are in which week of which
 * month") and a different question of what sits on a square, so the grid is
 * shared and the payload is not.
 *
 * Copying it would have been three lines cheaper and is the mistake this
 * repository has a section about: two readers of one question agree perfectly
 * until one of them is edited. In particular the UTC handling below is subtle
 * enough that a second copy WOULD drift — see the note on it.
 *
 * Dates are handled as the y-m-d they are. Every date is built through
 * `Date.UTC` and read back with the UTC getters, so no local offset is ever
 * applied to a day that has none: on a server in UTC a US club's Tuesday round
 * is otherwise perfectly capable of landing on the Monday square.
 */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Sunday first, the way a US club prints its calendar. */
export const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The parts of an ISO day, or null when it isn't one. */
export function partsOf(iso: string): { y: number; m: number; d: number } | null {
  const match = ISO.exec((iso ?? "").trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { y: Number(y), m: month, d: day };
}

export const isoOf = (utc: Date): string =>
  `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, "0")}-${String(
    utc.getUTCDate(),
  ).padStart(2, "0")}`;

export interface GridDay {
  /** yyyy-mm-dd, always — including the padding days either side of a month. */
  iso: string;
  /** Day of the month, 1..31. */
  day: number;
  /** False for the days that belong to the neighbouring month. */
  inMonth: boolean;
  isToday: boolean;
  isPast: boolean;
}

export interface GridMonth {
  /** "2026-05", for a stable React key. */
  key: string;
  /** "May 2026". */
  label: string;
  /** Whole weeks, seven days each, so the grid is always rectangular. */
  weeks: GridDay[][];
}

/**
 * Every month from the earliest of `isoDates` to the latest, inclusive.
 *
 * Only months the caller's own dates reach: a league running May to August has
 * four months worth showing, and padding the year out to twelve would bury
 * them. Months in between are kept even when empty, because a gap in a season
 * is information — that is the fortnight off.
 *
 * Unparseable dates are ignored rather than thrown on. The caller decides what
 * to do with a commitment nobody has dated; it is not the grid's business, and
 * a grid that throws would take a whole screen down over one bad string.
 */
export function monthGrids(isoDates: readonly string[], todayIso: string): GridMonth[] {
  const stamps: number[] = [];
  for (const iso of isoDates) {
    const parts = partsOf(iso);
    if (parts) stamps.push(Date.UTC(parts.y, parts.m - 1, parts.d));
  }
  if (stamps.length === 0) return [];

  const first = new Date(Math.min(...stamps));
  const last = new Date(Math.max(...stamps));

  const months: GridMonth[] = [];
  const cursor = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1));
  const end = Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), 1);

  while (cursor.getTime() <= end) {
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth();
    const firstOfMonth = new Date(Date.UTC(year, month, 1));
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

    // Back up to the Sunday on or before the 1st, then run whole weeks until
    // the month is covered. The grid is rectangular by construction rather
    // than by the renderer padding it.
    const start = new Date(firstOfMonth);
    start.setUTCDate(start.getUTCDate() - start.getUTCDay());

    const weeks: GridDay[][] = [];
    const day = new Date(start);

    while (true) {
      const week: GridDay[] = [];
      for (let i = 0; i < 7; i += 1) {
        const iso = isoOf(day);
        week.push({
          iso,
          day: day.getUTCDate(),
          inMonth: day.getUTCMonth() === month && day.getUTCFullYear() === year,
          isToday: iso === todayIso,
          isPast: iso < todayIso,
        });
        day.setUTCDate(day.getUTCDate() + 1);
      }
      weeks.push(week);
      const done = day.getUTCMonth() !== month || day.getUTCFullYear() !== year;
      if (done && weeks.length * 7 >= daysInMonth) break;
      if (weeks.length >= 6) break;
    }

    months.push({
      key: `${year}-${String(month + 1).padStart(2, "0")}`,
      label: `${MONTHS[month]} ${year}`,
      weeks,
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return months;
}
