import { describe, it, expect } from "vitest";
import {
  addDays,
  roundDates,
  weekdayOf,
  shortDate,
  isIsoDate,
  cleanIsoDate,
} from "../round-dates";

/**
 * A league night is a calendar day, not a moment.
 *
 * The bug these tests exist to prevent is subtle and awful: a season generated
 * in spring slipping by a day in autumn because the arithmetic added
 * milliseconds across a daylight saving change. Nobody notices until week
 * fourteen says Monday and forty members turn up on Tuesday.
 */

describe("adding days is calendar arithmetic", () => {
  it("adds a week", () => {
    expect(addDays("2026-05-05", 7)).toBe("2026-05-12");
  });

  it("crosses a month", () => {
    expect(addDays("2026-05-28", 7)).toBe("2026-06-04");
  });

  it("crosses a year", () => {
    expect(addDays("2026-12-29", 7)).toBe("2027-01-05");
  });

  it("handles a leap day", () => {
    expect(addDays("2028-02-22", 7)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
  });

  it("survives the spring daylight-saving change", () => {
    // US DST starts 8 March 2026; the UK's is 29 March. Millisecond
    // arithmetic in a local timezone lands an hour short here and eventually
    // rolls back a day.
    expect(addDays("2026-03-03", 7)).toBe("2026-03-10");
    expect(addDays("2026-03-24", 7)).toBe("2026-03-31");
  });

  it("survives the autumn one", () => {
    expect(addDays("2026-10-27", 7)).toBe("2026-11-03");
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
  });
});

describe("a season keeps its weekday", () => {
  it("stays on Tuesday for twenty weeks across two DST changes", () => {
    const dates = roundDates("2026-03-03", 20, 7);
    expect(dates).toHaveLength(20);
    for (const d of dates) expect(weekdayOf(d), `${d} drifted`).toBe("Tuesday");
  });

  it("numbers the weeks in order with no repeats", () => {
    const dates = roundDates("2026-05-05", 8, 7);
    expect(new Set(dates).size).toBe(8);
    expect(dates[0]).toBe("2026-05-05");
    expect(dates[7]).toBe("2026-06-23");
  });

  it("supports a fortnightly league", () => {
    const dates = roundDates("2026-05-05", 3, 14);
    expect(dates).toEqual(["2026-05-05", "2026-05-19", "2026-06-02"]);
  });

  it("supports consecutive days for a weekend event", () => {
    expect(roundDates("2026-05-16", 2, 1)).toEqual(["2026-05-16", "2026-05-17"]);
  });

  it("treats a zero interval as two rounds on one day, not an error", () => {
    expect(roundDates("2026-05-16", 2, 0)).toEqual(["2026-05-16", "2026-05-16"]);
  });

  it("returns nothing for a count of zero", () => {
    expect(roundDates("2026-05-16", 0, 7)).toEqual([]);
  });
});

describe("validation refuses to guess", () => {
  it("accepts a real date", () => {
    expect(isIsoDate("2026-05-19")).toBe(true);
  });

  it("rejects a day that does not exist", () => {
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("2026-04-31")).toBe(false);
  });

  it("accepts 29 February only in a leap year", () => {
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2027-02-29")).toBe(false);
  });

  it("rejects anything that is not the ISO shape", () => {
    expect(isIsoDate("19/05/2026")).toBe(false);
    expect(isIsoDate("2026-5-9")).toBe(false);
    expect(isIsoDate("")).toBe(false);
  });

  it("cleans to empty rather than to a wrong date", () => {
    expect(cleanIsoDate("nonsense")).toBe("");
    expect(cleanIsoDate(null)).toBe("");
    expect(cleanIsoDate(" 2026-05-19 ")).toBe("2026-05-19");
  });
});

describe("how a date reads", () => {
  it("shows the weekday, because that is what a league is known by", () => {
    expect(shortDate("2026-05-19")).toBe("Tue 19 May");
  });

  it("returns nothing for an unset date rather than 'Invalid Date'", () => {
    expect(shortDate("")).toBe("");
    expect(shortDate("rubbish")).toBe("");
  });
});
