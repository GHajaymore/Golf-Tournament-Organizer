import { describe, it, expect } from "vitest";
import { planSeasonDates } from "@/lib/domain/round-dates";

/**
 * DATING A SEASON THAT WAS SET UP WITHOUT DATES. A league whose rounds have no
 * `playedOn` shows players a list instead of their availability calendar — the
 * club's Thursday league, 2026-09-19. One action dates them all.
 */
describe("dating the undated rounds of a season", () => {
  it("gives every undated round the start and then every interval, in running order", () => {
    const plan = planSeasonDates(
      [
        { id: "w1", playedOn: "" },
        { id: "w2", playedOn: "" },
        { id: "w3", playedOn: "" },
      ],
      "2026-09-24",
      7,
    );
    expect(plan).toEqual([
      { id: "w1", playedOn: "2026-09-24" },
      { id: "w2", playedOn: "2026-10-01" },
      { id: "w3", playedOn: "2026-10-08" },
    ]);
  });

  it("leaves a round that already has a date alone, and does not count it in the run", () => {
    // Week 2 was moved on purpose (a rain-out); it keeps its day, and the
    // undated weeks run on without a gap for it.
    const plan = planSeasonDates(
      [
        { id: "w1", playedOn: "" },
        { id: "w2", playedOn: "2026-10-15" },
        { id: "w3", playedOn: "" },
      ],
      "2026-09-24",
      7,
    );
    expect(plan).toEqual([
      { id: "w1", playedOn: "2026-09-24" },
      { id: "w3", playedOn: "2026-10-01" },
    ]);
  });

  it("treats a junk date as no date", () => {
    expect(planSeasonDates([{ id: "w1", playedOn: "next Thursday" }], "2026-09-24", 7)).toEqual([
      { id: "w1", playedOn: "2026-09-24" },
    ]);
  });

  it("crosses a month and a year correctly", () => {
    const plan = planSeasonDates(
      [
        { id: "a", playedOn: "" },
        { id: "b", playedOn: "" },
      ],
      "2026-12-28",
      7,
    );
    expect(plan.map((p) => p.playedOn)).toEqual(["2026-12-28", "2027-01-04"]);
  });

  it("has nothing to do when every round is dated", () => {
    expect(planSeasonDates([{ id: "a", playedOn: "2026-09-24" }], "2026-10-01", 7)).toEqual([]);
  });
});
