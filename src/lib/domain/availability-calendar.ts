/**
 * A league season laid out as a calendar.
 *
 * The availability list answers "what am I down for" one row at a time, which
 * is the right shape for the next round and the wrong shape for the question
 * players actually ask in May: am I around for any of this? A twelve-week
 * league is twelve identical rows, and a member checking them against a
 * holiday, a work trip and their daughter's wedding is doing the calendar
 * arithmetic in their head. Golf is played on days; this puts the season back
 * on days.
 *
 * Pure, and given `today` rather than reading a clock — a month grid that
 * depends on when the test runs is a month grid that fails in December.
 *
 * Dates are handled as the y-m-d they are. Every date here is built through
 * `Date.UTC` and read back with the UTC getters, so no local offset is ever
 * applied to a day that has none: on a server in UTC a US club's Tuesday
 * round is otherwise perfectly capable of landing on the Monday square.
 */

export interface CalendarRound {
  stageId: string;
  /** "Round 7" — the league's own numbering. */
  label: string;
  status: "in" | "out";
  /** Whether that answer was stated, or is the league's default. */
  explicit: boolean;
  /** True once the sign-up window has closed for players. */
  locked: boolean;
  /** The day this round is played, ISO. */
  playedOn: string;
}

export interface CalendarDay {
  /** yyyy-mm-dd, always — including the padding days either side of a month. */
  iso: string;
  /** Day of the month, 1..31. */
  day: number;
  /** False for the days that belong to the neighbouring month. */
  inMonth: boolean;
  isToday: boolean;
  isPast: boolean;
  /** The round played this day, if any. At most one: a league plays a round a
   *  day, and two rounds on one date is a tournament, not a league. */
  round: CalendarRound | null;
}

export interface CalendarMonth {
  /** "2026-05", for a stable React key. */
  key: string;
  /** "May 2026". */
  label: string;
  /** Whole weeks, seven days each, so the grid is always rectangular. */
  weeks: CalendarDay[][];
  /** Rounds this month holds — the count worth putting next to the name. */
  roundCount: number;
  /** How many of them this player is in for. */
  inCount: number;
}

export interface AvailabilityCalendar {
  months: CalendarMonth[];
  /**
   * Rounds with no date.
   *
   * They cannot be placed on a calendar and they must not be silently
   * dropped — a round nobody has dated is exactly the one a player would
   * otherwise never see. The caller lists them beside the grid.
   */
  undated: CalendarRound[];
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Sunday first, the way a US club prints its calendar. */
export const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The parts of an ISO day, or null when it isn't one. */
function partsOf(iso: string): { y: number; m: number; d: number } | null {
  const match = ISO.exec((iso ?? "").trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { y: Number(y), m: month, d: day };
}

const isoOf = (utc: Date): string =>
  `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, "0")}-${String(
    utc.getUTCDate(),
  ).padStart(2, "0")}`;

/**
 * The season as months, from the first dated round to the last.
 *
 * Only months that actually hold a round: a league running May to August has
 * four months worth showing, and padding the year out to twelve would bury
 * them. Months in between are kept even when empty, because a gap in a season
 * is information — that is the fortnight off.
 */
export function buildAvailabilityCalendar(
  rounds: CalendarRound[],
  todayIso: string,
): AvailabilityCalendar {
  const dated: Array<{ round: CalendarRound; y: number; m: number; d: number }> = [];
  const undated: CalendarRound[] = [];

  for (const round of rounds) {
    const parts = partsOf(round.playedOn);
    if (parts) dated.push({ round, ...parts });
    else undated.push(round);
  }

  if (dated.length === 0) return { months: [], undated };

  const byIso = new Map<string, CalendarRound>();
  for (const { round } of dated) {
    // First one wins, so a duplicate date can't blank the round already there.
    if (!byIso.has(round.playedOn.trim())) byIso.set(round.playedOn.trim(), round);
  }

  const stamps = dated.map((r) => Date.UTC(r.y, r.m - 1, r.d));
  const first = new Date(Math.min(...stamps));
  const last = new Date(Math.max(...stamps));

  const months: CalendarMonth[] = [];
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

    const weeks: CalendarDay[][] = [];
    const day = new Date(start);
    let roundCount = 0;
    let inCount = 0;

    while (true) {
      const week: CalendarDay[] = [];
      for (let i = 0; i < 7; i += 1) {
        const iso = isoOf(day);
        const inMonth = day.getUTCMonth() === month && day.getUTCFullYear() === year;
        const round = byIso.get(iso) ?? null;
        if (round && inMonth) {
          roundCount += 1;
          if (round.status === "in") inCount += 1;
        }
        week.push({
          iso,
          day: day.getUTCDate(),
          inMonth,
          isToday: iso === todayIso,
          isPast: iso < todayIso,
          // A round belongs to the month it is played in, so the padding days
          // show it greyed rather than offering a second copy to tap.
          round,
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
      roundCount,
      inCount,
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return { months, undated };
}

export type DayTone = "in" | "in-default" | "out" | "out-default" | "locked" | "none";

/**
 * How one day should read at a glance.
 *
 * Four states, not two, because "in" and "in because nobody said otherwise"
 * are different promises and the whole feature turns on the difference. A
 * locked round is drawn as neither — it is a fact now, not a question.
 */
export function toneOf(day: CalendarDay): DayTone {
  if (!day.round) return "none";
  if (day.round.locked) return "locked";
  if (day.round.status === "in") return day.round.explicit ? "in" : "in-default";
  return day.round.explicit ? "out" : "out-default";
}

/** What that tone means, for the legend and for a screen reader. */
export const TONE_LABEL: Record<DayTone, string> = {
  in: "Playing",
  "in-default": "In by default",
  out: "Not playing",
  "out-default": "Out by default",
  locked: "Closed",
  none: "No round",
};
