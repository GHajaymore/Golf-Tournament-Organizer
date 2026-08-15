import { describe, it, expect } from "vitest";
import {
  buildAvailabilityCalendar,
  toneOf,
  TONE_LABEL,
  type CalendarRound,
} from "../availability-calendar";

/**
 * A league season laid out on days.
 *
 * The grid has to be right before it can be pretty: a round drawn on the wrong
 * square is worse than no calendar at all, because a player will plan around
 * it. Everything here is about placement — which square, which month, and what
 * the square says about an answer nobody has given yet.
 */

/** A day square with nothing on it, for the tone tests below. */
const day = () => ({
  iso: "2026-05-06",
  day: 6,
  inMonth: true,
  isToday: false,
  isPast: false,
  round: null as CalendarRound | null,
});

const round = (over: Partial<CalendarRound> = {}): CalendarRound => ({
  stageId: "s1",
  label: "Round 1",
  status: "in",
  explicit: true,
  locked: false,
  playedOn: "2026-05-06",
  ...over,
});

/** The day cell for an ISO date, wherever it landed. */
const cell = (months: ReturnType<typeof buildAvailabilityCalendar>["months"], iso: string) =>
  months.flatMap((m) => m.weeks.flat()).find((d) => d.iso === iso && d.inMonth);

describe("where a round lands", () => {
  it("puts a round on its own date", () => {
    const { months } = buildAvailabilityCalendar([round()], "2026-05-01");
    const day = cell(months, "2026-05-06");
    expect(day?.round?.stageId).toBe("s1");
    expect(day?.day).toBe(6);
  });

  it("does not shift a date by a timezone it does not have", () => {
    // The failure this is written against: a round dated the 1st, read through
    // a Date on a server behind UTC, drawn on the last day of April. Every
    // boundary date in one sweep — first of the month, last of the month, and
    // the turn of the year.
    for (const iso of ["2026-05-01", "2026-05-31", "2026-01-01", "2026-12-31", "2026-02-28"]) {
      const { months } = buildAvailabilityCalendar([round({ playedOn: iso })], "2026-01-01");
      const day = cell(months, iso);
      expect(day?.round, iso).not.toBeNull();
      expect(day?.iso, iso).toBe(iso);
    }
  });

  it("handles a leap day", () => {
    const { months } = buildAvailabilityCalendar([round({ playedOn: "2028-02-29" })], "2028-01-01");
    expect(cell(months, "2028-02-29")?.round?.stageId).toBe("s1");
  });

  it("starts every week on Sunday", () => {
    // 2026-05-06 is a Wednesday, so it must be the fourth square of its week.
    const { months } = buildAvailabilityCalendar([round()], "2026-05-01");
    const week = months[0].weeks.find((w) => w.some((d) => d.iso === "2026-05-06"))!;
    expect(week.findIndex((d) => d.iso === "2026-05-06")).toBe(3);
    expect(week).toHaveLength(7);
  });

  it("keeps every week rectangular", () => {
    const { months } = buildAvailabilityCalendar(
      [round({ playedOn: "2026-02-01" }), round({ stageId: "s2", playedOn: "2026-08-31" })],
      "2026-02-01",
    );
    for (const m of months) {
      for (const w of m.weeks) expect(w, m.label).toHaveLength(7);
    }
  });
});

describe("which months are shown", () => {
  it("runs from the first round to the last, and no further", () => {
    const rounds = [
      round({ stageId: "a", playedOn: "2026-05-06" }),
      round({ stageId: "b", playedOn: "2026-07-15" }),
    ];
    const { months } = buildAvailabilityCalendar(rounds, "2026-05-01");
    expect(months.map((m) => m.key)).toEqual(["2026-05", "2026-06", "2026-07"]);
  });

  it("keeps an empty month in the middle, because a gap is information", () => {
    // June holds no round: that IS the answer to "are we off that month".
    const { months } = buildAvailabilityCalendar(
      [round({ stageId: "a", playedOn: "2026-05-06" }), round({ stageId: "b", playedOn: "2026-07-15" })],
      "2026-05-01",
    );
    expect(months[1].label).toBe("June 2026");
    expect(months[1].roundCount).toBe(0);
  });

  it("crosses a year end", () => {
    const { months } = buildAvailabilityCalendar(
      [round({ stageId: "a", playedOn: "2026-12-15" }), round({ stageId: "b", playedOn: "2027-01-12" })],
      "2026-12-01",
    );
    expect(months.map((m) => m.key)).toEqual(["2026-12", "2027-01"]);
    expect(months[1].label).toBe("January 2027");
  });

  it("counts the rounds and the ones the player is in for", () => {
    const rounds = [
      round({ stageId: "a", playedOn: "2026-05-06", status: "in" }),
      round({ stageId: "b", playedOn: "2026-05-13", status: "out" }),
      round({ stageId: "c", playedOn: "2026-05-20", status: "in" }),
    ];
    const { months } = buildAvailabilityCalendar(rounds, "2026-05-01");
    expect(months[0].roundCount).toBe(3);
    expect(months[0].inCount).toBe(2);
  });

  it("counts a round once, in the month it is played", () => {
    // The 1st of a month appears twice in a grid — once as a padding square on
    // the previous month. It must not be counted or tapped twice.
    const { months } = buildAvailabilityCalendar(
      [round({ stageId: "a", playedOn: "2026-05-31" }), round({ stageId: "b", playedOn: "2026-06-01" })],
      "2026-05-01",
    );
    expect(months.map((m) => m.roundCount)).toEqual([1, 1]);
  });
});

describe("a round with no date", () => {
  it("is handed back rather than dropped", () => {
    // A round nobody has dated is exactly the one a player would otherwise
    // never see — it cannot go on a grid, so it must go somewhere else.
    const { months, undated } = buildAvailabilityCalendar(
      [round({ stageId: "a" }), round({ stageId: "b", playedOn: "" })],
      "2026-05-01",
    );
    expect(undated.map((r) => r.stageId)).toEqual(["b"]);
    expect(months).toHaveLength(1);
  });

  it("refuses a date that names no day", () => {
    for (const bad of ["Sat 14 Jun", "2026-13-45", "2026-5-6", "next Tuesday"]) {
      const { months, undated } = buildAvailabilityCalendar([round({ playedOn: bad })], "2026-05-01");
      expect(months, bad).toHaveLength(0);
      expect(undated, bad).toHaveLength(1);
    }
  });

  it("returns nothing at all for a season with no dates", () => {
    expect(buildAvailabilityCalendar([], "2026-05-01").months).toEqual([]);
  });
});

describe("today, and what has been and gone", () => {
  it("marks today exactly once", () => {
    const { months } = buildAvailabilityCalendar([round()], "2026-05-06");
    const todays = months.flatMap((m) => m.weeks.flat()).filter((d) => d.isToday && d.inMonth);
    expect(todays).toHaveLength(1);
    expect(todays[0].iso).toBe("2026-05-06");
  });

  it("treats the day of a round as not yet past", () => {
    // The same reading as every other deadline in the app: the day counts.
    const { months } = buildAvailabilityCalendar([round()], "2026-05-06");
    expect(cell(months, "2026-05-06")?.isPast).toBe(false);
  });
});

describe("what a square says", () => {
  it("separates a stated answer from the league's default", () => {
    // The distinction the whole feature turns on. "In" and "in because nobody
    // said otherwise" are different promises, and a member planning a holiday
    // around the grid deserves to see which one they are looking at.
    expect(toneOf({ ...day(), round: round({ status: "in", explicit: true }) })).toBe("in");
    expect(toneOf({ ...day(), round: round({ status: "in", explicit: false }) })).toBe("in-default");
    expect(toneOf({ ...day(), round: round({ status: "out", explicit: true }) })).toBe("out");
    expect(toneOf({ ...day(), round: round({ status: "out", explicit: false }) })).toBe("out-default");
  });

  it("draws a closed round as closed, whatever the answer was", () => {
    // Past the deadline it is a fact, not a question, and offering it as a
    // choice would be a lie the player finds out about at the tee.
    for (const status of ["in", "out"] as const) {
      expect(toneOf({ ...day(), round: round({ status, locked: true }) })).toBe("locked");
    }
  });

  it("has a word for every tone, including the empty square", () => {
    for (const tone of ["in", "in-default", "out", "out-default", "locked", "none"] as const) {
      expect(TONE_LABEL[tone].length).toBeGreaterThan(0);
    }
    expect(toneOf({ ...day(), round: null })).toBe("none");
  });
});
