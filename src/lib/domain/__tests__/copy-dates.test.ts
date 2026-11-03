import { describe, it, expect } from "vitest";
import { copiedCalendar, COPY_DAY_GONE, type CopyCalendarSource } from "../copy-dates";

/**
 * THE DATES OF A COPY, FROM THE DAY PICKED (2026-10-24, "copy last event").
 *
 * Worked by hand, not by the function's own arithmetic: last year's medal
 * started Sat 13 Jun 2026, took entries from Mon 1 Jun to Wed 10 Jun, and
 * played Round 2 on Sun 14 Jun. Copied to Sat 12 Jun 2027 — 364 days later —
 * every day moves by 364: entries 31 May to 9 Jun, Round 2 on the 13th.
 */

const LAST_YEAR: CopyCalendarSource = {
  startOn: "2026-06-13",
  regDeadline: "2026-06-10",
  regOpens: "2026-06-01",
  rounds: [
    { id: "r1", playedOn: "2026-06-13" },
    { id: "r2", playedOn: "2026-06-14" },
    { id: "r3", playedOn: "" },
  ],
};

describe("a copy's dates are set from the day the secretary picks", () => {
  it("moves the entry window and every dated round by the same distance", () => {
    const c = copiedCalendar({ source: LAST_YEAR, startOn: "2027-06-12", endOn: "2027-06-13", today: "2027-01-05" });
    expect(c).toEqual({
      ok: true,
      startOn: "2027-06-12",
      endOn: "2027-06-13",
      regDeadline: "2027-06-09",
      regOpens: "2027-05-31",
      playedOn: { r1: "2027-06-12", r2: "2027-06-13", r3: "" },
    });
  });

  it("CONTROL: none of last year's days survives the copy", () => {
    const c = copiedCalendar({ source: LAST_YEAR, startOn: "2027-06-12", endOn: "", today: "2027-01-05" });
    const days = JSON.stringify(c);
    for (const old of ["2026-06-13", "2026-06-10", "2026-06-01", "2026-06-14"]) expect(days).not.toContain(old);
  });

  it("is refused for a day already gone at the club, and allowed for the club's today", () => {
    expect(copiedCalendar({ source: LAST_YEAR, startOn: "2027-01-04", endOn: "", today: "2027-01-05" })).toEqual({ ok: false, error: COPY_DAY_GONE });
    expect(copiedCalendar({ source: LAST_YEAR, startOn: "2027-01-05", endOn: "", today: "2027-01-05" }).ok).toBe(true);
  });

  it("asks the club's day, not any other: the same pick passes or fails on `today` alone", () => {
    // 6 Jan at the club in Auckland is still 5 Jan on a server in London.
    const pick = { source: LAST_YEAR, startOn: "2027-01-05", endOn: "" };
    expect(copiedCalendar({ ...pick, today: "2027-01-06" }).ok).toBe(false);
    expect(copiedCalendar({ ...pick, today: "2027-01-05" }).ok).toBe(true);
  });

  it("leaves empty a moved day that has already gone, rather than storing it", () => {
    // Copied to start in 2 days: entries would have opened 10 days ago and closed yesterday.
    const c = copiedCalendar({ source: LAST_YEAR, startOn: "2027-01-07", endOn: "", today: "2027-01-05" });
    expect(c.ok && c.regDeadline).toBe("");
    expect(c.ok && c.regOpens).toBe("");
    expect(c.ok && c.playedOn).toEqual({ r1: "2027-01-07", r2: "2027-01-08", r3: "" });
  });

  it("an opening day of today is 'open now', which empty already says", () => {
    const c = copiedCalendar({ source: LAST_YEAR, startOn: "2027-01-17", endOn: "", today: "2027-01-05" });
    expect(c.ok && c.regOpens).toBe("");
    expect(c.ok && c.regDeadline).toBe("2027-01-14");
  });

  it("takes the earliest round as the original's first day when it had no dates of its own", () => {
    const c = copiedCalendar({ source: { ...LAST_YEAR, startOn: "" }, startOn: "2027-06-12", endOn: "", today: "2027-01-05" });
    expect(c.ok && c.playedOn.r2).toBe("2027-06-13");
    expect(c.ok && c.regDeadline).toBe("2027-06-09");
  });

  it("reads the app's older stored deadline as a date too", () => {
    const c = copiedCalendar({ source: { ...LAST_YEAR, regDeadline: "Jun 10, 2026" }, startOn: "2027-06-12", endOn: "", today: "2027-01-05" });
    expect(c.ok && c.regDeadline).toBe("2027-06-09");
  });

  it("a one-day copy ends on its first day; an end before the start is a one-day copy", () => {
    expect(copiedCalendar({ source: LAST_YEAR, startOn: "2027-06-12", endOn: "", today: "2027-01-05" })).toMatchObject({ endOn: "2027-06-12" });
    expect(copiedCalendar({ source: LAST_YEAR, startOn: "2027-06-12", endOn: "2027-06-01", today: "2027-01-05" })).toMatchObject({ endOn: "2027-06-12" });
  });

  it("with no day picked, the copy starts undated — the older doors' behaviour, unchanged", () => {
    expect(copiedCalendar({ source: LAST_YEAR, startOn: "", endOn: "2027-06-13", today: "2027-01-05" })).toEqual({
      ok: true, startOn: "", endOn: "", regDeadline: "", regOpens: "", playedOn: { r1: "", r2: "", r3: "" },
    });
    // Not a date at all is no date.
    expect(copiedCalendar({ source: LAST_YEAR, startOn: "2027-02-30", endOn: "", today: "2027-01-05" })).toMatchObject({ ok: true, startOn: "" });
  });

  it("an original with no dates anywhere gives the copy its day and nothing else", () => {
    const c = copiedCalendar({
      source: { startOn: "", regDeadline: "", regOpens: "", rounds: [{ id: "r1", playedOn: "" }] },
      startOn: "2027-06-12",
      endOn: "",
      today: "2027-01-05",
    });
    expect(c).toEqual({ ok: true, startOn: "2027-06-12", endOn: "2027-06-12", regDeadline: "", regOpens: "", playedOn: { r1: "" } });
  });
});
