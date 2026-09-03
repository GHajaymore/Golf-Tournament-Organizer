import { describe, it, expect } from "vitest";
import { seasonStandings, type RoundStanding } from "../season";

/**
 * A season table compares sides who played different numbers of weeks.
 *
 * The function's own note says a round nobody played is not a zero, and stops
 * it being summed as one. That fixed half of it. SKIPPING a round has the same
 * effect on a raw ascending total as adding a zero would — the side with fewer
 * rounds carries the smaller number — so on a net table the league was won by
 * turning up least.
 */

const side = (teamId: string, over: Partial<RoundStanding> = {}): RoundStanding => ({
  teamId,
  name: teamId,
  members: [],
  gross: 76,
  net: 70,
  points: 34,
  played: 18,
  toPar: 4,
  ...over,
});

/** The same side, the same score, `weeks` times over. */
const weeks = (teamId: string, n: number, over: Partial<RoundStanding> = {}) =>
  Array.from({ length: n }, () => [side(teamId, over)]);

/** Interleave several sides' weeks into rounds the way a league is played. */
const league = (entries: Array<{ id: string; n: number; over?: Partial<RoundStanding> }>) => {
  const rounds: RoundStanding[][] = [];
  const most = Math.max(...entries.map((e) => e.n));
  for (let w = 0; w < most; w += 1) {
    const round = entries.filter((e) => w < e.n).map((e) => side(e.id, e.over));
    if (round.length) rounds.push(round);
  }
  return rounds;
};

describe("a net season table", () => {
  it("does not put the side that played once above the side that played six", () => {
    /**
     * The audit's own case. Six identical weeks of net 70 is a season total of
     * 420; one week of net 70 is 70. On the raw sum the absentee wins by 350.
     */
    const rounds = league([
      { id: "played-six", n: 6 },
      { id: "played-once", n: 1 },
    ]);
    const table = seasonStandings(rounds, "net");

    const rankOf = (id: string) => table.find((r) => r.teamId === id)!.rank;
    // Identical golf, so neither is above the other.
    expect(rankOf("played-six")).toBe(rankOf("played-once"));
    expect(table.find((r) => r.teamId === "played-six")!.roundsPlayed).toBe(6);
    expect(table.find((r) => r.teamId === "played-once")!.roundsPlayed).toBe(1);
  });

  it("ranks the side that actually scored better first, whatever the attendance", () => {
    const rounds = league([
      { id: "better-fewer", n: 2, over: { net: 68 } },
      { id: "worse-more", n: 6, over: { net: 74 } },
    ]);
    const table = seasonStandings(rounds, "net");
    expect(table[0].teamId).toBe("better-fewer");
  });

  it("ranks the side that played more first when they also scored better", () => {
    // The direction the raw sum got backwards: 6 × 68 = 408 against 1 × 74.
    const rounds = league([
      { id: "better-more", n: 6, over: { net: 68 } },
      { id: "worse-fewer", n: 1, over: { net: 74 } },
    ]);
    const table = seasonStandings(rounds, "net");
    expect(table[0].teamId).toBe("better-more");
  });

  it("still reports the totals, so a reader can see the sample", () => {
    // The averages decide the order; the sums are still the season's record,
    // and `roundsPlayed` is what says the two are not over the same weeks.
    const table = seasonStandings(weeks("solo", 3), "net");
    const row = table[0];
    expect(row.net).toBe(210);
    expect(row.roundsPlayed).toBe(3);
    expect(row.netPerRound).toBe(70);
  });

  it("leaves a side with no card at all at the bottom", () => {
    // An average of nothing is not a good round. They are sorted out
    // separately rather than dividing by zero.
    const rounds: RoundStanding[][] = [
      [side("played"), side("absent", { played: 0, gross: 0, net: 0, points: 0, toPar: 0 })],
    ];
    const table = seasonStandings(rounds, "net");
    expect(table[table.length - 1].teamId).toBe("absent");
    expect(table.find((r) => r.teamId === "absent")!.netPerRound).toBe(0);
  });
});

describe("a stableford season table", () => {
  it("still rewards turning up, because higher is better there", () => {
    /**
     * The asymmetry, stated as a test so nobody "fixes" it into symmetry. A
     * points table counts upwards, so a raw sum already means a side that
     * played six weeks beats one that played its best week and stopped.
     * Averaging here would hand the season to the absentee — the same bug in
     * the opposite direction.
     */
    const rounds = league([
      { id: "played-six", n: 6, over: { points: 30 } },
      { id: "played-once", n: 1, over: { points: 40 } },
    ]);
    const table = seasonStandings(rounds, "stableford");
    expect(table[0].teamId).toBe("played-six");
    expect(table[0].points).toBe(180);
  });
});

describe("the ranks the board prints", () => {
  it("gives two genuinely level sides the same rank and skips the next", () => {
    const rounds = league([
      { id: "a", n: 2 },
      { id: "b", n: 2 },
      { id: "c", n: 2, over: { net: 80 } },
    ]);
    const table = seasonStandings(rounds, "net");
    const rankOf = (id: string) => table.find((r) => r.teamId === id)!.rank;
    expect(rankOf("a")).toBe(1);
    expect(rankOf("b")).toBe(1);
    expect(rankOf("c")).toBe(3);
    expect(table.find((r) => r.teamId === "a")!.tied).toBe(true);
    expect(table.find((r) => r.teamId === "c")!.tied).toBe(false);
  });

  it("ties on the average, not on the total", () => {
    /**
     * The tie key has to read the same number the sort did. Level on average
     * over different weeks is a tie; the totals are miles apart, and keying on
     * those would sort them adjacent and then hand them separate ranks.
     */
    const rounds = league([
      { id: "three-weeks", n: 3 },
      { id: "six-weeks", n: 6 },
    ]);
    const table = seasonStandings(rounds, "net");
    expect(table[0].rank).toBe(1);
    expect(table[1].rank).toBe(1);
    expect(table[0].net).not.toBe(table[1].net);
  });
});
