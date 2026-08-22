import { describe, it, expect } from "vitest";
import {
  suggestChampion,
  honoursYear,
  honoursByYear,
  CHAMPION_REFUSAL,
  type FinishingPosition,
  type HonoursEntry,
} from "../honours";

/**
 * Who goes on the club's board.
 *
 * Asserted against what a committee actually decides, not against what a table
 * computes. The Rules put the result in the Committee's hands — a countback, a
 * disqualification under Rule 1.2, a play-off nobody entered into the app — and
 * a board that lasts decades is the worst possible place for the app to guess.
 */

const at = (rank: number, name: string): FinishingPosition => ({
  playerId: name.toLowerCase().replace(/\W/g, ""),
  name,
  rank,
});

describe("naming a champion", () => {
  it("names the clear winner and the two behind them", () => {
    const r = suggestChampion({
      completed: true,
      positions: [at(1, "zz Alex Vaughn"), at(2, "zz Sam Okafor"), at(3, "zz Priya Nair"), at(4, "zz Marco Diaz")],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.name).toBe("zz Alex Vaughn");
    expect(r.runnersUp.map((p) => p.name)).toEqual(["zz Sam Okafor", "zz Priya Nair"]);
  });

  it("REFUSES a tie at the top rather than picking one", () => {
    // The tiebreakers this app applies are the ones a committee configured for
    // SCORING. The ones that decide a championship — a play-off, a countback
    // chosen on the day, a shared title — are not in the data. Taking the
    // first of two players sorted equal would invent a champion.
    const r = suggestChampion({
      completed: true,
      positions: [at(1, "zz Alex Vaughn"), at(1, "zz Sam Okafor"), at(3, "zz Priya Nair")],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("tied");
    expect(r.tied.map((p) => p.name).sort()).toEqual(["zz Alex Vaughn", "zz Sam Okafor"]);
    expect(CHAMPION_REFUSAL.tied).toContain("committee");
  });

  it("names nobody for a tournament still being played", () => {
    // A winner goes up when the club says the tournament is over, not when the
    // last card happens to land.
    const r = suggestChampion({ completed: false, positions: [at(1, "zz Alex Vaughn")] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("not-completed");
  });

  it("names nobody from an empty board", () => {
    expect(suggestChampion({ completed: true, positions: [] }).ok).toBe(false);
  });

  it("ignores players who could not be ranked at all", () => {
    // An unranked player has no position — a card that stopped short holds
    // none — so they are not in the running and not a tie either.
    const r = suggestChampion({
      completed: true,
      positions: [at(0, "zz No Card"), at(1, "zz Alex Vaughn"), at(2, "zz Sam Okafor")],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.name).toBe("zz Alex Vaughn");
  });

  it("works when the top rank is not 1", () => {
    // Ranks come from whichever board scored the tournament, and a filtered or
    // flighted view can start at something else. The winner is the best rank
    // present, not the literal number one.
    const r = suggestChampion({ completed: true, positions: [at(3, "zz Alex Vaughn"), at(5, "zz Sam Okafor")] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.name).toBe("zz Alex Vaughn");
  });

  it("has a sentence for every refusal it can return", () => {
    // A board that will not name somebody has to say why, or the committee is
    // left looking at a blank line.
    for (const reason of ["not-completed", "no-results", "tied", "unconfirmed"] as const) {
      expect(CHAMPION_REFUSAL[reason], reason).toBeTruthy();
    }
  });
});

describe("which year a tournament belongs to", () => {
  it("reads the year out of the club's own dates", () => {
    expect(honoursYear("May 14–16, 2026")).toBe(2026);
    expect(honoursYear("2024 Club Championship")).toBe(2024);
  });

  it("takes the LAST year of a range or a split season", () => {
    // A winter league running Dec 2025 to Jan 2026 is won in 2026, and
    // "Winter 2025/26" hangs on the 2026 board.
    expect(honoursYear("Dec 2025 – Jan 2026")).toBe(2026);
    expect(honoursYear("Winter 2025/2026")).toBe(2026);
  });

  it("falls back to when it was completed, and then to nothing", () => {
    // Nothing rather than a guess: a wrong year on a permanent board is worse
    // than an undated line the club can fix.
    expect(honoursYear("", new Date("2025-11-02"))).toBe(2025);
    expect(honoursYear("Spring Meeting")).toBe(0);
    expect(honoursYear("")).toBe(0);
  });

  it("is not fooled by a number that is not a year", () => {
    expect(honoursYear("Round 18, 2023")).toBe(2023);
    expect(honoursYear("Match 1234")).toBe(0);
  });
});

describe("the board itself", () => {
  const entry = (over: Partial<HonoursEntry>): HonoursEntry => ({
    eventId: "e", eventName: "zz Cup", dates: "", year: 2026,
    championName: "zz Alex Vaughn", confirmedBy: "zz Secretary", ...over,
  });

  it("puts the newest year first", () => {
    const board = honoursByYear([
      entry({ year: 2024, eventName: "A" }),
      entry({ year: 2026, eventName: "B" }),
      entry({ year: 2025, eventName: "C" }),
    ]);
    expect(board.map((g) => g.year)).toEqual([2026, 2025, 2024]);
  });

  it("groups several tournaments in one year, in name order", () => {
    const board = honoursByYear([
      entry({ year: 2026, eventName: "zz Summer Meeting" }),
      entry({ year: 2026, eventName: "zz Club Championship" }),
    ]);
    expect(board).toHaveLength(1);
    expect(board[0].entries.map((e) => e.eventName)).toEqual([
      "zz Club Championship",
      "zz Summer Meeting",
    ]);
  });

  it("keeps undated tournaments, at the end, rather than dropping them", () => {
    // A club's oldest records are exactly the ones with vague dates, and they
    // are the ones most worth keeping.
    const board = honoursByYear([entry({ year: 0, eventName: "zz Old Cup" }), entry({ year: 2026 })]);
    expect(board.map((g) => g.year)).toEqual([2026, 0]);
    expect(board[1].entries[0].eventName).toBe("zz Old Cup");
  });

  it("returns nothing for a club with no confirmed results", () => {
    expect(honoursByYear([])).toEqual([]);
  });
});
