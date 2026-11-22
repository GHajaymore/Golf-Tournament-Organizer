import { describe, it, expect } from "vitest";
import { defaultRoundDays } from "@/lib/domain/round-dates";
import { inheritedRoundTee } from "@/lib/domain/inherited-tee";
import { allowanceSource, recommendedAllowance } from "@/lib/round-allowance";

/**
 * THE THREE PURE FUNCTIONS THE REDESIGNED ROUNDS SCREEN READS (R4), each worked by hand, not by the code's own route.
 */

describe("defaultRoundDays: the day the app proposes for each round", () => {
  it("one day, one round: the first day", () => {
    expect(defaultRoundDays("2026-10-10", "2026-10-10", 1)).toEqual(["2026-10-10"]);
  });
  it("two days, two rounds: a round a day", () => {
    expect(defaultRoundDays("2026-10-10", "2026-10-11", 2)).toEqual(["2026-10-10", "2026-10-11"]);
  });
  it("three rounds over two days: the days run out, so the third is played on the last", () => {
    expect(defaultRoundDays("2026-10-10", "2026-10-11", 3)).toEqual(["2026-10-10", "2026-10-11", "2026-10-11"]);
  });
  it("a month boundary is a calendar, not a clock", () => {
    expect(defaultRoundDays("2026-10-31", "2026-11-02", 3)).toEqual(["2026-10-31", "2026-11-01", "2026-11-02"]);
  });
  it("a league's weekly: a week apart, and the entry window's last day does not cap a season", () => {
    expect(defaultRoundDays("2026-10-07", "2026-10-07", 3, 7)).toEqual(["2026-10-07", "2026-10-14", "2026-10-21"]);
  });
  it("proposes nothing with no first day or no rounds", () => {
    expect(defaultRoundDays("", "2026-10-11", 2)).toEqual([]);
    expect(defaultRoundDays("2026-10-10", "", 0)).toEqual([]);
  });
  it("an end day before the start is no span: every round on the first day", () => {
    expect(defaultRoundDays("2026-10-10", "2026-10-08", 2)).toEqual(["2026-10-10", "2026-10-10"]);
  });
});

describe("inheritedRoundTee: 'same as Round 1 at this course'", () => {
  const rounds = [
    { id: "r1", courseId: "home" },
    { id: "r2", courseId: "away" },
    { id: "r3", courseId: "home" },
  ];
  it("a round at a course played before inherits the first round there", () => {
    expect(inheritedRoundTee(rounds.slice(0, 2), "home")?.id).toBe("r1");
    expect(inheritedRoundTee(rounds, "away")?.id).toBe("r2");
  });
  it("the first round at a course inherits nothing", () => {
    expect(inheritedRoundTee([], "home")).toBeNull();
    expect(inheritedRoundTee(rounds.slice(0, 1), "away")).toBeNull();
  });
  it("a round with no course named inherits nothing", () => {
    expect(inheritedRoundTee(rounds, null)).toBeNull();
  });
  it("takes the EARLIEST round at the course, not the latest", () => {
    expect(inheritedRoundTee([...rounds, { id: "r4", courseId: "home" }], "home")?.id).toBe("r1");
  });
});

describe("allowanceSource: where a default allowance comes from", () => {
  it("an individual stroke round at 95% is the Rules' recommendation", () => {
    expect(recommendedAllowance("Stroke Play", "Stroke Play Round")).toBe(95);
    expect(allowanceSource("Stroke Play", "Stroke Play Round")).toBe("the Rules' recommendation");
  });
  it("four-ball stroke play at 85% is the Rules' recommendation", () => {
    expect(allowanceSource("Four-Ball", "Stroke Play Round")).toBe("the Rules' recommendation");
  });
  it("a figure of 100% is the Rules' own", () => {
    expect(recommendedAllowance("Match Play", "Single Match Stage")).toBe(100);
    expect(allowanceSource("Match Play", "Single Match Stage")).toBe("the Rules");
  });
  it("a club convention the Rules do not state is called usual", () => {
    expect(allowanceSource("Shamble", "Stroke Play Round")).toBe("usual");
  });
});
