import { describe, expect, it } from "vitest";
import { clubClockInWords, clubDay, clubToday, isTimeZone, timeZoneChoices } from "../club-clock";
import { deadlinePassed, todayIso } from "../../deadline";
import { registrationStatus } from "../../registration";
import { playerMayChange } from "../attendance";

/**
 * ONE INSTANT, THREE DAYS. 01:00 UTC on the 13th is still the evening of the
 * 12th in New York and already the afternoon of the 13th in Auckland. Every
 * assertion below is about that instant, so none of them depends on the zone
 * of the machine running the test — which is the thing that hid the defect.
 */
const INSTANT = new Date("2026-10-13T01:00:00Z");

describe("what day it is at the club", () => {
  it("is the club's day, not the server's", () => {
    expect(clubToday("America/New_York", INSTANT)).toBe("2026-10-12");
    expect(clubToday("UTC", INSTANT)).toBe("2026-10-13");
    expect(clubToday("Pacific/Auckland", INSTANT)).toBe("2026-10-13");
    expect(clubToday("Asia/Kolkata", INSTANT)).toBe("2026-10-13");
    expect(clubToday("Pacific/Honolulu", INSTANT)).toBe("2026-10-12");
  });

  it("a Saturday 8am start in Sydney is today in Sydney, while UTC still says Friday", () => {
    const shotgun = new Date("2026-12-04T21:00:00Z"); // Saturday 5 December, 08:00 in Sydney
    expect(clubToday("Australia/Sydney", shotgun)).toBe("2026-12-05");
    expect(clubToday("UTC", shotgun)).toBe("2026-12-04");
  });

  it("a club that has not said where it is keeps this machine's day", () => {
    // The state every club was in before the setting, and it must not move.
    expect(clubToday("", INSTANT)).toBe(todayIso(INSTANT));
    expect(clubToday(null, INSTANT)).toBe(todayIso(INSTANT));
    expect(clubToday(undefined, INSTANT)).toBe(todayIso(INSTANT));
  });

  it("an unknown zone is refused rather than thrown on, and falls back the same way", () => {
    expect(isTimeZone("America/New_York")).toBe(true);
    expect(isTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isTimeZone("")).toBe(false);
    expect(isTimeZone(null)).toBe(false);
    expect(isTimeZone("<script>")).toBe(false);
    expect(clubToday("Mars/Olympus_Mons", INSTANT)).toBe(todayIso(INSTANT));
  });

  it("hands the day helpers a date they read as the club's day", () => {
    // `todayIso` reads the machine's own getters; `clubDay` is built so those
    // getters answer with the club's date, wherever the machine is.
    expect(todayIso(clubDay("America/New_York", INSTANT))).toBe("2026-10-12");
    expect(todayIso(clubDay("Pacific/Auckland", INSTANT))).toBe("2026-10-13");
    expect(todayIso(clubDay("Pacific/Kiritimati", INSTANT))).toBe("2026-10-13");
    expect(todayIso(clubDay("Pacific/Pago_Pago", INSTANT))).toBe("2026-10-12");
  });

  it("holds across a daylight-saving change in either direction", () => {
    // New York leaves daylight time on 1 November 2026 and takes it up on 14 March.
    expect(clubToday("America/New_York", new Date("2026-11-01T03:59:00Z"))).toBe("2026-10-31");
    expect(clubToday("America/New_York", new Date("2026-11-01T04:00:00Z"))).toBe("2026-11-01");
    expect(clubToday("America/New_York", new Date("2026-11-02T04:59:00Z"))).toBe("2026-11-01");
    expect(clubToday("America/New_York", new Date("2026-11-02T05:00:00Z"))).toBe("2026-11-02");
    expect(clubToday("America/New_York", new Date("2027-03-14T04:59:00Z"))).toBe("2027-03-13");
    expect(clubToday("America/New_York", new Date("2027-03-15T03:59:00Z"))).toBe("2027-03-14");
    expect(clubToday("America/New_York", new Date("2027-03-15T04:00:00Z"))).toBe("2027-03-15");
  });
});

describe("a deadline is the end of that day AT THE CLUB", () => {
  const reg = (now: Date) =>
    registrationStatus({
      eventStatus: "registration",
      deadline: "2026-10-12",
      opens: "",
      capacity: 0,
      confirmedCount: 0,
      override: null,
      now,
    });

  it("entries closing on the 12th are still open at 9pm on the 12th in New York", () => {
    // The defect: the server, on UTC, called this instant the 13th and closed it.
    expect(reg(clubDay("America/New_York", INSTANT)).acceptingEntries).toBe(true);
    expect(deadlinePassed("2026-10-12", clubDay("America/New_York", INSTANT))).toBe(false);
  });

  it("and are closed at the same instant for a club where the 13th has begun", () => {
    // The control: the same instant, the same deadline, the other answer.
    expect(reg(clubDay("Pacific/Auckland", INSTANT)).acceptingEntries).toBe(false);
    expect(deadlinePassed("2026-10-12", clubDay("UTC", INSTANT))).toBe(true);
  });

  it("the weekly answer stays open all of the deadline day at the club", () => {
    expect(playerMayChange("2026-10-12", clubDay("America/New_York", INSTANT))).toBe(true);
    expect(playerMayChange("2026-10-12", clubDay("Pacific/Auckland", INSTANT))).toBe(false);
  });

  it("entries opening on the 13th are not open yet in New York, and are in Auckland", () => {
    const opens = (now: Date) =>
      registrationStatus({
        eventStatus: "registration",
        deadline: "",
        opens: "2026-10-13",
        capacity: 0,
        confirmedCount: 0,
        override: null,
        now,
      }).state;
    expect(opens(clubDay("America/New_York", INSTANT))).toBe("not-open-yet");
    expect(opens(clubDay("Pacific/Auckland", INSTANT))).not.toBe("not-open-yet");
  });
});

describe("the clock on the settings screen", () => {
  it("reads the club's wall, in the club's words", () => {
    expect(clubClockInWords("America/New_York", "en-US", INSTANT)).toMatch(/Monday.*October 12.*9:00/);
    expect(clubClockInWords("Pacific/Auckland", "en-GB", INSTANT)).toMatch(/Tuesday.*13 October.*14:00/);
    expect(clubClockInWords("", "en-US", INSTANT)).toBe("");
  });

  it("offers real zones, each of which it would accept back", () => {
    const zones = timeZoneChoices();
    // CONTROL: the list is there at all, and holds the ones a club would look for.
    expect(zones.length).toBeGreaterThan(300);
    for (const z of ["America/New_York", "Europe/London", "Australia/Sydney", "Pacific/Auckland"]) {
      expect(zones).toContain(z);
    }
    // India is listed under its older name by some runtimes and its newer one
    // by others. Either is a zone, and a browser may report either — so the
    // picker must show a stored value that is not in its own list.
    expect(zones.some((z) => z === "Asia/Kolkata" || z === "Asia/Calcutta")).toBe(true);
    expect(isTimeZone("Asia/Kolkata")).toBe(true);
    expect(isTimeZone("Asia/Calcutta")).toBe(true);
    expect(clubToday("Asia/Kolkata", INSTANT)).toBe(clubToday("Asia/Calcutta", INSTANT));
    expect(zones.filter((z) => !isTimeZone(z))).toEqual([]);
  });
});
