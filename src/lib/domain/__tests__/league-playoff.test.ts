import { describe, it, expect } from "vitest";
import {
  bracketSeeds,
  meetingWinner,
  needsPlayoffHole,
  playoffBracket,
  playoffChampion,
  playoffRoundCount,
  playoffRoundName,
  splitSeason,
  type MeetingOutcome,
} from "../league-playoff";

const done = (clubA: string, clubB: string, pointsA: number, pointsB: number): MeetingOutcome => ({
  clubA,
  clubB,
  pointsA,
  pointsB,
  complete: true,
});

describe("the bracket", () => {
  it("keeps the top two seeds apart until the final", () => {
    expect(bracketSeeds(2)).toEqual([[1, 2]]);
    expect(bracketSeeds(4)).toEqual([
      [1, 4],
      [2, 3],
    ]);
    expect(bracketSeeds(8)).toEqual([
      [1, 8],
      [4, 5],
      [2, 7],
      [3, 6],
    ]);
  });

  it("uses every seed exactly once, and every first-round pair sums to size + 1", () => {
    for (const size of [2, 4, 8]) {
      const flat = bracketSeeds(size).flat();
      expect([...flat].sort((a, b) => a - b)).toEqual(Array.from({ length: size }, (_, i) => i + 1));
      for (const [a, b] of bracketSeeds(size)) expect(a + b).toBe(size + 1);
    }
  });

  it("counts and names the rounds back from the final", () => {
    expect([0, 2, 4, 8, 3, 16].map(playoffRoundCount)).toEqual([0, 1, 2, 3, 0, 0]);
    expect([0, 1, 2].map((r) => playoffRoundName(r, 3))).toEqual([
      "Quarter-finals",
      "Semi-finals",
      "Final",
    ]);
    expect(playoffRoundName(0, 1)).toBe("Final");
  });
});

describe("splitting the season", () => {
  const weeks = ["w1", "w2", "w3", "w4", "w5", "w6"];

  it("takes the play-offs off the end", () => {
    expect(splitSeason(weeks, 4)).toEqual({ season: ["w1", "w2", "w3", "w4"], playoffs: ["w5", "w6"] });
    expect(splitSeason(weeks, 2)).toEqual({ season: weeks.slice(0, 5), playoffs: ["w6"] });
    expect(splitSeason(weeks, 0)).toEqual({ season: weeks, playoffs: [] });
  });

  it("has no play-offs until there is a season before them", () => {
    expect(splitSeason(["w1", "w2"], 4)).toEqual({ season: ["w1", "w2"], playoffs: [] });
    expect(splitSeason(["w1", "w2", "w3"], 4).playoffs).toEqual(["w2", "w3"]);
  });

  it("ignores a size that is not a play-off size", () => {
    expect(splitSeason(weeks, 6)).toEqual({ season: weeks, playoffs: [] });
  });
});

describe("who goes through", () => {
  const m = { seedA: 1, seedB: 4, clubA: "one", clubB: "four" };

  it("more points wins, whichever way round the outcome was stored", () => {
    expect(meetingWinner(m, done("one", "four", 2, 4))).toBe("four");
    expect(meetingWinner(m, done("four", "one", 2, 4))).toBe("one");
  });

  it("sends nobody through on a level meeting until the play-off hole is recorded", () => {
    /**
     * Ajay, 2026-09-18: a tie is settled by a play-off hole. It used to go
     * to the higher seed, which is somebody else's rule — and the seeding
     * cannot be allowed to answer a question the course answers.
     */
    const level = done("one", "four", 3, 3);
    expect(meetingWinner(m, level), "invented a winner from the seeding").toBeNull();
    expect(needsPlayoffHole(m, level)).toBe(true);

    // Recorded either way round, and it decides.
    expect(meetingWinner(m, { ...level, holeWinner: "four" })).toBe("four");
    expect(meetingWinner(m, { ...level, holeWinner: "one" })).toBe("one");
    expect(needsPlayoffHole(m, { ...level, holeWinner: "one" })).toBe(false);
  });

  it("ignores a recorded winner that is not one of the two clubs", () => {
    // A stored id naming somebody else decides nothing rather than sending
    // a club that did not play through.
    const level = { ...done("one", "four", 3, 3), holeWinner: "seven" };
    expect(meetingWinner(m, level)).toBeNull();
    expect(needsPlayoffHole(m, level)).toBe(true);
  });

  it("does not ask for a play-off hole on a meeting that is still out", () => {
    // Unresolved for a different reason: nothing to settle yet.
    const out = { ...done("one", "four", 3, 3), complete: false };
    expect(needsPlayoffHole(m, out)).toBe(false);
    expect(needsPlayoffHole(m, undefined)).toBe(false);
  });

  it("nobody, while the meeting is still out", () => {
    expect(meetingWinner(m, { ...done("one", "four", 5, 0), complete: false })).toBeNull();
    expect(meetingWinner(m, undefined)).toBeNull();
  });
});

describe("the whole bracket", () => {
  const seeded = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"];

  it("knows only the first round until results come in", () => {
    const b = playoffBracket(seeded, 8, []);
    expect(b.map((r) => r.name)).toEqual(["Quarter-finals", "Semi-finals", "Final"]);
    expect(b[0].meetings.map((m) => m && `${m.clubA}v${m.clubB}`)).toEqual([
      "s1vs8",
      "s4vs5",
      "s2vs7",
      "s3vs6",
    ]);
    expect(b[1].meetings).toEqual([null, null]);
    expect(b[2].meetings).toEqual([null]);
  });

  it("advances winners in bracket order, and upsets carry their own seed", () => {
    const qf = [
      done("s1", "s8", 4, 2),
      done("s4", "s5", 1, 5), // upset: 5 goes through
      { ...done("s2", "s7", 3, 3), holeWinner: "s7" }, // level, settled on the hole
      { ...done("s3", "s6", 0, 0), complete: false }, // still out
    ];
    const b = playoffBracket(seeded, 8, [qf]);
    expect(b[1].meetings[0]).toEqual({ seedA: 1, seedB: 5, clubA: "s1", clubB: "s5" });
    // The other semi waits for 3 v 6.
    expect(b[1].meetings[1]).toBeNull();
    expect(b[2].meetings).toEqual([null]);
  });

  it("crowns a champion from a four-club bracket", () => {
    const four = ["a", "b", "c", "d"];
    const sf = [done("a", "d", 2, 4), done("b", "c", 5, 1)];
    const b = playoffBracket(four, 4, [sf]);
    expect(b[1].meetings[0]).toEqual({ seedA: 4, seedB: 2, clubA: "d", clubB: "b" });
    // Level, and nobody has played the hole yet: no champion.
    expect(playoffChampion(b, [done("b", "d", 3, 3)])).toBeNull();
    expect(playoffChampion(b, [{ ...done("b", "d", 3, 3), holeWinner: "d" }])).toBe("d");
    expect(playoffChampion(b, [done("b", "d", 1, 3)])).toBe("d");
    expect(playoffChampion(b, [])).toBeNull();
  });

  it("draws nothing when there are fewer clubs than places", () => {
    expect(playoffBracket(["a", "b", "c"], 4, [])).toEqual([]);
    expect(playoffBracket(seeded, 0, [])).toEqual([]);
  });
});

describe("a committee decision", () => {
  const m = { seedA: 1, seedB: 4, clubA: "one", clubB: "four" };

  it("overturns a played result, but only when it says it is an override", () => {
    /**
     * Ajay, 2026-09-18: the option is wanted, with caution. So an override is
     * the FLAG the organizer set while being told what they were overturning,
     * never inferred from a recorded winner that merely disagrees with the
     * points — which would turn a mistyped play-off hole into a reversal.
     */
    const played = done("one", "four", 5, 1); // one won outright
    expect(meetingWinner(m, { ...played, holeWinner: "four" }), "reversed without being told to").toBe("one");
    expect(meetingWinner(m, { ...played, holeWinner: "four", overrode: true })).toBe("four");
  });

  it("still refuses a club that did not play the meeting", () => {
    const played = done("one", "four", 5, 1);
    expect(meetingWinner(m, { ...played, holeWinner: "seven", overrode: true })).toBe("one");
  });

  it("does not ask for a play-off hole once a decision is recorded", () => {
    const level = done("one", "four", 3, 3);
    expect(needsPlayoffHole(m, { ...level, holeWinner: "four", overrode: true })).toBe(false);
  });
});
