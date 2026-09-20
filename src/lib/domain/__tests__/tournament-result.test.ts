import { describe, it, expect } from "vitest";
import { tournamentResult, resultSummary, type RoundOutcome } from "../tournament-result";

/**
 * WHAT HAPPENED TODAY, WHATEVER THEY PLAYED.
 *
 * Ajay, 2026-09-19: "just make it as a standard outing result but cater for
 * all kind of ask or what they play". The day that provoked it is the one in
 * `the-society-outing.test.ts` — forty players, a two-team stroke-play nine, a
 * pairs match-play nine and an individual round — where each round already had
 * a board and nothing said how the day went.
 *
 * Asserted against what a club would print on the noticeboard, not against
 * what the code does: a match has a margin and no score, a medal has a score
 * and no margin, and a tie is shared rather than broken.
 */

describe("the outing result", () => {
  it("prints each round in the words that round uses", () => {
    const day: RoundOutcome[] = [
      { kind: "team", label: "Front nine — two teams", winners: [{ name: "The Ridge", score: "−4" }] },
      {
        kind: "match",
        label: "Back nine — pairs match play",
        winner: "Okafor & Lindqvist",
        loser: "Brennan & Sato",
        margin: "5&4",
      },
      {
        kind: "stroke",
        label: "Round 2 — individuals",
        winners: [{ name: "Marnie Colquhoun", score: "71" }],
        unit: "net",
      },
    ];
    expect(tournamentResult(day)).toEqual([
      { label: "Front nine — two teams", result: "The Ridge · −4", settled: true },
      {
        label: "Back nine — pairs match play",
        result: "Okafor & Lindqvist beat Brennan & Sato 5&4",
        settled: true,
      },
      { label: "Round 2 — individuals", result: "Marnie Colquhoun · 71 net", settled: true },
    ]);
  });

  it("shares a tie rather than breaking it", () => {
    // Two players level is two winners. Picking one here would overrule the
    // tiebreak the committee set — and the score is printed once, because a
    // shared place is shared BY the score.
    const [line] = tournamentResult([
      {
        kind: "stroke",
        label: "Medal",
        winners: [{ name: "Ada", score: "70" }, { name: "Bo", score: "70" }],
        unit: "net",
      },
    ]);
    expect(line.result).toBe("Tied: Ada and Bo · 70 net");
    // Three share it the way a noticeboard writes it, not with a trailing comma.
    const [three] = tournamentResult([
      {
        kind: "stroke",
        label: "Medal",
        winners: [{ name: "Ada", score: "70" }, { name: "Bo", score: "70" }, { name: "Cy", score: "70" }],
        unit: "net",
      },
    ]);
    expect(three.result).toBe("Tied: Ada, Bo and Cy · 70 net");
    expect(line.settled).toBe(true);
  });

  it("says halved without inventing a winner", () => {
    const [line] = tournamentResult([
      { kind: "match", label: "Singles", winner: "", loser: "Kim", margin: "halved" },
    ]);
    expect(line.result).toContain("halved");
    expect(line.result).not.toContain("beat");
    expect(line.settled).toBe(true);
  });

  it("carries a hand-scored round's own words", () => {
    /**
     * A format the app refuses to score is not a hole in the result — the
     * committee decides it, and what they posted IS the result. Same rule as
     * `standingRows` returning [] for a manual format rather than guessing.
     */
    const [posted, unposted] = tournamentResult([
      { kind: "manual", label: "Greensomes", note: "Ellis & Ferrari, 42 points" },
      { kind: "manual", label: "Scramble", note: "" },
    ]);
    expect(posted.result).toBe("Ellis & Ferrari, 42 points");
    expect(posted.settled).toBe(true);
    // Nothing posted is not a result, and saying so is the honest answer.
    expect(unposted.settled).toBe(false);
    expect(unposted.result).toContain("committee");
  });

  it("says what is still out rather than leaving a blank", () => {
    const [line] = tournamentResult([{ kind: "pending", label: "Round 3" }]);
    expect(line.result).toBe("Not settled yet");
    expect(line.settled).toBe(false);
  });

  it("keeps the caller's order, because a day reads forwards", () => {
    const labels = tournamentResult([
      { kind: "pending", label: "Round 3" },
      { kind: "stroke", label: "Round 1", winners: [{ name: "Ada" }] },
    ]).map((l) => l.label);
    expect(labels).toEqual(["Round 3", "Round 1"]);
  });

  it("handles a round with a winner and no score to show", () => {
    // A format with no number a member would recognise — the name is the whole
    // result, and a dangling separator would look like a missing value.
    const [line] = tournamentResult([{ kind: "stroke", label: "Beat the pro", winners: [{ name: "Ada" }] }]);
    expect(line.result).toBe("Ada");
  });

  it("summarises the day by counting, never by concluding", () => {
    /**
     * "3 rounds · 2 settled" is true of any combination of games. "The winner
     * was…" is only true of a day that had one, and this day did not: a team
     * nine, a match and a medal cannot be added together.
     */
    const lines = tournamentResult([
      { kind: "team", label: "A", winners: [{ name: "The Ridge" }] },
      { kind: "match", label: "B", winner: "X", loser: "Y", margin: "2&1" },
      { kind: "pending", label: "C" },
    ]);
    expect(resultSummary(lines)).toBe("3 rounds · 2 settled");
    expect(resultSummary(tournamentResult([]))).toBe("Nothing played yet");
    expect(resultSummary(lines.slice(0, 2))).toBe("2 rounds · all settled");
    expect(resultSummary([lines[2]])).toBe("1 round · nothing settled yet");
  });
});
