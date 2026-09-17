import { describe, it, expect } from "vitest";
import {
  bracketSeeds,
  meetingWinner,
  playoffBracket,
  playoffChampion,
  playoffRoundCount,
  playoffRoundName,
  seedOrder,
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

describe("seeding", () => {
  it("orders by points, then meetings won, then name", () => {
    const rows = [
      { clubId: "a", name: "Zeta", points: 10, won: 3 },
      { clubId: "b", name: "Alpha", points: 12, won: 2 },
      { clubId: "c", name: "Beta", points: 10, won: 4 },
      { clubId: "d", name: "Gamma", points: 10, won: 3 },
    ];
    expect(seedOrder(rows).map((r) => r.clubId)).toEqual(["b", "c", "d", "a"]);
  });
});

describe("who goes through", () => {
  const m = { seedA: 1, seedB: 4, clubA: "one", clubB: "four" };

  it("more points wins, whichever way round the outcome was stored", () => {
    expect(meetingWinner(m, done("one", "four", 2, 4))).toBe("four");
    expect(meetingWinner(m, done("four", "one", 2, 4))).toBe("one");
  });

  it("a level meeting goes to the higher seed", () => {
    expect(meetingWinner(m, done("one", "four", 3, 3))).toBe("one");
    expect(meetingWinner({ ...m, seedA: 4, seedB: 1, clubA: "four", clubB: "one" }, done("one", "four", 3, 3))).toBe(
      "one",
    );
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
      done("s2", "s7", 3, 3), // level: the higher seed, 2
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
    expect(playoffChampion(b, [done("b", "d", 3, 3)])).toBe("b");
    expect(playoffChampion(b, [done("b", "d", 1, 3)])).toBe("d");
    expect(playoffChampion(b, [])).toBeNull();
  });

  it("draws nothing when there are fewer clubs than places", () => {
    expect(playoffBracket(["a", "b", "c"], 4, [])).toEqual([]);
    expect(playoffBracket(seeded, 0, [])).toEqual([]);
  });
});
