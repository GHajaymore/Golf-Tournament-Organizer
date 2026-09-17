import { describe, it, expect } from "vitest";
import { drawMeeting, leagueWeekMeetings } from "../league-draw";

const clubs = (n: number) => Array.from({ length: n }, (_, i) => `c${i}`);
const key = (a: string, b: string) => [a, b].sort().join(":");

describe("leagueWeekMeetings", () => {
  /**
   * The definition of a round robin: over one cycle every club meets every
   * other exactly once, and nobody plays twice in a week. Swept across sizes,
   * starting where the off-by-ones live.
   */
  it.each([2, 3, 4, 5, 6, 7, 8, 12])("%i clubs: everybody meets everybody once per cycle", (n) => {
    const ids = clubs(n);
    const weeks = n % 2 === 0 ? n - 1 : n;
    const met = new Map<string, number>();
    const byes = new Map<string, number>();

    for (let w = 0; w < weeks; w += 1) {
      const { meetings, bye } = leagueWeekMeetings(ids, w);
      const playing = meetings.flat();
      expect(new Set(playing).size, `week ${w}: a club twice`).toBe(playing.length);
      expect(meetings.length).toBe(Math.floor(n / 2));
      if (n % 2 === 0) expect(bye).toBeNull();
      else {
        expect(bye).not.toBeNull();
        expect(playing).not.toContain(bye);
        byes.set(bye!, (byes.get(bye!) ?? 0) + 1);
      }
      for (const [a, b] of meetings) met.set(key(a, b), (met.get(key(a, b)) ?? 0) + 1);
    }

    expect(met.size).toBe((n * (n - 1)) / 2);
    expect([...met.values()].every((v) => v === 1)).toBe(true);
    // An odd league: each club sits out exactly once, not one club every week.
    if (n % 2 === 1) {
      expect(byes.size).toBe(n);
      expect([...byes.values()].every((v) => v === 1)).toBe(true);
    }
  });

  it("goes round again in the same order after a full cycle", () => {
    const ids = clubs(12);
    expect(leagueWeekMeetings(ids, 11)).toEqual(leagueWeekMeetings(ids, 0));
    expect(leagueWeekMeetings(ids, 14)).toEqual(leagueWeekMeetings(ids, 3));
  });

  it("differs week to week — week 2 is not week 1 again", () => {
    const ids = clubs(12);
    const w = (i: number) => leagueWeekMeetings(ids, i).meetings.map(([a, b]) => key(a, b)).sort();
    expect(w(1)).not.toEqual(w(0));
  });

  it("draws nothing for a league of one, and says who is left", () => {
    expect(leagueWeekMeetings(["solo"], 0)).toEqual({ meetings: [], bye: "solo" });
    expect(leagueWeekMeetings([], 0)).toEqual({ meetings: [], bye: null });
  });
});

describe("drawMeeting", () => {
  it("plays first pair against first pair, in the order each club listed them", () => {
    expect(drawMeeting(["a1", "a2", "a3"], ["b1", "b2", "b3"])).toEqual({
      matches: [
        ["a1", "b1"],
        ["a2", "b2"],
        ["a3", "b3"],
      ],
      unmatched: [],
    });
  });

  it("leaves the extra pairs out and names them, rather than doubling anyone up", () => {
    expect(drawMeeting(["a1", "a2", "a3"], ["b1"])).toEqual({
      matches: [["a1", "b1"]],
      unmatched: ["a2", "a3"],
    });
    expect(drawMeeting([], ["b1", "b2"])).toEqual({ matches: [], unmatched: ["b1", "b2"] });
  });
});
