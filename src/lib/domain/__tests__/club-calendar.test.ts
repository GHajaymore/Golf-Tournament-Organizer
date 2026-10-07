import { describe, it, expect } from "vitest";
import { buildClubCalendar, toneFor, weekAhead, type Commitment } from "../club-calendar";

/**
 * The club-wide calendar's one job: lay a member's commitments on the right
 * days, several to a square where a day has several, and keep the ones nobody
 * has dated rather than dropping them.
 *
 * Values, not shapes. Every assertion here is a number or an order a wrong
 * builder would get wrong — a square that dropped the second tournament, a
 * padding day that duplicated one across a month boundary, a count that summed
 * out rounds as in. See CLAUDE.md on cells that only assert shape.
 */

function commitment(over: Partial<Commitment> & { stageId: string; playedOn: string }): Commitment {
  return {
    eventId: `e-${over.stageId}`,
    eventName: "Event",
    roundLabel: "",
    dateLabel: "",
    status: "in",
    explicit: true,
    locked: false,
    canAnswer: false,
    ...over,
  };
}

function dayOf(cal: ReturnType<typeof buildClubCalendar>, monthKey: string, iso: string) {
  const month = cal.months.find((m) => m.key === monthKey);
  if (!month) return undefined;
  for (const week of month.weeks) {
    for (const day of week) {
      if (day.iso === iso) return day;
    }
  }
  return undefined;
}

/**
 * WHAT ELSE I HAVE ON THIS WEEK, for the player's Today (2026-10-06). Values
 * and order, over a fixture where every exclusion has a row it must drop.
 */
describe("weekAhead", () => {
  const today = "2026-10-06";
  const all = [
    commitment({ stageId: "medal-r2", eventId: "medal", eventName: "Saturday Medal", playedOn: "2026-10-10" }),
    commitment({ stageId: "league-w4", eventId: "league", eventName: "Thursday League", roundLabel: "Round 4", playedOn: "2026-10-08" }),
    commitment({ stageId: "cup-a", eventId: "cup", eventName: "Autumn Cup", playedOn: "2026-10-08" }),
    commitment({ stageId: "today", eventId: "pairs", eventName: "Pairs", playedOn: "2026-10-06" }),
    commitment({ stageId: "day7", eventId: "late", eventName: "Late", playedOn: "2026-10-13" }),
    commitment({ stageId: "past", eventId: "old", eventName: "Old", playedOn: "2026-10-05" }),
    commitment({ stageId: "out", eventId: "skip", eventName: "Skipped", playedOn: "2026-10-09", status: "out" }),
    commitment({ stageId: "undated", eventId: "nodate", eventName: "No date", playedOn: "" }),
  ];

  it("lists the other tournaments' rounds I'm playing in the next seven days, in date order", () => {
    expect(weekAhead(all, today, "medal").map((c) => c.stageId)).toEqual(["today", "cup-a", "league-w4"]);
  });

  it("leaves the tournament I'm looking at to Today itself", () => {
    expect(weekAhead(all, today, "league").map((c) => c.stageId)).not.toContain("league-w4");
    expect(weekAhead(all, today, "league").map((c) => c.stageId)).toContain("medal-r2");
  });

  it("drops a week I'm out of, a day already gone, an undated round and one a week out", () => {
    const ids = weekAhead(all, today, "nobody").map((c) => c.stageId);
    for (const gone of ["out", "past", "undated", "day7"]) expect(ids, gone).not.toContain(gone);
  });
});

describe("buildClubCalendar", () => {
  const today = "2026-01-01";

  it("puts every commitment on its day, several to a square, sorted by tournament", () => {
    // Deliberately out of order, and B before A, so a builder that kept input
    // order rather than sorting would fail the order assertion.
    const cal = buildClubCalendar(
      [
        commitment({ stageId: "b", eventName: "Braid Hollow Medal", playedOn: "2026-05-19", status: "out" }),
        commitment({ stageId: "a", eventName: "Ardmore Cup", playedOn: "2026-05-19", status: "in" }),
      ],
      today,
    );

    const day = dayOf(cal, "2026-05", "2026-05-19");
    expect(day?.commitments.map((c) => c.eventName)).toEqual(["Ardmore Cup", "Braid Hollow Medal"]);
  });

  it("spans empty months between the first commitment and the last", () => {
    const cal = buildClubCalendar(
      [
        commitment({ stageId: "a", playedOn: "2026-05-31" }),
        commitment({ stageId: "b", playedOn: "2026-07-01" }),
      ],
      today,
    );
    // May, the empty June, July — a gap in a season is information, not padding
    // to skip.
    expect(cal.months.map((m) => m.key)).toEqual(["2026-05", "2026-06", "2026-07"]);
    expect(cal.months.find((m) => m.key === "2026-06")?.count).toBe(0);
  });

  it("does not repeat a commitment on the neighbouring month's padding square", () => {
    // Two dates so June is in range. May 31 2026 is a Sunday, so it is the
    // leading padding square at the head of June's grid — the exact place a
    // naive builder would list the round a second time.
    const cal = buildClubCalendar(
      [
        commitment({ stageId: "a", playedOn: "2026-05-31" }),
        commitment({ stageId: "b", playedOn: "2026-06-15" }),
      ],
      today,
    );

    const inMay = dayOf(cal, "2026-05", "2026-05-31");
    const inJune = dayOf(cal, "2026-06", "2026-05-31");
    expect(inMay?.inMonth).toBe(true);
    expect(inMay?.commitments).toHaveLength(1);
    expect(inJune?.inMonth).toBe(false);
    expect(inJune?.commitments).toHaveLength(0);
  });

  it("counts the month's rounds, and how many the member is in for", () => {
    const cal = buildClubCalendar(
      [
        commitment({ stageId: "a", playedOn: "2026-05-19", status: "in" }),
        commitment({ stageId: "b", playedOn: "2026-05-19", status: "out" }),
        commitment({ stageId: "c", playedOn: "2026-05-20", status: "in" }),
      ],
      today,
    );
    const may = cal.months.find((m) => m.key === "2026-05");
    expect(may?.count).toBe(3);
    // Two in, one out — a builder summing out rounds as in would read 3.
    expect(may?.inCount).toBe(2);
  });

  it("keeps undated commitments out of the grid and in their own list", () => {
    const cal = buildClubCalendar(
      [
        commitment({ stageId: "dated", playedOn: "2026-05-19" }),
        commitment({ stageId: "undated", eventName: "Format To Follow", playedOn: "" }),
      ],
      today,
    );
    expect(cal.undated.map((c) => c.stageId)).toEqual(["undated"]);
    // The dated one is not swept into undated, and the undated one is on no day.
    expect(dayOf(cal, "2026-05", "2026-05-19")?.commitments).toHaveLength(1);
  });

  it("reads each of the four states through the shared toneFor", () => {
    expect(toneFor({ status: "in", explicit: true, locked: false })).toBe("in");
    expect(toneFor({ status: "in", explicit: false, locked: false })).toBe("in-default");
    expect(toneFor({ status: "out", explicit: true, locked: false })).toBe("out");
    expect(toneFor({ status: "out", explicit: false, locked: false })).toBe("out-default");
    expect(toneFor({ status: "in", explicit: true, locked: true })).toBe("locked");
  });

  it("is empty for a member with nothing on", () => {
    const cal = buildClubCalendar([], today);
    expect(cal.months).toHaveLength(0);
    expect(cal.undated).toHaveLength(0);
  });
});
