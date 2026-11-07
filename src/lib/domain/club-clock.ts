/**
 * WHAT DAY IT IS AT THE CLUB (2026-10-11).
 *
 * Every deadline in the app is a DAY — "entries close on the 12th", "answer by
 * Tuesday", "Round 2 is played on Saturday" — and a day belongs to a place.
 * Until this existed, the day was whatever the SERVER's clock said, and the
 * server is on UTC. So for a club on the east coast of the United States:
 *
 *     entries close 12 October      closed at 8pm on the 12th, four hours early
 *     opt out by Tuesday            refused from 8pm on Tuesday
 *     Saturday's round is "today"   until 8pm, then "yesterday" — with the
 *                                   last groups still on the course
 *
 * and for a club in Sydney the same things ran eleven hours LATE: a Saturday
 * 8am shotgun was "tomorrow" on the player's phone until late morning.
 *
 * Nothing in the suite could see it, because every test ran with the server
 * and the reader on one machine — one clock, one zone. In CI both are UTC.
 *
 * So the club says where it is (`Organization.timeZone`, an IANA name), and
 * the day is asked of THAT clock. A club that has not said — every club made
 * before the setting — keeps the server's day, exactly as before.
 *
 * The Committee sets the dates for entering (Committee Procedures, Section
 * 5A) and the starting time a player is held to (Rule 5.3a). A committee
 * means its own clock by both; there is no other reading an organizer would
 * accept.
 */
import { dateWordsFor, fieldsAt, writeDate } from "./date-words";
import { formatDay } from "./locale";

/** Whether `value` is a time zone this runtime can reason about. */
export function isTimeZone(value: string | null | undefined): value is string {
  if (!value || typeof value !== "string") return false;
  // `Intl.DateTimeFormat` THROWS on an unknown zone, the same way it does on a
  // malformed locale — an unchecked value would break every screen that asks
  // what day it is, for the club that had just set it.
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const two = (n: number) => String(n).padStart(2, "0");

/** This machine's own day — what every club had before it could say where it is. */
const machineDay = (at: Date) => `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`;

/**
 * Today at the club, as the yyyy-mm-dd a date input produces.
 *
 * `at` is the instant, and an instant is the same everywhere — so the server's
 * clock is the right one to read it from. Only the DAY it falls on depends on
 * where you are standing.
 */
export function clubToday(timeZone: string | null | undefined, at: Date = new Date()): string {
  if (!isTimeZone(timeZone)) return machineDay(at);
  // Read back as NUMBERS, so the calendar and the digits are pinned: nobody is
  // shown this, and a yyyy-mm-dd in another numbering system compares as garbage.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/**
 * A moment inside the club's day, for a helper that takes a `Date` and asks it
 * what DAY it is — `deadlinePassed`, `registrationStatus`, `playerMayChange`.
 *
 * It is the club's day at noon by THIS machine's clock, so that those helpers'
 * own `getFullYear() / getMonth() / getDate()` read the club's date. It is
 * therefore NOT the present instant, and must never be compared with a stored
 * timestamp. Use it for day questions only.
 */
export function clubDay(timeZone: string | null | undefined, at: Date = new Date()): Date {
  const [y, m, d] = clubToday(timeZone, at).split("-").map(Number);
  return new Date(y, m - 1, d, 12);
}

/**
 * THE INSTANT THE CLUB'S DAY ENDS — midnight at the club, as a timestamp the
 * server can compare with its own clock. For a thing that must not outlive the
 * day it was opened on (the committee correction, PR 5b: "until Done or the end
 * of the club's day, whichever comes first"). An INSTANT, so it may be stored
 * and compared with `new Date()`; the day it closes is still the CLUB's.
 *
 * Found by asking the club's wall clock what it reads at the server's midnight
 * guess, and moving the guess by the difference — twice, for the one night a
 * year the offset changes between the two readings. A club that has not said
 * where it is keeps this machine's clock, as `clubToday` does.
 */
export function endOfClubDay(timeZone: string | null | undefined, at: Date = new Date()): Date {
  const [y, m, d] = clubToday(timeZone, at).split("-").map(Number);
  if (!isTimeZone(timeZone)) return new Date(y, m - 1, d + 1, 0, 0, 0, 0);
  const wantedMinutes = Date.UTC(y, m - 1, d + 1) / 60_000;
  let guess = new Date(wantedMinutes * 60_000);
  for (let i = 0; i < 2; i++) {
    const f = fieldsAt(guess, timeZone);
    if (!f) return guess;
    const readMinutes = Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute) / 60_000;
    guess = new Date(guess.getTime() + (wantedMinutes - readMinutes) * 60_000);
  }
  return guess;
}

/**
 * THE CLOCK ON THE CLUB'S WALL AT AN INSTANT: the club's day (as `clubToday`
 * gives it) and the minutes past midnight there. For a question asked of a
 * time the committee WROTE on the club's own clock — a tee time, "8:10 AM" —
 * which is a wall-clock time at the club, not an instant (Rule 5.3a: the
 * starting time the Committee sets). Compare it with another wall-clock time on
 * the same day; never with a stored timestamp. A club that has not said where
 * it is keeps this machine's clock, as `clubToday` does.
 */
export function clubWallClock(timeZone: string | null | undefined, at: Date = new Date()): { day: string; minutes: number } {
  const day = clubToday(timeZone, at);
  const fields = isTimeZone(timeZone) ? fieldsAt(at, timeZone) : null;
  const minutes = fields ? fields.hour * 60 + fields.minute : at.getHours() * 60 + at.getMinutes();
  return { day, minutes };
}

/**
 * The day an INSTANT fell on at a club, in that club's words: "3 Apr 2026". For a timestamp somebody
 * will read as a date — when a card was checked, when money changed hands — where there is a club in
 * hand and no tournament (`dayAtClubForEvent` in services is the same answer from a tournament's id).
 */
export function clubDayInWords(timeZone: string | null | undefined, locale: string | null | undefined, at: Date): string {
  return formatDay(clubToday(timeZone, at), locale || undefined);
}

/**
 * The clock on the club's wall, for the settings screen: "Sunday 11 October,
 * 14:05". Words rather than an offset, because an organizer checks a zone by
 * looking at the time, not by knowing what "UTC−04:00" means.
 */
export function clubClockInWords(timeZone: string | null | undefined, locale: string, at: Date = new Date()): string {
  if (!isTimeZone(timeZone)) return "";
  // In the app's own words where it holds this club's conventions (`date-words.ts`), so the settings
  // screen reads the same from the server and in every browser; the platform's for any other tag.
  const words = dateWordsFor(locale);
  const fields = words ? fieldsAt(at, timeZone as string) : null;
  if (words && fields) return writeDate(words, "wall", fields);
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone,
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    }).format(at);
  } catch {
    return "";
  }
}

/**
 * Every zone the picker offers, in the order the runtime lists them (by
 * region, then city). Empty on a runtime too old to say — the screen then
 * offers the device's own zone and nothing else, which is the common case
 * anyway.
 */
export function timeZoneChoices(): string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  if (typeof supported !== "function") return [];
  try {
    return supported.call(Intl, "timeZone");
  } catch {
    return [];
  }
}
