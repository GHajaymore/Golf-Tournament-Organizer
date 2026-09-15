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
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return value;
  try {
    return new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(d);
  } catch {
    return value;
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
    return fmt.formatRange(start, end);
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
    return new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(
      new Date(`${value}T00:00:00Z`),
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
