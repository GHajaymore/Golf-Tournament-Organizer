import { describe, it, expect } from "vitest";
import { DATE_WORD_TAGS, dateWordsFor, fieldsAt, fieldsOfDay, writeDate, writeDayRange, type DateFields, type DateWords } from "../date-words";
import { DATE_WORDS } from "../date-words.data";

/**
 * Survivors of the Stryker run on `date-words.ts` (J49). The module is a
 * formatter over a table, so the table here is one of our own with a distinct
 * word for every month, day and half of the day: a field read from the wrong
 * place, or the wrong index, shows as the wrong word. Every expectation is
 * worked by hand (May 14 2026 is a Thursday: 133 days after Thursday Jan 1),
 * never from the code's output. Zones are named, so the platform's own zone
 * does not matter. Invented data only.
 */

const WORDS: DateWords = {
  months: Array.from({ length: 12 }, (_, i) => `M${i + 1}`),
  monthsLong: Array.from({ length: 12 }, (_, i) => `L${i + 1}`),
  days: Array.from({ length: 7 }, (_, i) => `D${i}`),
  daysLong: Array.from({ length: 7 }, (_, i) => `LD${i}`),
  am: "AM",
  pm: "PM",
  hour12: true,
  day: "day",
  monthDay: "monthDay",
  weekdayDay: "weekdayDay",
  stamp: "stamp",
  time: "time",
  wall: "wall",
  rangeInMonth: "inMonth",
  rangeInYear: "inYear",
  rangeAcross: "across",
};

const f = (o: Partial<DateFields> = {}): DateFields => ({ year: 2026, month: 5, day: 7, weekday: 4, hour: 13, minute: 5, ...o });
const say = (template: string, at: DateFields = f()) => writeDate({ ...WORDS, day: template }, "day", at);

describe("each field of a template", () => {
  it("writes year, month and day in figures", () => {
    expect(say("{y}")).toBe("2026");
    expect(say("{n}")).toBe("5");
    expect(say("{nn}")).toBe("05");
    expect(say("{d}")).toBe("7");
    expect(say("{dd}")).toBe("07");
    expect(say("{n}", f({ month: 12 }))).toBe("12");
    expect(say("{nn}", f({ month: 12 }))).toBe("12");
    expect(say("{dd}", f({ day: 31 }))).toBe("31");
  });
  it("takes month and day names by their number, January first and Sunday first", () => {
    expect(say("{b}")).toBe("M5");
    expect(say("{B}")).toBe("L5");
    expect(say("{b}", f({ month: 1 }))).toBe("M1");
    expect(say("{B}", f({ month: 12 }))).toBe("L12");
    expect(say("{a}")).toBe("D4");
    expect(say("{A}")).toBe("LD4");
    expect(say("{a}", f({ weekday: 0 }))).toBe("D0");
    expect(say("{A}", f({ weekday: 6 }))).toBe("LD6");
  });
  it("writes the 12-hour clock: midnight is 12, noon is 12, one in the afternoon is 1", () => {
    expect(say("{h}", f({ hour: 0 }))).toBe("12");
    expect(say("{hh}", f({ hour: 0 }))).toBe("12");
    expect(say("{h}", f({ hour: 12 }))).toBe("12");
    expect(say("{hh}", f({ hour: 12 }))).toBe("12");
    expect(say("{h}", f({ hour: 13 }))).toBe("1");
    expect(say("{hh}", f({ hour: 13 }))).toBe("01");
    expect(say("{h}", f({ hour: 23 }))).toBe("11");
    expect(say("{hh}", f({ hour: 9 }))).toBe("09");
    expect(say("{h}", f({ hour: 9 }))).toBe("9");
    expect(say("{hh}", f({ hour: 11 }))).toBe("11");
  });
  it("writes the 24-hour clock", () => {
    expect(say("{H}", f({ hour: 0 }))).toBe("0");
    expect(say("{HH}", f({ hour: 0 }))).toBe("00");
    expect(say("{H}", f({ hour: 9 }))).toBe("9");
    expect(say("{HH}", f({ hour: 9 }))).toBe("09");
    expect(say("{H}", f({ hour: 23 }))).toBe("23");
    expect(say("{HH}", f({ hour: 23 }))).toBe("23");
  });
  it("pads the minute to two figures", () => {
    expect(say("{mm}", f({ minute: 5 }))).toBe("05");
    expect(say("{mm}", f({ minute: 0 }))).toBe("00");
    expect(say("{mm}", f({ minute: 59 }))).toBe("59");
  });
  it("says the half of the day: before noon is AM, noon and after is PM", () => {
    expect(say("{p}", f({ hour: 0 }))).toBe("AM");
    expect(say("{p}", f({ hour: 11 }))).toBe("AM");
    expect(say("{p}", f({ hour: 12 }))).toBe("PM");
    expect(say("{p}", f({ hour: 23 }))).toBe("PM");
  });
  it("leaves a field it does not know in braces, in the text", () => {
    expect(say("x{zz}y")).toBe("x{zz}y");
    expect(say("{ym}")).toBe("{ym}");
  });
  it("replaces every field, and keeps the text around them", () => {
    expect(say("{A} {d} {B} {y}, {H}:{mm} {d}")).toBe("LD4 7 L5 2026, 13:05 7");
  });
  it("does not read braces that are not a field", () => {
    expect(say("{d12}")).toBe("{d12}");
    expect(say("{1}")).toBe("{1}");
    expect(say("{ d }")).toBe("{ d }");
    expect(say("{}")).toBe("{}");
    expect(say("d}")).toBe("d}");
  });
  it("a single moment reads the same for the 1 and the 2 end: both are the one moment", () => {
    expect(say("{d1}-{d2}")).toBe("7-7");
  });
});

describe("writeDate", () => {
  const w: DateWords = { ...WORDS, day: "D:{d}", monthDay: "MD:{d}", weekdayDay: "WD:{d}", stamp: "S:{d}", time: "T:{d}", wall: "W:{d}" };
  it("picks the template of the shape asked", () => {
    expect(writeDate(w, "day", f())).toBe("D:7");
    expect(writeDate(w, "monthDay", f())).toBe("MD:7");
    expect(writeDate(w, "weekdayDay", f())).toBe("WD:7");
    expect(writeDate(w, "stamp", f())).toBe("S:7");
    expect(writeDate(w, "time", f())).toBe("T:7");
    expect(writeDate(w, "wall", f())).toBe("W:7");
  });
});

describe("writeDayRange", () => {
  const w: DateWords = { ...WORDS, day: "one:{d}/{n}/{y}", rangeInMonth: "in:{d1}-{d2}.{n1}.{y1}", rangeInYear: "yr:{d1}.{n1}-{d2}.{n2}.{y1}", rangeAcross: "x:{d1}.{n1}.{y1}-{d2}.{n2}.{y2}" };
  const d = (year: number, month: number, day: number) => f({ year, month, day });
  it("the same day twice is that one day", () => {
    expect(writeDayRange(w, d(2026, 5, 14), d(2026, 5, 14))).toBe("one:14/5/2026");
  });
  it("two days in one month use the in-month template, each end from its own day", () => {
    expect(writeDayRange(w, d(2026, 5, 14), d(2026, 5, 16))).toBe("in:14-16.5.2026");
  });
  it("two months of one year use the in-year template", () => {
    expect(writeDayRange(w, d(2026, 5, 30), d(2026, 6, 2))).toBe("yr:30.5-2.6.2026");
  });
  it("the same day-of-month in another month is a range, not one day", () => {
    expect(writeDayRange(w, d(2026, 5, 14), d(2026, 6, 14))).toBe("yr:14.5-14.6.2026");
  });
  it("two years use the across template", () => {
    expect(writeDayRange(w, d(2026, 12, 30), d(2027, 1, 2))).toBe("x:30.12.2026-2.1.2027");
  });
  it("the same day and month in another year is a range, not one day", () => {
    expect(writeDayRange(w, d(2026, 5, 14), d(2027, 5, 14))).toBe("x:14.5.2026-14.5.2027");
  });
  it("a different year with a different month is still across", () => {
    expect(writeDayRange(w, d(2026, 5, 14), d(2027, 6, 14))).toBe("x:14.5.2026-14.6.2027");
  });
});

describe("dateWordsFor", () => {
  it("gives null for nothing, for blank, and for a bare language", () => {
    expect(dateWordsFor(null)).toBeNull();
    expect(dateWordsFor(undefined)).toBeNull();
    expect(dateWordsFor("")).toBeNull();
    expect(dateWordsFor("   ")).toBeNull();
    expect(dateWordsFor("en")).toBeNull();
    expect(dateWordsFor("xx-XX")).toBeNull();
  });
  it("finds a tag whatever its case or the spaces around it", () => {
    const gb = DATE_WORDS["en-GB" as keyof typeof DATE_WORDS];
    expect(dateWordsFor("en-GB")).toBe(gb);
    expect(dateWordsFor("EN-gb")).toBe(gb);
    expect(dateWordsFor("  en-gb  ")).toBe(gb);
  });
  it("holds every tag of the table, and every tag finds its own line", () => {
    expect([...DATE_WORD_TAGS]).toEqual(Object.keys(DATE_WORDS));
    expect(DATE_WORD_TAGS.length).toBeGreaterThan(0);
    for (const tag of DATE_WORD_TAGS) expect(dateWordsFor(tag)).toBe(DATE_WORDS[tag as keyof typeof DATE_WORDS]);
  });
  it("the British club reads a weekday and day without a comma", () => {
    const gb = dateWordsFor("en-GB")!;
    expect(writeDate(gb, "weekdayDay", f({ year: 2026, month: 5, day: 14, weekday: 4 }))).toBe("Thu 14 May");
  });
});

describe("fieldsOfDay", () => {
  it("reads a day as figures at noon, with its weekday", () => {
    expect(fieldsOfDay("2026-05-14")).toEqual({ year: 2026, month: 5, day: 14, weekday: 4, hour: 12, minute: 0 });
  });
  it("finds the weekday at the ends of the year", () => {
    expect(fieldsOfDay("2026-01-01")?.weekday).toBe(4); // Thursday
    expect(fieldsOfDay("2026-12-31")?.weekday).toBe(4); // Thursday
    expect(fieldsOfDay("2026-01-31")).toMatchObject({ month: 1, day: 31, weekday: 6 }); // Saturday
    expect(fieldsOfDay("2026-05-10")?.weekday).toBe(0); // Sunday
    expect(fieldsOfDay("2026-05-16")?.weekday).toBe(6); // Saturday
  });
  it("accepts spaces around it", () => {
    expect(fieldsOfDay("  2026-05-14  ")?.day).toBe(14);
  });
  it("allows the 29th of February only in a leap year", () => {
    expect(fieldsOfDay("2024-02-29")).toMatchObject({ month: 2, day: 29, weekday: 4 }); // Thursday
    expect(fieldsOfDay("2026-02-29")).toBeNull();
    expect(fieldsOfDay("2026-02-28")).toMatchObject({ month: 2, day: 28 });
  });
  it("refuses a day the month does not have", () => {
    expect(fieldsOfDay("2026-02-31")).toBeNull();
    expect(fieldsOfDay("2026-04-31")).toBeNull();
    expect(fieldsOfDay("2026-04-30")).toMatchObject({ month: 4, day: 30 });
    expect(fieldsOfDay("2026-05-32")).toBeNull();
  });
  it("refuses a month that is not one", () => {
    expect(fieldsOfDay("2026-13-01")).toBeNull();
    expect(fieldsOfDay("2026-00-10")).toBeNull();
    expect(fieldsOfDay("2026-12-01")).toMatchObject({ month: 12, day: 1 });
  });
  it("refuses day zero", () => {
    expect(fieldsOfDay("2026-05-00")).toBeNull();
  });
  it("refuses anything that is not exactly four, two and two figures", () => {
    expect(fieldsOfDay("2026-5-14")).toBeNull();
    expect(fieldsOfDay("2026-05-4")).toBeNull();
    expect(fieldsOfDay("26-05-14")).toBeNull();
    expect(fieldsOfDay("x2026-05-14")).toBeNull();
    expect(fieldsOfDay("2026-05-14x")).toBeNull();
    expect(fieldsOfDay("2026-05-14T00:00")).toBeNull();
    expect(fieldsOfDay("2026/05/14")).toBeNull();
    expect(fieldsOfDay("12026-05-14")).toBeNull();
    expect(fieldsOfDay("2026-05-143")).toBeNull();
    expect(fieldsOfDay("")).toBeNull();
    expect(fieldsOfDay(null as unknown as string)).toBeNull();
    expect(fieldsOfDay(undefined as unknown as string)).toBeNull();
  });
});

describe("fieldsAt", () => {
  const at = new Date(Date.UTC(2026, 4, 14, 13, 5)); // Thu 14 May 2026, 13:05 UTC
  it("refuses a date that is not one, in every kind of zone", () => {
    const bad = new Date(NaN);
    expect(fieldsAt(bad)).toBeNull();
    expect(fieldsAt(bad, "UTC")).toBeNull();
    expect(fieldsAt(bad, "Pacific/Auckland")).toBeNull();
  });
  it("reads UTC straight off the instant", () => {
    expect(fieldsAt(at, "UTC")).toEqual({ year: 2026, month: 5, day: 14, weekday: 4, hour: 13, minute: 5 });
    expect(fieldsAt(new Date(Date.UTC(2026, 11, 31, 0, 0)), "UTC")).toEqual({ year: 2026, month: 12, day: 31, weekday: 4, hour: 0, minute: 0 });
  });
  it("with no zone reads the device's own clock", () => {
    const local = new Date(2026, 4, 14, 13, 5);
    expect(fieldsAt(local)).toEqual({ year: 2026, month: 5, day: 14, weekday: 4, hour: 13, minute: 5 });
    expect(fieldsAt(local, "")).toEqual({ year: 2026, month: 5, day: 14, weekday: 4, hour: 13, minute: 5 });
    expect(fieldsAt(new Date(2026, 11, 31, 23, 59))).toEqual({ year: 2026, month: 12, day: 31, weekday: 4, hour: 23, minute: 59 });
  });
  it("reads a named zone: Auckland (UTC+12 in May) is already Friday morning", () => {
    expect(fieldsAt(at, "Pacific/Auckland")).toEqual({ year: 2026, month: 5, day: 15, weekday: 5, hour: 1, minute: 5 });
  });
  it("reads a zone behind UTC: Los Angeles (UTC-7 in May) is still Thursday morning", () => {
    expect(fieldsAt(at, "America/Los_Angeles")).toEqual({ year: 2026, month: 5, day: 14, weekday: 4, hour: 6, minute: 5 });
  });
  it("reads a half-hour zone: Kolkata is UTC+5:30", () => {
    expect(fieldsAt(at, "Asia/Kolkata")).toEqual({ year: 2026, month: 5, day: 14, weekday: 4, hour: 18, minute: 35 });
  });
  it("writes midnight as 0, never 24", () => {
    expect(fieldsAt(new Date(Date.UTC(2026, 4, 14, 12, 0)), "Pacific/Auckland")).toMatchObject({ day: 15, hour: 0, minute: 0 });
    expect(fieldsAt(new Date(Date.UTC(2026, 4, 14, 7, 0)), "America/Los_Angeles")).toMatchObject({ day: 14, hour: 0, minute: 0 });
  });
  it("carries the year over: New Year's morning in Auckland (UTC+13 in December)", () => {
    expect(fieldsAt(new Date(Date.UTC(2026, 11, 31, 20, 0)), "Pacific/Auckland")).toEqual({ year: 2027, month: 1, day: 1, weekday: 5, hour: 9, minute: 0 });
  });
  it("takes the weekday from the zone's day, not from the instant's", () => {
    // 23:30 UTC on Saturday 16 May is Sunday 17 May 11:30 in Auckland.
    expect(fieldsAt(new Date(Date.UTC(2026, 4, 16, 23, 30)), "Pacific/Auckland")).toMatchObject({ day: 17, weekday: 0, hour: 11, minute: 30 });
  });
  it("gives null for a zone the platform refuses", () => {
    expect(fieldsAt(at, "Not/AZone")).toBeNull();
  });
});
