import { describe, it, expect } from "vitest";
import { daysBetween, relativeDay, shortDate } from "@/lib/domain/round-dates";
import { splitBySchedule } from "@/lib/services/availability";
import type { AvailabilityRound } from "@/lib/services/availability";

/**
 * The player's answer to "am I playing, and when".
 *
 * Two things are being protected here. The first is the calendar arithmetic: a
 * league night is a day, not an instant, and every bug this module has ever had
 * came from letting a timezone or a daylight-saving change decide which day it
 * was. The second is the split — which round the app calls "next" — because
 * getting it wrong means asking a player about a week that has already gone
 * while the one they can still make sits below the fold.
 */

const round = (over: Partial<AvailabilityRound> = {}): AvailabilityRound => ({
  stageId: "s1",
  label: "Round 1",
  playedOn: "",
  dateLabel: "",
  whenLabel: "",
  optDeadline: "",
  deadlineLabel: "Open",
  status: "in",
  explicit: false,
  locked: false,
  ...over,
});

describe("calendar arithmetic", () => {
  it("counts whole days across a daylight-saving change", () => {
    // US DST begins 8 March 2026. Millisecond arithmetic across it lands an
    // hour out, and after rounding that eventually becomes a whole day —
    // which is how a season generated in March slips to Mondays by November.
    expect(daysBetween("2026-03-06", "2026-03-10")).toBe(4);
    expect(daysBetween("2026-10-30", "2026-11-06")).toBe(7);
  });

  it("is negative backwards and zero for the same day", () => {
    expect(daysBetween("2026-05-19", "2026-05-12")).toBe(-7);
    expect(daysBetween("2026-05-19", "2026-05-19")).toBe(0);
  });

  it("returns null rather than guessing at unparseable dates", () => {
    expect(daysBetween("", "2026-05-19")).toBeNull();
    expect(daysBetween("next Tuesday", "2026-05-19")).toBeNull();
  });

  it("names the days a player acts on", () => {
    expect(relativeDay("2026-05-19", "2026-05-19")).toBe("Today");
    expect(relativeDay("2026-05-20", "2026-05-19")).toBe("Tomorrow");
    expect(relativeDay("2026-05-24", "2026-05-19")).toBe("in 5 days");
  });

  it("says nothing for the distant or the past", () => {
    // "in 34 days" is worse than the date itself, and how long ago a round was
    // is not what the reader needs — the section heading already says so.
    expect(relativeDay("2026-07-01", "2026-05-19")).toBe("");
    expect(relativeDay("2026-05-12", "2026-05-19")).toBe("");
  });

  it("formats a date without letting a timezone move it", () => {
    // The bug this guards: parsing "2026-05-19" as an instant renders it as the
    // 18th anywhere west of UTC, so a club sees Monday for a Tuesday round.
    expect(shortDate("2026-05-19")).toBe("Tue 19 May");
    expect(shortDate("2026-01-01")).toBe("Thu 1 Jan");
  });
});

describe("splitting the season around today", () => {
  const at = (iso: string) => new Date(`${iso}T12:00:00`);

  const season = [
    round({ stageId: "s1", label: "Round 1", playedOn: "2026-05-05" }),
    round({ stageId: "s2", label: "Round 2", playedOn: "2026-05-12" }),
    round({ stageId: "s3", label: "Round 3", playedOn: "2026-05-19" }),
    round({ stageId: "s4", label: "Round 4", playedOn: "2026-05-26" }),
  ];

  it("calls the first unplayed round next, and the rest future", () => {
    const { next, future, past } = splitBySchedule(season, at("2026-05-14"));
    expect(next?.stageId).toBe("s3");
    expect(future.map((r) => r.stageId)).toEqual(["s4"]);
    expect(past.map((r) => r.stageId)).toEqual(["s1", "s2"]);
  });

  it("keeps a round being played TODAY as next, not past", () => {
    // The person this feature exists for is deciding at breakfast whether they
    // can make tonight. Filing tonight under "earlier rounds" is the one
    // failure that makes the whole card useless.
    const { next, past } = splitBySchedule(season, at("2026-05-19"));
    expect(next?.stageId).toBe("s3");
    expect(past).toHaveLength(2);
  });

  it("leaves an undated round ahead rather than guessing it has gone", () => {
    const mixed = [round({ stageId: "a", playedOn: "" }), round({ stageId: "b", playedOn: "2026-05-05" })];
    const { next, past } = splitBySchedule(mixed, at("2026-06-01"));
    expect(next?.stageId).toBe("a");
    expect(past.map((r) => r.stageId)).toEqual(["b"]);
  });

  it("has no next round once the season is over", () => {
    const { next, future, past } = splitBySchedule(season, at("2026-06-01"));
    expect(next).toBeNull();
    expect(future).toEqual([]);
    expect(past).toHaveLength(4);
  });

  it("keeps the league's own round order, not date order", () => {
    // A rained-off week moved to the end of the season is still Round 4.
    // Renumbering it under the player would misname the round they are
    // answering for.
    const moved = [
      round({ stageId: "s3", label: "Round 3", playedOn: "2026-06-30" }),
      round({ stageId: "s4", label: "Round 4", playedOn: "2026-05-26" }),
    ];
    const { next, future } = splitBySchedule(moved, at("2026-05-20"));
    expect(next?.label).toBe("Round 3");
    expect(future[0]?.label).toBe("Round 4");
  });

  it("puts everything ahead when the season has not started", () => {
    const { next, future, past } = splitBySchedule(season, at("2026-05-01"));
    expect(next?.stageId).toBe("s1");
    expect(future).toHaveLength(3);
    expect(past).toEqual([]);
  });
});
