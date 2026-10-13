/**
 * HOW THIS CLUB WRITES A DATE AND AN AMOUNT — decided once, here.
 *
 * Every date in this app was formatted with a hardcoded `"en-US"` and every
 * amount with `Intl.NumberFormat("en-US")`. A club in Surrey read its own
 * tournament as "May 14–16, 2026" rather than "14–16 May 2026"; a club in
 * Osaka read it the same way. Currency was already the club's own setting —
 * the WAY it was written was not, so a European club set to EUR still saw
 * "€1,234.00" instead of "1.234,00 €".
 *
 * Two other screens formatted with `undefined` — the VIEWER's locale — so the
 * same tournament's dates changed shape depending on which screen you were on
 * and which laptop you were sitting at. That is the worse of the two faults:
 * a club's own tournament should not read differently to the secretary and to
 * the member, and the viewer's browser is not the authority on how this club
 * writes a date.
 *
 * WHOSE ANSWER WINS, and why there are two levels. The club's locale is the
 * default because that is where the members are. A TOURNAMENT may override it,
 * because a club genuinely runs events to other conventions — an invitational
 * played to American ones by a club that is not American, or a dollar-priced
 * event at a club whose letters are in yen.
 *
 * Locale and currency are separate overrides rather than one "US mode",
 * because they are two questions: a Japanese club running a USD-priced
 * invitational still writes the date its own way.
 *
 * EVERYTHING GOES THROUGH HERE. `no-hardcoded-locale.test.ts` sweeps for
 * `"en-US"` written anywhere else in `src`, because the fault this replaces
 * was not one bad call — it was eleven, spread across six files, each
 * perfectly reasonable on its own.
 */

import { isCurrencyCode, money, DEFAULT_CURRENCY } from "./money-format";
import { dateWordsFor, fieldsAt, fieldsOfDay, writeDate, writeDayRange, type DateShape } from "./date-words";

export { DEFAULT_CURRENCY };

/**
 * Both answers, resolved once, for a screen to carry around.
 *
 * WHY THIS EXISTS RATHER THAN TWO ARGUMENTS EVERYWHERE. A money screen needs
 * the currency AND the locale, and every caller passing them separately is a
 * caller that can pass one and forget the other — which fails silently, in the
 * direction where the symbol is right and the conventions are American. Those
 * are the two halves of this whole defect and they should not be separable at
 * the call site.
 *
 * THE DEPENDENCY RUNS ONE WAY, deliberately. `money-format.ts` knows about
 * currencies and nothing about clubs; this module knows about clubs and calls
 * it. Reversing any part of that — having `money()` resolve a club's locale
 * itself — is an import cycle, and the reason `money()` takes a locale as a
 * plain argument rather than looking one up.
 */
export interface Formatting {
  locale: string;
  currency: string;
}

/** Everything a screen needs to write this tournament's dates and amounts. */
export function formattingFor(
  club?: LocaleSource | null,
  event?: LocaleOverride | null,
): Formatting {
  return { locale: resolveLocale(club, event), currency: resolveCurrency(club, event) };
}

/**
 * An amount in minor units, written for this tournament.
 *
 * The one call a money screen should make. It cannot get the pair wrong,
 * because there is no way to hand it a currency without the locale that goes
 * with it.
 */
export function formatMoney(minorUnits: number, f: Formatting): string {
  return money(minorUnits, f.currency, f.locale);
}

/** What a club or tournament tells us about how it writes things. */
export interface LocaleSource {
  /** The club's BCP-47 tag. Empty or missing falls back to `DEFAULT_LOCALE`. */
  locale?: string | null;
  /** The club's ISO currency code. */
  currency?: string | null;
}

/** What one tournament says, where it says anything. */
export interface LocaleOverride {
  localeOverride?: string | null;
  currencyOverride?: string | null;
}

/**
 * US English, because it is what every existing row was rendered as.
 *
 * A default of "the server's locale" would make the same tournament render
 * differently depending on which machine answered the request, which is the
 * viewer-locale fault one level further from anybody noticing.
 */
export const DEFAULT_LOCALE = "en-US";

/**
 * Whether a string is a locale `Intl` will actually accept.
 *
 * Checked rather than trusted: these values reach the database from a form,
 * and `Intl.DateTimeFormat` THROWS a RangeError on a malformed tag. An
 * unvalidated one would not mis-format a date, it would break the screen —
 * and it would break it for the club that had just set its own locale, which
 * is the worst possible moment.
 */
export function isSupportedLocale(tag: string): boolean {
  const value = (tag ?? "").trim();
  if (!value) return false;
  try {
    return Intl.DateTimeFormat.supportedLocalesOf([value]).length > 0;
  } catch {
    return false;
  }
}

/**
 * The locale to write this tournament's dates in.
 *
 * The tournament's own answer, then the club's, then US English. Each step
 * falls through when the value is empty OR unusable, so a tag that `Intl`
 * would reject degrades to the next answer rather than to an exception.
 */
export function resolveLocale(club?: LocaleSource | null, event?: LocaleOverride | null): string {
  const tournament = (event?.localeOverride ?? "").trim();
  if (isSupportedLocale(tournament)) return tournament;
  const house = (club?.locale ?? "").trim();
  if (isSupportedLocale(house)) return house;
  return DEFAULT_LOCALE;
}

/**
 * The currency to price this tournament in. Same order of precedence.
 *
 * ANY ISO CURRENCY, not a US/local switch: `isCurrencyCode` checks against
 * `Intl.supportedValuesOf("currency")`, which is the real list of about three
 * hundred. A club in Tokyo can run a tournament priced in AUD, and a club in
 * Sydney one priced in yen.
 *
 * Validated through `isCurrencyCode` rather than a shape test written here.
 * The first draft of this function checked `/^[A-Z]{3}$/`, which is a SECOND
 * and weaker copy of a rule that already exists — and weaker in the direction
 * that matters: `Intl` formats any three letters happily, so "ABC" would have
 * passed and landed in the database looking deliberate. That module's own
 * comment says so in as many words.
 */
export function resolveCurrency(club?: LocaleSource | null, event?: LocaleOverride | null): string {
  const tournament = (event?.currencyOverride ?? "").trim().toUpperCase();
  if (isCurrencyCode(tournament)) return tournament;
  const house = (club?.currency ?? "").trim().toUpperCase();
  if (isCurrencyCode(house)) return house;
  return DEFAULT_CURRENCY;
}

/**
 * Intl's output with its typographic spaces made plain.
 *
 * THE SERVER AND THE BROWSER DO NOT FORMAT A DATE IN THE SAME BYTES. Node and
 * Chrome ship different ICU/CLDR data, and the newer one puts THIN spaces
 * (U+2009) around a range dash and a NARROW no-break space (U+202F) before
 * "AM"/"PM". Measured 2026-09-25 on the Tournament details screen's formatting
 * preview: the server wrote 14 U+2009 U+2013 U+2009 16 May 2026, Chrome wrote
 * the same with ordinary spaces. They look identical, and React compares bytes
 * — so every client component that formats a date while rendering threw a
 * hydration mismatch (production React error #418, which the CI logs are full
 * of) and threw its server HTML away to re-render on the client.
 *
 * Flattening both to an ordinary space here, at the one place dates are
 * formatted, makes the two sides agree whatever ICU each ships.
 */
export function plainSpaces(text: string): string {
  return text.replace(/[  ]/g, " ");
}

/**
 * One ordinary space each side of a tilde that marks a range.
 *
 * THE NEXT DIFFERENCE AFTER THE SPACES (2026-10-11). `plainSpaces` makes two
 * engines agree about WHICH space; it cannot make them agree about WHETHER
 * there is one. Node writes a Korean range within a month "14일~16일" and
 * Chromium "14일 ~ 16일" — measured over all ten locales the picker offers and
 * every kind of range, that is the one place THOSE two part (Safari's engine
 * parts from them about the en dash — see below the function). So a tournament
 * set to Korea threw a hydration mismatch on every load of a screen that
 * formats a range while rendering.
 *
 * The spaced form is the one settled on: it is what a browser has been
 * showing all along, once React had thrown the server's version away.
 *
 * `e2e/formats-agree.spec.ts` runs every formatter here on both sides, for
 * every locale and currency offered, and fails on the next one.
 */
function evenRangeMark(text: string): string {
  return text.replace(/ *~ */g, " ~ ").replace(/(\d) *– *(\d)/g, "$1–$2");
}

/*
 * AND THE EN DASH BETWEEN TWO DAYS, WHICH IS THE SAME QUESTION IN SAFARI
 * (2026-10-11). The first run of `formats-agree` on WebKit — the engine every
 * iPhone uses, and one this suite had never started — found the server writing
 * a British range within a month "14 – 16 May 2026" and the phone writing
 * "14–16 May 2026". Newer locale data spaces that dash for en-GB, en-US and
 * pt-BR; older data, and every other locale offered, closes it up. So a club
 * on British dates threw a hydration mismatch on every iPhone, on any screen
 * that words a range while drawing.
 *
 * Closed up is the form settled on, between two DIGITS only: it is what most
 * locales and most phones already wrote, and it is how a range of days is
 * conventionally set. A dash between words ("30 May – 2 Jun") or after a
 * German full stop ("14.–16. Mai") is left exactly as each locale sets it —
 * every engine agreed about those.
 *
 * This is one engine's data against another's, and a phone two years old
 * carries a third. `formats-agree` holds the ones that can be run here.
 */

/**
 * Which day this club's calendar week starts on: 0 for Sunday, 1 for Monday.
 *
 * Every month grid started on Sunday, so a British club's calendar read
 * S M T W T F S where its members' diaries read M T W T F S S (the landing
 * session, 2026-09-28). Most of the world starts on Monday (ISO 8601); the
 * Sunday-first places are listed.
 *
 * A TABLE rather than `Intl.Locale#getWeekInfo`, deliberately. The grid is
 * drawn on the server and again in the browser, and the two ship different ICU
 * — `plainSpaces` above exists because they already disagreed once — while
 * `getWeekInfo` is also missing from some browsers. A week that started on
 * Monday in the HTML and Sunday after hydration would redraw every square.
 */
const SUNDAY_FIRST_REGIONS = new Set(["US", "CA", "MX", "BR", "IN", "JP", "KR", "TW", "HK", "PH", "IL", "ZA"]);

export function firstDayOfWeek(locale: string = DEFAULT_LOCALE): 0 | 1 {
  const region = (locale ?? "").split("-")[1]?.toUpperCase() ?? "";
  if (!region) return 0; // no region: the old answer
  return SUNDAY_FIRST_REGIONS.has(region) ? 0 : 1;
}

/**
 * Whether this club writes a clock time on the 24-hour clock — "17:30", not
 * "5:30 PM".
 *
 * A tee time is the one TIME the app writes, and it was always drawn as
 * "8:10 AM" whatever the club: a Scottish club's tee sheet read "8:10 AM"
 * while its own seeded sheets and every member's card read "17:30" (walked
 * 2026-09-28). Asked of Intl rather than a list of countries, so every locale
 * answers as its own conventions do: en-GB, en-IE and en-ZA say 24-hour; en-US,
 * en-AU, en-CA and en-NZ say 12-hour. An unknown tag keeps the old answer.
 */
export function usesTwentyFourHourClock(locale: string = DEFAULT_LOCALE): boolean {
  // The app's own table first: a tee sheet is drawn on both sides, and two engines need not agree here either.
  const words = dateWordsFor(locale);
  if (words) return !words.hour12;
  try {
    const cycle = new Intl.DateTimeFormat(locale, { hour: "numeric" }).resolvedOptions().hourCycle;
    return cycle === "h23" || cycle === "h24";
  } catch {
    return false;
  }
}

/**
 * A calendar day, written the way this club writes one.
 *
 * Takes an ISO `yyyy-mm-dd` and never a `Date`, and forces `timeZone: "UTC"`,
 * because a tournament date is a DAY and not an instant. Parsing "2026-05-14"
 * with `new Date()` applies the server's offset, and west of UTC that renders
 * the 13th — a round dated the day before it was played, on every screen, for
 * half the world.
 */
export function formatDay(iso: string, locale: string = DEFAULT_LOCALE): string {
  const value = (iso ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  // WRITTEN BY THE APP wherever it knows this club's conventions (`date-words.ts`): the server and every
  // browser then write the same bytes. The platform below is for a tag the table does not hold.
  const words = dateWordsFor(locale);
  const day = fieldsOfDay(value);
  // The 31st of February has the shape of a day and is not one. `Date` would quietly write the 3rd of
  // March; what is not a day goes back as it was handed in, like anything else that is not one.
  if (!day) return value;
  if (words) return writeDate(words, "day", day);
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return value;
  try {
    return plainSpaces(
      new Intl.DateTimeFormat(locale, {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      }).format(d),
    );
  } catch {
    return value;
  }
}

/**
 * A TIME OF DAY, WRITTEN THE SAME ON THE SERVER AND IN THE BROWSER (2026-10-12).
 *
 * A screen drawn on both sides is written twice — by Node, then by the browser
 * — and React compares the two. For a date both read the same tables. For the
 * words "AM" and "PM" they need not: the first CI run of `formats-agree.spec`
 * (Node 20 on Linux, against Chromium) wrote a Korean club's "Recent changes"
 * as "5월 14일 PM 01:05" on the server and "5월 14일 오후 01:05" in the browser.
 * Same day, same minute, a different word, because the two carry different
 * editions of the locale data. Every local run had passed: this machine's Node
 * is newer and agrees with the browser. A difference like that is a hydration
 * mismatch waiting for a server and a browser of different vintages, and
 * production's server is not chosen by this repository.
 *
 * So the day-period word is not left to either engine where they are known to
 * differ: it is taken from a table here, and everything else about the time —
 * the order, the digits, the separators — still comes from `Intl`, which both
 * sides agree on. Every caller that writes a clock time comes through this, and
 * the spec formats through it on both sides, so the next language whose engines
 * part company fails that spec and gets a line in the table.
 */
const OWN_DAY_PERIODS: Record<string, readonly [string, string]> = {
  // 오전 / 오후 — written as escapes so no editor or shell can re-encode them.
  ko: ["\uC624\uC804", "\uC624\uD6C4"],
};

export function formatClock(at: Date, locale: string | undefined, options: Intl.DateTimeFormatOptions): string {
  // SINCE 2026-10-13 THE WHOLE LINE IS THE APP'S OWN, not only the day-period word, for every language
  // the table holds: the first run on Firefox found the HOUR written "1:05" by the server and "01:05" by
  // the browser. What follows is for a tag the table does not hold, the device's own language
  // (`locale` undefined, which only a browser may ask for), and a shape the table does not keep.
  const words = dateWordsFor(locale);
  const shape = clockShape(options);
  const fields = words && shape ? fieldsAt(at, options.timeZone) : null;
  if (words && shape && fields) return writeDate(words, shape, fields);
  const format = new Intl.DateTimeFormat(locale, options);
  const own = OWN_DAY_PERIODS[format.resolvedOptions().locale.split("-")[0]];
  if (!own) return plainSpaces(format.format(at));
  const parts = format.formatToParts(at);
  if (!parts.some((p) => p.type === "dayPeriod")) return plainSpaces(format.format(at));
  // Which half of the day, asked in a form no locale data can vary: the hour on a 24-hour clock, in digits.
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: options.timeZone }).format(at));
  return plainSpaces(parts.map((p) => (p.type === "dayPeriod" ? own[hour < 12 ? 0 : 1] : p.value)).join(""));
}

/**
 * Which of the table's two clock shapes these options ask for, or null for anything else. The two are
 * spelled exactly as the callers spell them: a time of day, and a day with its time for a line in a log.
 */
function clockShape(options: Intl.DateTimeFormatOptions): DateShape | null {
  const asked = Object.entries(options)
    .filter(([key, value]) => key !== "timeZone" && value !== undefined)
    .map(([key, value]) => `${key}:${value}`)
    .sort()
    .join(" ");
  if (asked === "hour:numeric minute:2-digit") return "time";
  if (asked === "day:numeric hour:2-digit minute:2-digit month:short") return "stamp";
  return null;
}

/**
 * The day an INSTANT falls on — "14 May 2026" — in a zone, or on the device's
 * own clock when none is given. For a stamp ("Entered by Ann · 14 May 2026"),
 * where the thing in hand is a time something happened and not a calendar day.
 * A screen drawn on both sides passes "UTC" until it has mounted.
 */
export function formatDayAt(at: Date, locale: string = DEFAULT_LOCALE, timeZone?: string): string {
  const words = dateWordsFor(locale);
  const fields = words ? fieldsAt(at, timeZone) : null;
  if (words && fields) return writeDate(words, "day", fields);
  try {
    return plainSpaces(new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric", ...(timeZone ? { timeZone } : {}) }).format(at));
  } catch {
    return "";
  }
}

/** The same without the year — "14 May" — for a message in a thread. */
export function formatMonthDayAt(at: Date, locale: string = DEFAULT_LOCALE, timeZone?: string): string {
  const words = dateWordsFor(locale);
  const fields = words ? fieldsAt(at, timeZone) : null;
  if (words && fields) return writeDate(words, "monthDay", fields);
  try {
    return plainSpaces(new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", ...(timeZone ? { timeZone } : {}) }).format(at));
  } catch {
    return "";
  }
}

/**
 * A span of days: "May 14 – 16, 2026", "14–16 May 2026", and so on.
 *
 * Uses `formatRange`, which is the only thing that knows where each locale
 * puts the dash and which parts it is willing to drop — English collapses the
 * repeated month, German does not, Japanese writes the year first. Hand-built
 * ranges get that wrong in a way that looks fine in the language you wrote
 * them in, which is precisely how the previous version ("May 14–16, 2026",
 * assembled by hand) was American-only without anybody deciding it should be.
 */
export function formatDayRange(
  startIso: string,
  endIso: string,
  locale: string = DEFAULT_LOCALE,
): string {
  const a = (startIso ?? "").trim();
  const b = (endIso ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a)) return formatDay(b, locale);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b)) return formatDay(a, locale);
  if (a === b) return formatDay(a, locale);
  // The app's own templates where it holds them; `formatRange` below for any other tag. The docstring's
  // warning about hand-built ranges still stands: these are not hand-built, they are the platform's own
  // three answers (same month, same year, across a year) read once and kept — see `date-words.ts`.
  const words = dateWordsFor(locale);
  const [from, to] = [fieldsOfDay(a), fieldsOfDay(b)];
  if (words && from && to) return writeDayRange(words, from, to);
  const start = new Date(`${a}T00:00:00Z`);
  const end = new Date(`${b}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return formatDay(a, locale);
  try {
    const fmt = new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
    return evenRangeMark(plainSpaces(fmt.formatRange(start, end)));
  } catch {
    return `${formatDay(a, locale)} – ${formatDay(b, locale)}`;
  }
}

/**
 * Just the month, for the places that label a column rather than a date.
 */
export function formatMonth(iso: string, locale: string = DEFAULT_LOCALE): string {
  const value = (iso ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  try {
    return plainSpaces(
      new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(
        new Date(`${value}T00:00:00Z`),
      ),
    );
  } catch {
    return value;
  }
}

/**
 * THE SAME THREE, TAKING THE RESOLVED PAIR.
 *
 * `formatDay(iso, locale)` above takes a bare tag because plenty of callers
 * genuinely have only that — a public board with no club in scope, a test.
 * A screen that has resolved a `Formatting` should not have to reach inside it
 * and pick out `.locale`, because reaching inside it is exactly how a caller
 * ends up passing the locale to one call and forgetting the currency on the
 * next.
 */
export function formatDayIn(iso: string, f: Formatting): string {
  return formatDay(iso, f.locale);
}

export function formatDayRangeIn(startIso: string, endIso: string, f: Formatting): string {
  return formatDayRange(startIso, endIso, f.locale);
}

export function formatMonthIn(iso: string, f: Formatting): string {
  return formatMonth(iso, f.locale);
}

/**
 * The regions offered in the picker.
 *
 * NOT A CLOSED LIST — `resolveLocale` accepts any tag `Intl` supports, and a
 * club already holding one the list does not offer keeps it. This is the
 * shortlist a golf secretary picks from, not the set of legal answers.
 *
 * Chosen to span the conventions rather than the countries, which is why it is
 * short and why the ones that look redundant are not:
 *
 *   en-US   month first, "May 14, 2026"
 *   en-GB   day first, "14 May 2026" — and Ireland, most of Europe's clubs
 *   en-AU   day first, distinct number and currency handling from en-GB
 *   en-IN   day first, and the only one here that groups 1,23,456 rather
 *           than 123,456 — an Indian club's prize list is visibly wrong
 *           under any of the others
 *   ja-JP   year first, "2026年5月14日", and a currency with no minor unit
 *   ko-KR   year first, same minor-unit question as Japan
 *   de-DE   day first, "1.234,00 €" — the trailing symbol
 *   fr-FR   day first, space as the thousands separator
 *   es-ES   day first, another European grouping
 *   zh-CN   year first
 *
 * Golf's centre of gravity is not the United States alone, and this app
 * defaulted every date to American for its whole life — Japan, Korea and
 * Australia between them run a great many more club competitions than the
 * original hardcoded "en-US" implied anybody had thought about.
 */
export const LOCALES: Array<{ tag: string; label: string }> = [
  { tag: "en-US", label: "United States — May 14, 2026" },
  { tag: "en-GB", label: "United Kingdom & Ireland — 14 May 2026" },
  { tag: "en-AU", label: "Australia & New Zealand — 14 May 2026" },
  { tag: "en-IN", label: "India — 14 May 2026" },
  { tag: "ja-JP", label: "Japan — 2026年5月14日" },
  { tag: "ko-KR", label: "Korea — 2026. 5. 14." },
  { tag: "zh-CN", label: "China — 2026年5月14日" },
  { tag: "de-DE", label: "Germany & Austria — 14.05.2026" },
  { tag: "fr-FR", label: "France — 14 mai 2026" },
  { tag: "es-ES", label: "Spain — 14 may 2026" },
];
