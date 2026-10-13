import { DATE_WORDS } from "./date-words.data";

/**
 * A DATE, WRITTEN BY THE APP AND NOT BY WHATEVER IS DRAWING IT (2026-10-13).
 *
 * A screen is drawn twice: by the server, then by the browser, and React holds
 * the two to be the same bytes. Both used to ask their own platform to word a
 * date — and each platform carries its own edition of the world's conventions.
 * Where two editions part, React throws the server's page away and draws it
 * again (#418). That was met one difference at a time: a thin space
 * (2026-09-25), a Korean tilde and a British dash (2026-10-11), a Korean "PM"
 * (2026-10-12) — each patched where it showed. The first run of the suite on
 * Firefox and on Safari's engine found three more in one evening:
 *
 *     a British weekday    server "Tue 13 Oct"            Safari "Tue, 13 Oct"
 *     an hour before ten   server "1:05"                  Firefox "01:05"
 *     a Japanese range     server "2026/05/14" to "/16"   Firefox, in words
 *
 * The first of those redrew the Rounds screen on every load, for every British
 * club, on every iPhone.
 *
 * So the conventions are read ONCE, by `scripts/build-date-words.mjs`, into
 * `date-words.data.ts`: the names of the months and days, and a template for
 * each shape of date the app writes. This file fills a template in. It asks
 * the platform for nothing but arithmetic — which calendar day and what time
 * an instant is in a zone, in figures — so the server and every browser write
 * the same bytes for the plainest of reasons: they run the same lines over the
 * same table.
 *
 * A TAG THE TABLE DOES NOT HOLD is still written by the platform (the callers
 * in `locale.ts` fall back to it), exactly as before, and can still differ
 * between engines. The picker offers only tags the table holds, and
 * `date-words.test.ts` holds it to that.
 */

export type DateWords = {
  /** Month names as they stand inside a date: "May", "Sept", "Okt." — or the bare figure where a language writes one. */
  months: string[];
  monthsLong: string[];
  /** Sunday first, as `Date#getDay` counts. */
  days: string[];
  daysLong: string[];
  /** The words for the halves of the day; empty where the clock runs to 24. */
  am: string;
  pm: string;
  hour12: boolean;
  /** "14 May 2026" */
  day: string;
  /** "14 May" */
  monthDay: string;
  /** "Thu 14 May" */
  weekdayDay: string;
  /** "14 May, 13:05" — a day and a time, for a line in a log. */
  stamp: string;
  /** "13:05" */
  time: string;
  /** "Thursday 14 May at 13:05" — the clock on the club's wall. */
  wall: string;
  /** "14–16 May 2026" */
  rangeInMonth: string;
  /** "30 May – 2 Jun 2026" */
  rangeInYear: string;
  /** "30 Dec 2026–2 Jan 2027" */
  rangeAcross: string;
};

/** The shapes that are one moment; a range takes two. */
export type DateShape = "day" | "monthDay" | "weekdayDay" | "stamp" | "time" | "wall";

/** A moment as figures: what a template is filled in from. `month` is 1 to 12, `weekday` 0 for Sunday. */
export type DateFields = { year: number; month: number; day: number; weekday: number; hour: number; minute: number };

const BY_LOWER_TAG = new Map(Object.entries(DATE_WORDS).map(([tag, words]) => [tag.toLowerCase(), words]));

/** The table's line for this club, or null for a tag it does not hold. Asked by exact tag: "en" is not a place. */
export function dateWordsFor(locale: string | null | undefined): DateWords | null {
  return BY_LOWER_TAG.get((locale ?? "").trim().toLowerCase()) ?? null;
}

/** Every tag the table holds. */
export const DATE_WORD_TAGS: readonly string[] = Object.keys(DATE_WORDS);

const two = (n: number) => String(n).padStart(2, "0");

/** A calendar day as figures, at noon: a day is not an instant, and nothing here may slide it. Null if it is not one. */
export function fieldsOfDay(iso: string): DateFields | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso ?? "").trim());
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const at = new Date(Date.UTC(year, month - 1, day, 12));
  // The 31st of February is not a day: `Date` would quietly make it the 3rd of March.
  if (Number.isNaN(at.getTime()) || at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day) return null;
  return { year, month, day, weekday: at.getUTCDay(), hour: 12, minute: 0 };
}

/**
 * An instant as figures, in a zone.
 *
 * `"UTC"` and no zone at all (the device's own) are read straight off the
 * `Date`. A named zone is asked of the platform — in figures, in a fixed
 * locale, on a 24-hour clock, which is arithmetic and is the one thing every
 * engine agrees about; `club-clock.ts` reads the club's day the same way.
 */
export function fieldsAt(at: Date, timeZone?: string): DateFields | null {
  if (Number.isNaN(at.getTime())) return null;
  if (timeZone === "UTC") {
    return { year: at.getUTCFullYear(), month: at.getUTCMonth() + 1, day: at.getUTCDate(), weekday: at.getUTCDay(), hour: at.getUTCHours(), minute: at.getUTCMinutes() };
  }
  if (!timeZone) {
    return { year: at.getFullYear(), month: at.getMonth() + 1, day: at.getDate(), weekday: at.getDay(), hour: at.getHours(), minute: at.getMinutes() };
  }
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" }).formatToParts(at);
    const figure = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const [year, month, day, minute] = [figure("year"), figure("month"), figure("day"), figure("minute")];
    // Midnight has been written "24" by some engines however the clock is asked for.
    const hour = figure("hour") % 24;
    if ([year, month, day, hour, minute].some((n) => !Number.isFinite(n))) return null;
    return { year, month, day, weekday: new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay(), hour, minute };
  } catch {
    // A zone the platform refuses.
    return null;
  }
}

function field(words: DateWords, at: DateFields, key: string): string {
  switch (key) {
    case "y":
      return String(at.year);
    case "n":
      return String(at.month);
    case "nn":
      return two(at.month);
    case "b":
      return words.months[at.month - 1];
    case "B":
      return words.monthsLong[at.month - 1];
    case "d":
      return String(at.day);
    case "dd":
      return two(at.day);
    case "a":
      return words.days[at.weekday];
    case "A":
      return words.daysLong[at.weekday];
    case "h":
      return String(at.hour % 12 || 12);
    case "hh":
      return two(at.hour % 12 || 12);
    case "H":
      return String(at.hour);
    case "HH":
      return two(at.hour);
    case "mm":
      return two(at.minute);
    case "p":
      return at.hour < 12 ? words.am : words.pm;
    default:
      // A template with a field this does not know is a table and a formatter out of step: say so, in the text.
      return `{${key}}`;
  }
}

const FIELD = /\{([a-zA-Z]+)([12]?)\}/g;

const fill = (words: DateWords, template: string, a: DateFields, b: DateFields = a) =>
  template.replace(FIELD, (_, key: string, end: string) => field(words, end === "2" ? b : a, key));

/** One moment, in one of the shapes the app writes. */
export function writeDate(words: DateWords, shape: DateShape, at: DateFields): string {
  return fill(words, words[shape], at);
}

/**
 * A span of days. Which of the three templates depends on what the two ends
 * share — a month, a year, or neither — because that is what decides how much
 * of the second a language leaves out. The same day twice is one day.
 */
export function writeDayRange(words: DateWords, a: DateFields, b: DateFields): string {
  if (a.year === b.year && a.month === b.month && a.day === b.day) return writeDate(words, "day", a);
  const template = a.year !== b.year ? words.rangeAcross : a.month !== b.month ? words.rangeInYear : words.rangeInMonth;
  return fill(words, template, a, b);
}
