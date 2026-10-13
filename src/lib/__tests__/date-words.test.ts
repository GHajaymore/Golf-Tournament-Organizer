import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { DATE_WORD_TAGS, dateWordsFor, fieldsAt, fieldsOfDay, writeDate, writeDayRange, type DateShape } from "@/lib/domain/date-words";
import { LOCALES, formatClock, formatDay, formatDayAt, formatDayRange, formatMonthDayAt, usesTwentyFourHourClock } from "@/lib/domain/locale";
import { shortDate } from "@/lib/domain/round-dates";
import { clubClockInWords } from "@/lib/domain/club-clock";
import { readSource } from "./source";

/**
 * THE APP WRITES ITS OWN DATES, AND THIS IS WHAT IT WRITES.
 *
 * A screen is drawn by the server and again by the browser, and each used to
 * ask its own platform to word a date. Two platforms carry two editions of the
 * conventions, and where they part the page is thrown away and drawn twice
 * (#418). Since 2026-10-13 the conventions are a table in the repository
 * (`date-words.data.ts`, written by `scripts/build-date-words.mjs`) and the
 * app fills it in itself, so both sides write the same bytes by running the
 * same lines.
 *
 * Three things are held here.
 *
 *  - WHAT IS WRITTEN, for every language the picker offers, as values typed by
 *    hand from how that country writes a date — not copied out of the table,
 *    and not asked of this machine's platform, which is the thing that varies.
 *  - THAT IT IS COMPLETE: every tag a club can pick, and every place the
 *    seeded club can be put, has a line; no line leaves a field unfilled on
 *    any day of a year.
 *  - THAT NOTHING GOES ROUND IT: no screen words a date by asking the
 *    platform. (That each caller really READS the table, and does not merely
 *    agree with it on this machine, is `date-words-are-read.test.ts`.)
 *
 * What it cannot see: a browser. `e2e/formats-agree.spec.ts` runs the same
 * functions on both sides, on Chromium in every round and on Firefox and
 * Safari's engine in the layers that drive them.
 *
 * No letter of another script is typed in this file: each is a code point, so
 * nothing can re-encode one on the way in.
 */
const ch = (...codes: number[]) => String.fromCharCode(...codes);
const DASH = ch(0x2013);
// Japanese and Chinese: year, month, day, and the wave dash Japanese marks a range with.
const [NEN, GATSU, NICHI, WAVE] = [ch(0x5e74), ch(0x6708), ch(0x65e5), ch(0xff5e)];
// Korean: year, month, day.
const [NYEON, WOL, IL] = [ch(0xb144), ch(0xc6d4), ch(0xc77c)];

const DAY = "2026-05-14"; // a Thursday
const AFTER_NOON = new Date("2026-05-14T13:05:00Z");
const BEFORE_NOON = new Date("2026-05-14T01:05:00Z");
const STAMP = { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" } as const;
const TIME = { hour: "numeric", minute: "2-digit", timeZone: "UTC" } as const;

describe("what each country's club reads", () => {
  it("a day, a day with its weekday, and a day in a thread", () => {
    const written = Object.fromEntries(LOCALES.map(({ tag }) => [tag, [formatDay(DAY, tag), shortDate(DAY as never, tag), formatMonthDayAt(AFTER_NOON, tag, "UTC")]]));
    expect(written).toEqual({
      "en-US": ["May 14, 2026", "Thu, May 14", "May 14"],
      // No comma after a British weekday: the one Safari's engine wrote differently.
      "en-GB": ["14 May 2026", "Thu 14 May", "14 May"],
      "en-AU": ["14 May 2026", "Thu, 14 May", "14 May"],
      "en-IN": ["14 May 2026", "Thu, 14 May", "14 May"],
      "ja-JP": [`2026${NEN}5${GATSU}14${NICHI}`, `5${GATSU}14${NICHI}(${ch(0x6728)})`, `5${GATSU}14${NICHI}`],
      "ko-KR": [`2026${NYEON} 5${WOL} 14${IL}`, `5${WOL} 14${IL} (${ch(0xbaa9)})`, `5${WOL} 14${IL}`],
      "zh-CN": [`2026${NEN}5${GATSU}14${NICHI}`, `5${GATSU}14${NICHI}${ch(0x5468, 0x56db)}`, `5${GATSU}14${NICHI}`],
      "de-DE": ["14. Mai 2026", "Do., 14. Mai", "14. Mai"],
      "fr-FR": ["14 mai 2026", "jeu. 14 mai", "14 mai"],
      "es-ES": ["14 may 2026", "jue, 14 may", "14 may"],
    });
  });

  it("a span of days inside a month, across two, and across a year", () => {
    const spans = (tag: string) => [formatDayRange("2026-05-14", "2026-05-16", tag), formatDayRange("2026-05-30", "2026-06-02", tag), formatDayRange("2026-12-30", "2027-01-02", tag)];
    expect(spans("en-US")).toEqual([`May 14${DASH}16, 2026`, `May 30 ${DASH} Jun 2, 2026`, `Dec 30, 2026 ${DASH} Jan 2, 2027`]);
    expect(spans("en-GB")).toEqual([`14${DASH}16 May 2026`, `30 May ${DASH} 2 Jun 2026`, `30 Dec 2026${DASH}2 Jan 2027`]);
    expect(spans("de-DE")).toEqual([`14.${DASH}16. Mai 2026`, `30. Mai ${DASH} 2. Juni 2026`, `30. Dez. 2026${DASH}2. Jan. 2027`]);
    expect(spans("fr-FR")[0]).toBe(`14${DASH}16 mai 2026`);
    expect(spans("ko-KR")[0]).toBe(`2026${NYEON} 5${WOL} 14${IL} ~ 16${IL}`);
    // The same day twice is one day, and half a range is the half there is.
    expect(formatDayRange(DAY, DAY, "en-GB")).toBe("14 May 2026");
    expect(formatDayRange("", DAY, "en-GB")).toBe("14 May 2026");
  });

  it("a Japanese and a Chinese span is written in the words of a day, not in bare figures", () => {
    /**
     * The platform this table was read from writes one day with the characters
     * for year, month and day, and a SPAN of them as 2026/05/14 to 2026/05/16
     * in figures and slashes, because its data holds no span for a short month
     * in these languages. Firefox, whose data does, writes it in words — and
     * so the two sides differed. The words are the form settled on.
     */
    const day = (y: number, m: number, d: number) => `${y}${NEN}${m}${GATSU}${d}${NICHI}`;
    expect(formatDayRange("2026-05-14", "2026-05-16", "ja-JP")).toBe(`${day(2026, 5, 14)}${WAVE}16${NICHI}`);
    expect(formatDayRange("2026-05-30", "2026-06-02", "ja-JP")).toBe(`${day(2026, 5, 30)}${WAVE}6${GATSU}2${NICHI}`);
    expect(formatDayRange("2026-12-30", "2027-01-02", "ja-JP")).toBe(`${day(2026, 12, 30)}${WAVE}${day(2027, 1, 2)}`);
    expect(formatDayRange("2026-05-14", "2026-05-16", "zh-CN")).toBe(`${day(2026, 5, 14)}${DASH}16${NICHI}`);
    expect(formatDayRange("2026-12-30", "2027-01-02", "zh-CN")).toBe(`${day(2026, 12, 30)}${DASH}${day(2027, 1, 2)}`);
    for (const tag of ["ja-JP", "zh-CN"]) expect(formatDayRange("2026-05-14", "2026-05-16", tag), tag).not.toContain("/");
  });

  it("a time, and a day with its time — the hour before ten is the one Firefox padded", () => {
    const clock = (tag: string) => [formatClock(BEFORE_NOON, tag, TIME), formatClock(AFTER_NOON, tag, TIME), formatClock(BEFORE_NOON, tag, STAMP)];
    expect(clock("en-US")).toEqual(["1:05 AM", "1:05 PM", "May 14, 01:05 AM"]);
    expect(clock("en-GB")).toEqual(["1:05", "13:05", "14 May, 01:05"]);
    expect(clock("en-AU")).toEqual(["1:05 am", "1:05 pm", "14 May, 01:05 am"]);
    expect(clock("de-DE")).toEqual(["1:05", "13:05", "14. Mai, 01:05"]);
    expect(clock("fr-FR")).toEqual(["1:05", "13:05", "14 mai, 01:05"]);
    expect(clock("zh-CN")).toEqual(["1:05", "13:05", `5${GATSU}14${NICHI} 01:05`]);
    expect(clock("ja-JP")).toEqual(["1:05", "13:05", `5${GATSU}14${NICHI} 01:05`]);
    // Midnight and noon on a twelve-hour clock are twelve, never nought.
    expect(formatClock(new Date("2026-05-14T00:00:00Z"), "en-US", TIME)).toBe("12:00 AM");
    expect(formatClock(new Date("2026-05-14T12:00:00Z"), "en-US", TIME)).toBe("12:00 PM");
    expect(formatClock(new Date("2026-05-14T00:00:00Z"), "en-GB", TIME)).toBe("0:00");
  });

  it("the clock on the club's wall, in the club's own zone", () => {
    // 13:05 UTC is 14:05 in Edinburgh in May and 09:05 in Indianapolis.
    expect(clubClockInWords("Europe/London", "en-GB", AFTER_NOON)).toBe("Thursday 14 May at 14:05");
    expect(clubClockInWords("America/Indiana/Indianapolis", "en-US", AFTER_NOON)).toBe("Thursday, May 14 at 09:05 AM");
    expect(clubClockInWords("Europe/Berlin", "de-DE", AFTER_NOON)).toBe("Donnerstag, 14. Mai um 15:05");
    // Half past eleven at night in Sydney is already Friday there.
    expect(clubClockInWords("Australia/Sydney", "en-AU", AFTER_NOON)).toBe("Thursday 14 May at 11:05 pm");
    expect(clubClockInWords("Australia/Sydney", "en-AU", new Date("2026-05-14T14:30:00Z"))).toBe("Friday 15 May at 12:30 am");
    expect(clubClockInWords("", "en-GB", AFTER_NOON)).toBe("");
  });

  it("which clock a tee sheet runs on comes from the same table", () => {
    const twentyFour = LOCALES.filter(({ tag }) => usesTwentyFourHourClock(tag)).map(({ tag }) => tag);
    expect(twentyFour).toEqual(["en-GB", "ja-JP", "zh-CN", "de-DE", "fr-FR", "es-ES"]);
  });
});

describe("the table is complete", () => {
  it("CONTROL: the table is found, and a tag is looked up whatever its capitals", () => {
    expect(DATE_WORD_TAGS.length).toBeGreaterThanOrEqual(14);
    expect(dateWordsFor("en-gb")).toBe(dateWordsFor("en-GB"));
    expect(dateWordsFor(" en-GB ")).toBe(dateWordsFor("en-GB"));
    // A language is not a place: Britain's line is not handed to "en", nor America's to "en-XX".
    expect(dateWordsFor("en")).toBeNull();
    expect(dateWordsFor("en-XX")).toBeNull();
    expect(dateWordsFor(undefined)).toBeNull();
  });

  it("every language the picker offers has a line", () => {
    for (const { tag } of LOCALES) expect(DATE_WORD_TAGS, `${tag} is offered and the app cannot write its dates itself`).toContain(tag);
  });

  it("every place the seeded club can be put has a line — the walks abroad are drawn from it", () => {
    const seed = readSource("scripts/seed-club.mjs");
    const tags = [...seed.matchAll(/locale: "([a-z]{2}-[A-Z]{2})"/g)].map((m) => m[1]);
    expect(tags.length, "the seed's places were not found").toBeGreaterThanOrEqual(5);
    for (const tag of new Set(tags)) expect(DATE_WORD_TAGS, `the seeded club can be put in ${tag}`).toContain(tag);
  });

  it("no line leaves a field unfilled, on any day of a year or at any hour", () => {
    const shapes: DateShape[] = ["day", "monthDay", "weekdayDay", "stamp", "time", "wall"];
    for (const tag of DATE_WORD_TAGS) {
      const words = dateWordsFor(tag)!;
      expect(words.months.length).toBe(12);
      expect(words.monthsLong.length).toBe(12);
      expect(words.days.length).toBe(7);
      expect(words.daysLong.length).toBe(7);
      const written: string[] = [];
      for (let i = 0; i < 365; i++) {
        const at = new Date(Date.UTC(2026, 0, 1 + i, i % 24, 5));
        const fields = fieldsAt(at, "UTC")!;
        for (const shape of shapes) written.push(writeDate(words, shape, fields));
        const later = fieldsAt(new Date(at.getTime() + (1 + (i % 400)) * 86_400_000), "UTC")!;
        written.push(writeDayRange(words, fields, later));
      }
      const bad = written.filter((s) => !s || /[{}]|undefined|NaN/.test(s));
      expect(bad.slice(0, 3), `${tag} wrote something unfinished`).toEqual([]);
      // A language either names both halves of the day or runs its clock to 24.
      expect(Boolean(words.am && words.pm)).toBe(words.hour12);
    }
  });

  it("a day is a day: the 31st of February is refused, and a zone moves an instant but never a day", () => {
    expect(fieldsOfDay("2026-02-31")).toBeNull();
    expect(fieldsOfDay("14 May")).toBeNull();
    expect(fieldsOfDay("2028-02-29")).toMatchObject({ year: 2028, month: 2, day: 29, weekday: 2 });
    // 23:30 UTC on the 14th is the 15th in Tokyo and still the 14th in New York.
    const late = new Date("2026-05-14T23:30:00Z");
    expect(fieldsAt(late, "Asia/Tokyo")).toMatchObject({ day: 15, hour: 8, minute: 30, weekday: 5 });
    expect(fieldsAt(late, "America/New_York")).toMatchObject({ day: 14, hour: 19, minute: 30, weekday: 4 });
    // Midnight is nought on a 24-hour clock, in a zone as well as in UTC.
    expect(fieldsAt(new Date("2026-05-14T15:00:00Z"), "Asia/Tokyo")).toMatchObject({ day: 15, hour: 0 });
    expect(fieldsAt(new Date("not a date"), "UTC")).toBeNull();
    expect(fieldsAt(late, "Not/A_Zone")).toBeNull();
  });

  it("a tag the table does not hold is still written — by the platform, as before", () => {
    // Swedish is not offered and has no line. A club holding it must still read a date.
    expect(dateWordsFor("sv-SE")).toBeNull();
    expect(formatDay(DAY, "sv-SE")).toMatch(/14.*2026|2026.*14/);
    expect(formatDayRange("2026-05-14", "2026-05-16", "sv-SE")).toMatch(/14.*16/);
    expect(shortDate(DAY as never, "sv-SE")).toMatch(/14/);
    expect(formatDayAt(AFTER_NOON, "sv-SE", "UTC")).toMatch(/14/);
    expect(formatClock(AFTER_NOON, "sv-SE", TIME)).toMatch(/13[:.]05/);
    // And what is not a date comes back as it was handed in.
    expect(formatDay("soon", "en-GB")).toBe("soon");
    expect(formatDay("2026-02-31", "en-GB")).toBe("2026-02-31");
  });
});

describe("no screen words a date by asking the platform", () => {
  /**
   * The table is only the answer while everything goes through it. These are
   * the only files that may hand the platform a date to word, and why:
   */
  const MAY_ASK: Record<string, string> = {
    "src/lib/domain/locale.ts": "the owner: the platform is its answer for a tag the table does not hold",
    "src/lib/domain/round-dates.ts": "shortDate's answer for a tag the table does not hold",
    "src/lib/domain/club-clock.ts": "the club's day and time read back as FIGURES; and the wall clock for a tag the table does not hold",
    "src/lib/domain/date-words.ts": "an instant's day and time in a zone, read back as figures",
    "src/app/owner/page.tsx": "the owner's own page: a server component, drawn once, never by a browser",
  };
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name !== "__tests__") walk(p, out);
      } else if (/\.(ts|tsx)$/.test(name)) out.push(p.split("\\").join("/"));
    }
    return out;
  };
  const files = walk("src");
  // `Intl.DateTimeFormat()` with nothing in the brackets asks the device which ZONE it is in. That is not wording a date.
  const asks = (code: string) => /new Intl\.DateTimeFormat\(\s*[^)\s]/.test(code) || /\.toLocaleDateString\(/.test(code) || /\.formatRange\(/.test(code);

  it("CONTROL: the sweep reads the source, sees the asking it is looking for, and lets the device's zone through", () => {
    expect(files.length).toBeGreaterThan(400);
    expect(asks('const s = new Intl.DateTimeFormat(locale, { month: "short" }).format(d);')).toBe(true);
    expect(asks('const s = d.toLocaleDateString(locale);')).toBe(true);
    expect(asks("zone = Intl.DateTimeFormat().resolvedOptions().timeZone;")).toBe(false);
    for (const file of Object.keys(MAY_ASK)) expect(files, `${file} is excused and is not there`).toContain(file);
    // And each excused file really does ask, or its excuse is hiding nothing.
    for (const file of Object.keys(MAY_ASK)) expect(asks(readSource(file)), `${file} no longer asks the platform: take it off the list`).toBe(true);
  });

  it("nothing outside the list does", () => {
    const direct = files.filter((file) => !(file in MAY_ASK) && asks(readSource(file)));
    expect(direct, "word a date with formatDay / formatDayAt / formatMonthDayAt / formatDayRange / formatClock / shortDate, so the server and every browser write the same bytes").toEqual([]);
  });

  it("the one excused screen is never drawn by a browser", () => {
    expect(readSource("src/app/owner/page.tsx")).not.toMatch(/^\s*["']use client["']/m);
  });
});
