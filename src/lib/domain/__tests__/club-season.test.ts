import { describe, it, expect } from "vitest";
import {
  seasonWindow,
  seasonOf,
  seasonLabel,
  seasonWraps,
  inPlayingWindow,
  bySeason,
  currentSeason,
} from "../club-season";

/**
 * SEASONS, AND THE CLUBS WHOSE YEAR IS NOT THE CALENDAR'S.
 *
 * The four windows a secretary actually gives, all of them from Ajay on
 * 2026-09-19: January to December, April to September, April to March next
 * year, and a winter society running October to May.
 *
 * Asserted against what a club would say rather than against what the code
 * does. The cases that matter are the boundary itself and the crossing: a club
 * opening on 1 April is still in its 2026 season on 2 January 2027.
 */

const CALENDAR = seasonWindow("", "");
const SUMMER = seasonWindow("04-01", "09-30"); // April to September
const FULL_YEAR_FROM_APRIL = seasonWindow("04-01", "03-31"); // April to March next year
const WINTER = seasonWindow("10-01", "05-31"); // October to May

describe("the club's season window", () => {
  it("is the calendar year when the club has not said", () => {
    expect(CALENDAR).toEqual({ startMonth: 1, startDay: 1, endMonth: 12, endDay: 31 });
  });

  it("is what the club picked", () => {
    expect(SUMMER).toEqual({ startMonth: 4, startDay: 1, endMonth: 9, endDay: 30 });
  });

  it("falls back on each half independently", () => {
    // "We open in April" on its own means April to the end of the year, not
    // April to April.
    expect(seasonWindow("04-01", "")).toEqual({ startMonth: 4, startDay: 1, endMonth: 12, endDay: 31 });
    expect(seasonWindow("", "09-30")).toEqual({ startMonth: 1, startDay: 1, endMonth: 9, endDay: 30 });
  });

  it("falls back rather than throwing on a value that is not one", () => {
    // It decides how a list is grouped. A bad column should not take a screen
    // down, and "nothing" honestly means the calendar year.
    for (const bad of ["", "   ", "April", "13-01", "04-31", "02-30", "2026-04-01", "4-1"]) {
      expect(seasonWindow(bad, bad), bad).toEqual({
        startMonth: 1,
        startDay: 1,
        endMonth: 12,
        endDay: 31,
      });
    }
  });

  it("knows which windows cross the new year", () => {
    expect(seasonWraps(CALENDAR)).toBe(false);
    expect(seasonWraps(SUMMER)).toBe(false);
    expect(seasonWraps(FULL_YEAR_FROM_APRIL)).toBe(true);
    expect(seasonWraps(WINTER)).toBe(true);
  });
});

describe("which season a tournament is in", () => {
  it("is its calendar year for a club on the calendar", () => {
    expect(seasonOf("2026-05-14", CALENDAR)).toEqual({ key: 2026, label: "2026" });
    expect(seasonOf("2026-01-01", CALENDAR)?.key).toBe(2026);
    expect(seasonOf("2026-12-31", CALENDAR)?.key).toBe(2026);
  });

  it("puts the new year into the season that opened last spring", () => {
    // THE CASE THE FILE EXISTS FOR. April to March: 2 January 2027 is still
    // the 2026–27 season, not a 2027 season that has not begun.
    expect(seasonOf("2027-01-02", FULL_YEAR_FROM_APRIL)).toEqual({ key: 2026, label: "2026–27" });
    expect(seasonOf("2027-03-31", FULL_YEAR_FROM_APRIL)?.key).toBe(2026);
    expect(seasonOf("2027-04-01", FULL_YEAR_FROM_APRIL)?.key).toBe(2027);
  });

  it("keeps an out-of-season outing in the season that is running", () => {
    // April to September, and the club runs a December scramble. It belongs to
    // the 2026 season; telling a member it is in 2027 would be worse than
    // saying nothing.
    expect(seasonOf("2026-12-12", SUMMER)?.key).toBe(2026);
    expect(inPlayingWindow("2026-12-12", SUMMER)).toBe(false);
    expect(inPlayingWindow("2026-07-04", SUMMER)).toBe(true);
  });

  it("handles a season ending in January of the next year", () => {
    // April to January, named on 2026-09-19. It crosses the new year without
    // covering it, which is the case between "April to September" and "April
    // to March" and the one most likely to be got wrong.
    const w = seasonWindow("04-01", "01-31");
    expect(seasonWraps(w)).toBe(true);
    expect(seasonOf("2026-04-01", w)).toEqual({ key: 2026, label: "2026–27" });
    expect(seasonOf("2027-01-15", w)?.key).toBe(2026);
    expect(inPlayingWindow("2027-01-15", w)).toBe(true);
    // February and March are between seasons: still the 2026 season, and the
    // club is not playing.
    expect(seasonOf("2027-02-15", w)?.key).toBe(2026);
    expect(inPlayingWindow("2027-02-15", w)).toBe(false);
    // And the next April opens the next one.
    expect(seasonOf("2027-04-01", w)?.key).toBe(2027);
  });

  it("handles a winter society running October to May", () => {
    expect(seasonOf("2026-10-01", WINTER)?.key).toBe(2026);
    expect(seasonOf("2027-05-20", WINTER)?.key).toBe(2026);
    expect(seasonOf("2026-09-30", WINTER)?.key).toBe(2025);
    expect(inPlayingWindow("2027-05-20", WINTER)).toBe(true);
    expect(inPlayingWindow("2027-06-20", WINTER)).toBe(false);
  });

  it("handles a season running October to August next year", () => {
    // Eleven months, crossing the new year — named on 2026-09-19 alongside
    // April–January. September is the only month out of play.
    const w = seasonWindow("10-01", "08-31");
    expect(seasonWraps(w)).toBe(true);
    expect(seasonOf("2026-10-01", w)).toEqual({ key: 2026, label: "2026–27" });
    expect(seasonOf("2027-08-31", w)?.key).toBe(2026);
    expect(inPlayingWindow("2027-08-31", w)).toBe(true);
    expect(inPlayingWindow("2027-09-15", w)).toBe(false);
    expect(seasonOf("2027-10-01", w)?.key).toBe(2027);
  });

  it("is null for a tournament with no start date, rather than a guess", () => {
    for (const bad of ["", "   ", "May 2026", "2026-13-01", "2026-02-30"]) {
      expect(seasonOf(bad, SUMMER), bad).toBeNull();
    }
  });

  it("labels a crossing season the way a fixture card does", () => {
    expect(seasonLabel(2026, CALENDAR)).toBe("2026");
    expect(seasonLabel(2026, SUMMER)).toBe("2026");
    expect(seasonLabel(2026, FULL_YEAR_FROM_APRIL)).toBe("2026–27");
    // The turn of the century, because two digits and a modulo can go wrong.
    expect(seasonLabel(2099, WINTER)).toBe("2099–00");
    expect(seasonLabel(2100, WINTER)).toBe("2100–01");
  });

  it("says which season today is in", () => {
    expect(currentSeason("2027-02-11", FULL_YEAR_FROM_APRIL)?.label).toBe("2026–27");
    expect(currentSeason("", FULL_YEAR_FROM_APRIL)).toBeNull();
  });
});

describe("grouping a club's tournaments", () => {
  const events = [
    { id: "a", startOn: "2026-05-14" },
    { id: "b", startOn: "2027-02-02" },
    { id: "c", startOn: "2027-06-01" },
    { id: "d", startOn: "" },
    { id: "e", startOn: "2026-04-01" },
  ];

  it("puts the newest season first and the undated ones last", () => {
    const groups = bySeason(events, FULL_YEAR_FROM_APRIL);
    expect(groups.map((g) => g.season?.label ?? "none")).toEqual(["2027–28", "2026–27", "none"]);
    expect(groups[1].items.map((e) => e.id)).toEqual(["a", "b", "e"]);
    expect(groups[2].items.map((e) => e.id)).toEqual(["d"]);
  });

  it("keeps the caller's order inside a season", () => {
    // The screen has already sorted by what it is about — entries closing, a
    // board worth opening. Re-sorting here would overrule it silently.
    const groups = bySeason([events[1], events[0], events[4]], FULL_YEAR_FROM_APRIL);
    expect(groups[0].items.map((e) => e.id)).toEqual(["b", "a", "e"]);
  });

  it("groups the same tournaments differently for a different club year", () => {
    // The proof that the window does the work rather than the year in the
    // string: the same five rows, three seasons instead of two.
    const groups = bySeason(events, CALENDAR);
    expect(groups.map((g) => g.season?.label ?? "none")).toEqual(["2027", "2026", "none"]);
  });

  it("loses nothing", () => {
    const groups = bySeason(events, FULL_YEAR_FROM_APRIL);
    expect(groups.flatMap((g) => g.items).length).toBe(events.length);
  });

  it("returns nothing for nothing", () => {
    expect(bySeason([], FULL_YEAR_FROM_APRIL)).toEqual([]);
  });
});
