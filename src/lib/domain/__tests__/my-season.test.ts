import { describe, it, expect } from "vitest";
import { entryWords, heldAPlace, inSeason, seasonBests, strongestEntry, type SeasonEntry } from "../my-season";
import { currentSeason, seasonWindow } from "../club-season";

/**
 * THE THREE THINGS A SEASON ADDS TO THE BOARDS (2026-10-24) — which tournaments
 * are this season, what an entry with no result is called, and the best of the
 * member's figures. Everything else on `/me/season` is the boards' own, and is
 * held to them by `my-season-reads-the-boards.audit.test.ts`.
 */

describe("which season a tournament is in", () => {
  const calendar = seasonWindow("", "");
  const winter = seasonWindow("10-01", "05-31");

  it("is the calendar year for a club that has not said", () => {
    const now = currentSeason("2026-10-24", calendar);
    expect(inSeason("2026-01-02", now, calendar)).toBe(true);
    expect(inSeason("2025-12-31", now, calendar)).toBe(false);
  });

  it("crosses the new year with a club whose season does", () => {
    const now = currentSeason("2027-02-10", winter);
    expect(now?.label).toBe("2026–27");
    expect(inSeason("2026-11-01", now, winter), "November is the same winter").toBe(true);
    expect(inSeason("2026-09-15", now, winter), "September is last season").toBe(false);
  });

  it("puts an undated tournament in no season, rather than guessing this one", () => {
    const now = currentSeason("2026-10-24", calendar);
    expect(inSeason("", now, calendar)).toBe(false);
    expect(inSeason("2026-10-01", null, calendar)).toBe(false);
  });
});

describe("what an entry with no result is called", () => {
  const ALL: SeasonEntry[] = ["confirmed", "waitlisted", "pending", "withdrawn", "disqualified"];

  it("never tells somebody with a row in the field they are not entered", () => {
    for (const e of ALL) for (const rounds of [0, 1]) for (const done of [false, true]) {
      expect(entryWords(e, rounds, done), `${e}, ${rounds} rounds`).not.toMatch(/not entered|aren.t entered/i);
    }
  });

  it("says waiting as waiting, and nothing played as not yet", () => {
    expect(entryWords("waitlisted", 0, false)).toBe("On the waiting list");
    expect(entryWords("pending", 0, false)).toBe("Awaiting approval");
    expect(entryWords("confirmed", 0, false)).toBe("Entered · nothing played yet");
    expect(entryWords("confirmed", 0, true), "over, with no card: not 'yet'").toBe("Entered · no card returned");
  });

  it("counts a place held, not a place waited for", () => {
    expect(ALL.filter(heldAPlace).sort()).toEqual(["confirmed", "disqualified", "withdrawn"]);
  });

  it("reads the strongest of two rows one address has in one field", () => {
    expect(strongestEntry(["waitlisted", "confirmed"])).toBe("confirmed");
    expect(strongestEntry(["pending", "waitlisted"])).toBe("pending");
    expect(strongestEntry(["withdrawn"])).toBe("withdrawn");
    expect(strongestEntry(["nonsense"])).toBeNull();
    expect(strongestEntry([])).toBeNull();
  });
});

describe("the season's best", () => {
  it("is the lowest gross and net and the most points", () => {
    const { holes, bests } = seasonBests([
      { holes: 18, gross: 80, net: 70, points: null },
      { holes: 18, gross: 76, net: 72, points: null },
      { holes: 18, gross: 82, net: null, points: 39 },
      { holes: 18, gross: 79, net: null, points: 41 },
    ]);
    expect(holes).toBe(18);
    expect(bests).toEqual([
      { label: "Best gross", value: 76 },
      { label: "Best net", value: 70 },
      { label: "Best points", value: 41 },
    ]);
  });

  it("never compares a nine with an eighteen", () => {
    const { holes, bests } = seasonBests([
      { holes: 9, gross: 38, net: 33, points: null },
      { holes: 18, gross: 80, net: 71, points: null },
    ]);
    expect(holes).toBe(18);
    expect(bests.find((b) => b.label === "Best gross")?.value, "a nine's 38 is not a best eighteen").toBe(80);
  });

  it("takes the nines when nines are all there are", () => {
    const { holes, bests } = seasonBests([
      { holes: 9, gross: 40, net: 35, points: null },
      { holes: 9, gross: 38, net: 36, points: null },
    ]);
    expect(holes).toBe(9);
    expect(bests).toEqual([
      { label: "Best gross", value: 38 },
      { label: "Best net", value: 35 },
    ]);
  });

  it("says nothing with nothing to compare", () => {
    expect(seasonBests([])).toEqual({ holes: 0, bests: [] });
    expect(seasonBests([{ holes: 18, gross: null, net: null, points: null }]).bests).toEqual([]);
  });
});
