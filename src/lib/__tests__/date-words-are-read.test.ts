import { describe, it, expect, vi } from "vitest";

/**
 * EVERY CALLER READS THE TABLE — it does not merely agree with it here.
 *
 * `date-words.test.ts` pins what the app writes. On the machine the table was
 * read from, the platform writes the very same thing — so a caller put back to
 * asking the platform would pass every value in that file, and go on passing
 * until it met a browser with another edition of the conventions. That is the
 * fault this work closes, and a test that cannot tell the two apart would let
 * it straight back in.
 *
 * So here the table is swapped for one NO platform would write: every shape
 * is spelled with bars and a mark. A caller that reads the table writes the
 * bars. A caller that asks the platform writes a real British date, and fails.
 * Each line below was put back to the platform in turn and watched go red.
 */
vi.mock("@/lib/domain/date-words.data", () => {
  const months = ["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9", "m10", "m11", "m12"];
  const days = ["d0", "d1", "d2", "d3", "d4", "d5", "d6"];
  return {
    DATE_WORDS: {
      "en-GB": {
        months,
        monthsLong: months.map((m) => `long-${m}`),
        days,
        daysLong: days.map((d) => `long-${d}`),
        am: "",
        pm: "",
        hour12: false,
        day: "DAY|{d}|{b}|{y}",
        monthDay: "MONTHDAY|{d}|{b}",
        weekdayDay: "WEEKDAY|{a}|{d}|{b}",
        stamp: "STAMP|{d}|{b}|{HH}|{mm}",
        time: "TIME|{H}|{mm}",
        wall: "WALL|{A}|{d}|{B}|{HH}|{mm}",
        rangeInMonth: "IN-MONTH|{d1}|{d2}|{b1}|{y1}",
        rangeInYear: "IN-YEAR|{d1}|{b1}|{d2}|{b2}|{y1}",
        rangeAcross: "ACROSS|{d1}|{b1}|{y1}|{d2}|{b2}|{y2}",
      },
      // Twelve-hour HERE, where every platform says Japan runs to 24: a caller that asks the platform says so.
      "ja-JP": { months, monthsLong: months, days, daysLong: days, am: "a", pm: "p", hour12: true, day: "", monthDay: "", weekdayDay: "", stamp: "", time: "", wall: "", rangeInMonth: "", rangeInYear: "", rangeAcross: "" },
    },
  };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));
vi.mock("@/app/actions/messaging", () => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : async () => ({ ok: true })) }));

const AT = new Date("2026-05-14T13:05:00Z"); // a Thursday

describe("each thing that writes a date fills in the table", () => {
  it("CONTROL: the table in force is the one no platform would write", async () => {
    const { dateWordsFor } = await import("@/lib/domain/date-words");
    expect(dateWordsFor("en-GB")?.day).toBe("DAY|{d}|{b}|{y}");
  });

  it("a day, a day from an instant, and a day in a thread", async () => {
    const { formatDay, formatDayAt, formatMonthDayAt } = await import("@/lib/domain/locale");
    expect(formatDay("2026-05-14", "en-GB")).toBe("DAY|14|m5|2026");
    expect(formatDayAt(AT, "en-GB", "UTC")).toBe("DAY|14|m5|2026");
    expect(formatMonthDayAt(AT, "en-GB", "UTC")).toBe("MONTHDAY|14|m5");
  });

  it("the three kinds of span, each from its own line", async () => {
    const { formatDayRange } = await import("@/lib/domain/locale");
    expect(formatDayRange("2026-05-14", "2026-05-16", "en-GB")).toBe("IN-MONTH|14|16|m5|2026");
    expect(formatDayRange("2026-05-30", "2026-06-02", "en-GB")).toBe("IN-YEAR|30|m5|2|m6|2026");
    expect(formatDayRange("2026-12-30", "2027-01-02", "en-GB")).toBe("ACROSS|30|m12|2026|2|m1|2027");
  });

  it("a time and a stamp, in the zone asked for", async () => {
    const { formatClock } = await import("@/lib/domain/locale");
    expect(formatClock(AT, "en-GB", { hour: "numeric", minute: "2-digit", timeZone: "UTC" })).toBe("TIME|13|05");
    expect(formatClock(AT, "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })).toBe("STAMP|14|m5|13|05");
    // 13:05 UTC is 22:05 in Seoul: the figures come from the zone, the words from the table.
    expect(formatClock(AT, "en-GB", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Seoul" })).toBe("TIME|22|05");
  });

  it("the day on the Rounds screen, and the words for a day a week or more off", async () => {
    const { shortDate, dayInWords } = await import("@/lib/domain/round-dates");
    expect(shortDate("2026-05-14" as never, "en-GB")).toBe("WEEKDAY|d4|14|m5");
    expect(dayInWords("2026-05-14" as never, "2026-05-01" as never, "en-GB")).toBe("WEEKDAY|d4|14|m5");
  });

  it("the clock on the club's wall", async () => {
    const { clubClockInWords } = await import("@/lib/domain/club-clock");
    expect(clubClockInWords("Europe/London", "en-GB", AT)).toBe("WALL|long-d4|14|long-m5|14|05");
  });

  it("which clock the tee sheet runs on", async () => {
    const { usesTwentyFourHourClock } = await import("@/lib/domain/locale");
    expect(usesTwentyFourHourClock("en-GB")).toBe(true);
    expect(usesTwentyFourHourClock("ja-JP")).toBe(false);
  });

  it("a message's date in the thread", async () => {
    const { when } = await import("@/components/MessagesClient");
    // Before the screen has a clock (`now` null) it is the date, pinned to UTC.
    expect(when(AT.getTime(), "en-GB", null)).toContain("MONTHDAY|14|m5");
  });
});
