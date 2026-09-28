import { describe, expect, it } from "vitest";
import { monthGrids, weekdayInitials } from "../month-grid";
import { firstDayOfWeek } from "../locale";
import { readSource } from "../../__tests__/source";

/**
 * A CLUB'S CALENDAR WEEK STARTS WHERE ITS MEMBERS' DIARIES DO (2026-09-28).
 *
 * Every month grid started on Sunday, so a British club's calendar read
 * S M T W T F S — reported by the landing session capturing /me/calendar.
 */
describe("which day a week starts on", () => {
  it("Monday in Britain, Ireland, Europe, Australia and China", () => {
    for (const l of ["en-GB", "en-IE", "de-DE", "fr-FR", "es-ES", "en-AU", "zh-CN"]) expect(firstDayOfWeek(l), l).toBe(1);
  });

  it("Sunday in the US, Canada, India, Japan and Korea", () => {
    for (const l of ["en-US", "en-CA", "en-IN", "ja-JP", "ko-KR"]) expect(firstDayOfWeek(l), l).toBe(0);
  });

  it("keeps the old answer for a tag with no region", () => {
    expect(firstDayOfWeek("en")).toBe(0);
  });
});

describe("the grid and its headings agree", () => {
  // September 2026 begins on a Tuesday.
  const sept = (weekStart: 0 | 1) => monthGrids(["2026-09-15"], "2026-09-01", weekStart)[0];

  it("a Monday week puts Monday 31 August first and the 1st second", () => {
    const first = sept(1).weeks[0];
    expect(first[0].iso).toBe("2026-08-31");
    expect(first[1].iso).toBe("2026-09-01");
    expect(weekdayInitials(1)).toEqual(["M", "T", "W", "T", "F", "S", "S"]);
  });

  it("CONTROL: a Sunday week puts Sunday 30 August first", () => {
    expect(sept(0).weeks[0][0].iso).toBe("2026-08-30");
    expect(weekdayInitials(0)).toEqual(["S", "M", "T", "W", "T", "F", "S"]);
  });

  it("every column is the same weekday, whichever day the week starts", () => {
    for (const ws of [0, 1] as const) {
      for (const week of sept(ws).weeks) {
        week.forEach((d, col) => {
          const day = new Date(`${d.iso}T12:00:00Z`).getUTCDay();
          expect(day, `${d.iso} under column ${col}`).toBe((col + ws) % 7);
        });
      }
    }
  });

  it("both calendars take the club's start for the grid AND the headings", () => {
    // Taking it for one and not the other puts every heading over the wrong day.
    for (const file of ["src/components/ClubCalendar.tsx", "src/components/AvailabilityCalendar.tsx"]) {
      const src = readSource(file);
      expect(src, file).toContain("weekdayInitials(weekStart)");
      expect(src, file).toMatch(/build\w+Calendar\([^)]*weekStart\)/);
      expect(src, file).not.toContain("WEEKDAY_INITIALS.map");
    }
  });
});
