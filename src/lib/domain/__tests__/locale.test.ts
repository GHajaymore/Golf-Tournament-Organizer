import { describe, it, expect } from "vitest";
import {
  resolveLocale,
  resolveCurrency,
  formattingFor,
  formatMoney,
  formatDay,
  formatDayRange,
  isSupportedLocale,
  DEFAULT_LOCALE,
} from "../locale";

/**
 * A CLUB'S DATES AND MONEY, WRITTEN THE WAY THAT CLUB WRITES THEM.
 *
 * Asserted as VALUES against how each place actually writes a date, not as
 * shapes. A test that checked "returns a non-empty string" would pass on every
 * locale rendering American, which is the state this replaces.
 *
 * The exact punctuation `Intl` emits is the runtime's business and moves
 * between ICU versions, so these assert the FACTS a reader would notice — that
 * the day comes before the month in London and after it in New York, that the
 * year leads in Tokyo, that the euro sign trails in Berlin — rather than
 * pinning a byte-for-byte string that a Node upgrade would break.
 */

const CLUB_US = { locale: "en-US", currency: "USD" };
const CLUB_GB = { locale: "en-GB", currency: "GBP" };
const CLUB_JP = { locale: "ja-JP", currency: "JPY" };
const CLUB_DE = { locale: "de-DE", currency: "EUR" };

describe("whose answer decides how a tournament reads", () => {
  it("uses the club's when the tournament says nothing", () => {
    expect(resolveLocale(CLUB_GB, { localeOverride: "" })).toBe("en-GB");
    expect(resolveCurrency(CLUB_GB, { currencyOverride: "" })).toBe("GBP");
  });

  it("lets one tournament override the club", () => {
    // The case asked for: a club that is not American running an event to
    // American conventions.
    expect(resolveLocale(CLUB_JP, { localeOverride: "en-US" })).toBe("en-US");
    expect(resolveCurrency(CLUB_JP, { currencyOverride: "USD" })).toBe("USD");
  });

  it("takes ANY currency, not just the club's or the dollar", () => {
    /**
     * `isCurrencyCode` asks `Intl.supportedValuesOf("currency")`, which is the
     * real ISO list of about three hundred — so this is not a US/local switch.
     * Four continents' worth, to prove the list rather than a hardcoded few.
     */
    for (const code of ["AUD", "SGD", "INR", "ZAR", "CHF", "BRL", "KRW"]) {
      expect(resolveCurrency(CLUB_GB, { currencyOverride: code }), code).toBe(code);
    }
  });

  it("overrides the two independently", () => {
    // A Japanese club pricing an invitational in dollars still writes its
    // dates the Japanese way. One "US mode" flag could not express this.
    const f = formattingFor(CLUB_JP, { localeOverride: "", currencyOverride: "USD" });
    expect(f.locale).toBe("ja-JP");
    expect(f.currency).toBe("USD");
  });

  it("falls back rather than throwing on a value that is not usable", () => {
    /**
     * These reach the database from a form. `Intl.DateTimeFormat` throws a
     * RangeError on a malformed tag, so an unvalidated one would not
     * mis-format a date — it would break the screen, for the club that had
     * just set it.
     */
    expect(resolveLocale({ locale: "not a locale" }, null)).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(CLUB_GB, { localeOverride: "zz-ZZ-nonsense" })).toBe("en-GB");
    // "ABC" is three letters and `Intl` would format it happily as a currency,
    // which is why the shape alone is not the test.
    expect(resolveCurrency(CLUB_GB, { currencyOverride: "ABC" })).toBe("GBP");
    expect(resolveCurrency(null, null)).toBe("USD");
  });

  it("recognises the locales the app offers", () => {
    // The control on the fallbacks above: "falls back" is also true of a
    // validator that rejects everything.
    for (const tag of ["en-US", "en-GB", "ja-JP", "de-DE", "fr-FR", "en-AU", "ko-KR"]) {
      expect(isSupportedLocale(tag), tag).toBe(true);
    }
  });
});

describe("a date, written where the club is", () => {
  const ISO = "2026-05-14";

  it("puts the month first in the United States", () => {
    const s = formatDay(ISO, "en-US");
    expect(s).toContain("May");
    expect(s).toContain("14");
    // "May 14, 2026" — the month is ahead of the day.
    expect(s.indexOf("May")).toBeLessThan(s.indexOf("14"));
  });

  it("puts the day first in the United Kingdom", () => {
    const s = formatDay(ISO, "en-GB");
    expect(s).toContain("May");
    expect(s).toContain("14");
    // "14 May 2026" — and this is the assertion the old hardcoded "en-US"
    // could never have satisfied.
    expect(s.indexOf("14")).toBeLessThan(s.indexOf("May"));
  });

  it("leads with the year in Japan", () => {
    const s = formatDay(ISO, "ja-JP");
    expect(s).toContain("2026");
    expect(s.indexOf("2026")).toBe(0);
  });

  it("is a different string in London and New York", () => {
    /**
     * THE CONTROL ON ALL THREE. Each assertion above is also satisfied by a
     * formatter that ignores its locale and happens to contain the right
     * substrings. This one cannot be: it requires the locale to have changed
     * the answer.
     */
    expect(formatDay(ISO, "en-GB")).not.toBe(formatDay(ISO, "en-US"));
    expect(formatDay(ISO, "ja-JP")).not.toBe(formatDay(ISO, "en-US"));
  });

  it("does not shift the day for a reader west of UTC", () => {
    /**
     * A tournament date is a calendar DAY, not an instant. Parsing it with
     * `new Date("2026-05-14")` and formatting in a local zone renders the 13th
     * anywhere behind UTC — a round dated the day before it was played, on
     * every screen, for half the world. `formatDay` pins `timeZone: "UTC"`.
     */
    for (const locale of ["en-US", "en-GB", "ja-JP"]) {
      expect(formatDay("2026-05-14", locale), locale).toContain("14");
      expect(formatDay("2026-01-01", locale), locale).toContain("2026");
    }
  });

  it("hands back anything that is not a date unchanged", () => {
    // `Event.dates` is free text by design — a club may write "Summer 2026".
    // Formatting must not eat what it cannot parse.
    expect(formatDay("Summer 2026", "en-GB")).toBe("Summer 2026");
    expect(formatDay("", "en-GB")).toBe("");
  });
});

describe("a span of days", () => {
  it("collapses the repeated month in English and still names both days", () => {
    const s = formatDayRange("2026-05-14", "2026-05-16", "en-US");
    expect(s).toContain("14");
    expect(s).toContain("16");
    expect(s).toContain("2026");
  });

  it("writes it differently in the United Kingdom", () => {
    expect(formatDayRange("2026-05-14", "2026-05-16", "en-GB")).not.toBe(
      formatDayRange("2026-05-14", "2026-05-16", "en-US"),
    );
  });

  it("crosses a month and a year without losing either end", () => {
    const month = formatDayRange("2026-05-30", "2026-06-02", "en-US");
    expect(month).toContain("30");
    expect(month).toContain("2");
    const year = formatDayRange("2026-12-30", "2027-01-02", "en-US");
    expect(year).toContain("2026");
    expect(year).toContain("2027");
  });

  it("gives a single day when both ends are the same", () => {
    expect(formatDayRange("2026-05-14", "2026-05-14", "en-GB")).toBe(formatDay("2026-05-14", "en-GB"));
  });
});

describe("an amount, written where the club is", () => {
  it("writes dollars the American way", () => {
    expect(formatMoney(123400, formattingFor(CLUB_US, null))).toBe("$1,234.00");
  });

  it("writes pounds the British way", () => {
    expect(formatMoney(123400, formattingFor(CLUB_GB, null))).toBe("£1,234.00");
  });

  it("puts the euro sign where a German club puts it", () => {
    /**
     * The half that was invisible. The currency was already the club's, so
     * the SYMBOL was right — and `Intl.NumberFormat("en-US")` still wrote
     * "€1,234.00" where the members write "1.234,00 €". Asserted as "the sign
     * is not at the front" rather than as an exact string, because the space
     * before it is a non-breaking one and varies by ICU version.
     */
    const s = formatMoney(123400, formattingFor(CLUB_DE, null));
    expect(s).toContain("€");
    expect(s.trim().startsWith("€"), `German amounts trail the sign: ${s}`).toBe(false);
    expect(s).not.toBe(formatMoney(123400, formattingFor(CLUB_US, null)));
  });

  it("keeps yen whole", () => {
    // Yen has no minor units, so 1234 minor units IS ¥1,234 — this was
    // already right and must stay right through the locale change.
    const s = formatMoney(1234, formattingFor(CLUB_JP, null));
    expect(s).toContain("1,234");
    expect(s).not.toContain(".00");
  });

  it("prices in the tournament's currency while writing it the club's way", () => {
    /**
     * The combination the two-field override exists for, and the one a single
     * flag could not express: a German club's dollar-priced invitational is
     * written with German grouping and an American currency.
     */
    const f = formattingFor(CLUB_DE, { currencyOverride: "USD" });
    const s = formatMoney(123400, f);
    expect(f.currency).toBe("USD");
    expect(f.locale).toBe("de-DE");
    // German grouping: a dot for thousands, a comma for the decimal.
    expect(s).toContain("1.234,00");
  });
});

/**
 * MONEY IS NEVER CONVERTED, ONLY WRITTEN DOWN.
 *
 * A tournament's currency says what its players pay in and settle in. The app
 * applies no exchange rate and holds none to apply — the same line CLAUDE.md
 * draws when it says this app calculates and records money and never moves it.
 *
 * Asserted rather than assumed, because a currency override is exactly the
 * feature that invites somebody to add "helpfully" converting an amount when
 * the setting changes. The stored number is minor units and must come back
 * unchanged whatever it is labelled as.
 */
describe("changing the currency relabels an amount, it never converts one", () => {
  it("writes the same stored number in every currency", () => {
    /**
     * 123400 minor units. In a two-decimal currency that is 1,234.00; in yen,
     * which has none, it is 123,400. Both are the SAME stored integer read
     * under different rules, which is the whole point — a converted amount
     * would show roughly 1,234 worth of yen, about 190,000, and does not.
     */
    const usd = formatMoney(123400, { locale: "en-US", currency: "USD" });
    const jpy = formatMoney(123400, { locale: "ja-JP", currency: "JPY" });
    expect(usd).toContain("1,234.00");
    expect(jpy).toContain("123,400");
    // The digits of the stored number survive in both, which a conversion
    // could not manage.
    expect(jpy.replace(/[^\d]/g, "")).toBe("123400");
    expect(usd.replace(/[^\d]/g, "")).toBe("123400");
  });

  it("is the same number back again when the label changes twice", () => {
    // USD -> JPY -> USD. A conversion anywhere in that round trip would not
    // land on the number it started from.
    const start = 99999;
    const asJpy = formatMoney(start, { locale: "en-US", currency: "JPY" });
    const asUsd = formatMoney(start, { locale: "en-US", currency: "USD" });
    expect(asJpy.replace(/[^\d]/g, "")).toBe(String(start));
    expect(asUsd.replace(/[^\d]/g, "")).toBe(String(start));
  });
});

/**
 * A GROUP TRAVELLING KEEPS ITS OWN MONEY AND ITS OWN DATES.
 *
 * The case this whole feature is for, in the words it was described in: an
 * American society goes on an outing to Japan. They play a Japanese course,
 * and they still want their buy-ins in dollars and their dates written the
 * American way — because the people settling up are Americans, wherever the
 * golf is.
 *
 * IT NEEDS NO OVERRIDE, and that is the point of these tests. Locale and
 * currency follow the ORGANIZATION — the society itself — and nothing in the
 * resolution chain consults the course, the venue, or where either of them is.
 * A US society's tournament is in dollars on a Japanese course by default, and
 * it would take somebody deliberately setting the override to change that.
 *
 * Asserted rather than assumed, because "the venue does not decide" is the
 * kind of rule that is true until a later change helpfully derives a currency
 * from a course's country. There is no course-scoped currency anywhere in the
 * app today — checked 2026-09-14 — and this is what would notice one arriving.
 */
describe("a group on an outing abroad", () => {
  /** The society: American, and the only thing with an opinion here. */
  const US_SOCIETY = { locale: "en-US", currency: "USD" };

  it("keeps its own currency and date format with no override set", () => {
    const f = formattingFor(US_SOCIETY, { localeOverride: "", currencyOverride: "" });
    expect(f.currency, "the society settles in its own money").toBe("USD");
    expect(f.locale, "and writes its own dates").toBe("en-US");
    expect(formatMoney(123400, f)).toBe("$1,234.00");
    // Month first, as the members read it.
    const d = formatDay("2026-05-14", f.locale);
    expect(d.indexOf("May")).toBeLessThan(d.indexOf("14"));
  });

  it("takes nothing from the course it happens to be playing", () => {
    /**
     * `formattingFor` accepts an organization and an event. There is no third
     * argument, and that is the guarantee: a course cannot reach this function
     * to have an opinion about the money, however Japanese it is.
     */
    expect(formattingFor.length, "a third source of truth appeared").toBe(2);
  });

  it("can still choose the other way round, if the group would rather", () => {
    // The override in the other direction: settling in yen because that is
    // what everyone is carrying, while still writing dates the American way.
    const f = formattingFor(US_SOCIETY, { localeOverride: "", currencyOverride: "JPY" });
    expect(f.currency).toBe("JPY");
    expect(f.locale).toBe("en-US");
    // Yen has no minor unit, so a 1,234 buy-in is 1,234 — not 12.34.
    expect(formatMoney(1234, f)).toContain("1,234");
  });
});
