import { describe, it, expect } from "vitest";
import { teamMatchStandings, type TeamMatchPairing } from "../team-match-standings";
import type { HoleResult } from "../types";

/**
 * A ROUND ROBIN OF TEAM MATCHES IS DECIDED ON THE MATCHES.
 *
 * The defect this replaces, measured on a four-ball round robin built so the
 * two possible answers differ — a side winning holes 1-10 and taking fifteen
 * on the last:
 *
 *     Four-Ball · 2 sides · lowest net wins.
 *     1  lower-total       72   E
 *     2  wins-the-match    77
 *
 * The side that won 10&8 was placed second, because `boardKind` asks the
 * FORMAT and a team format lands on the team stroke board whatever stage it is
 * on. Every match result in the round was thrown away.
 *
 * These assert the RULES rather than the implementation: one point a win and a
 * half each for a half is what a club does, and it is what
 * `league-meeting.ts` already calls the simplest of the four systems.
 */

/** A card A wins by `by` holes with `left` to play — so `by`&`left`. */
function closeout(by: number, left: number, total = 18): HoleResult[] {
  const played = total - left;
  const out: HoleResult[] = [];
  for (let i = 0; i < played; i += 1) out.push(i < by ? "A" : "H");
  for (let i = 0; i < left; i += 1) out.push(null);
  return out;
}

const halvedCard = (total = 18): HoleResult[] => new Array(total).fill("H");
const undrawn = (total = 18): HoleResult[] => new Array(total).fill(null);

const pairing = (teamAId: string, teamBId: string, holes: HoleResult[]): TeamMatchPairing => ({
  teamAId,
  teamBId,
  holes,
});

describe("a round robin of team matches", () => {
  it("ranks the side that won the match above the side with the lower total", () => {
    // THE DEFECT ITSELF. Strokes do not enter into it: the only thing here is
    // who won holes, and the winner must come first.
    const rows = teamMatchStandings(
      ["wins-the-match", "lower-total"],
      [pairing("wins-the-match", "lower-total", closeout(10, 8))],
    );
    expect(rows[0].teamId).toBe("wins-the-match");
    expect(rows[0].points).toBe(1);
    expect(rows[1].teamId).toBe("lower-total");
    expect(rows[1].points).toBe(0);
  });

  it("gives a half a point each way", () => {
    const rows = teamMatchStandings(["a", "b"], [pairing("a", "b", halvedCard())]);
    expect(rows.map((r) => r.points)).toEqual([0.5, 0.5]);
    expect(rows.map((r) => r.halved)).toEqual([1, 1]);
    // Level on everything, so they share the place rather than one being
    // arbitrarily first.
    expect(rows.map((r) => r.rank)).toEqual([1, 1]);
  });

  it("counts a pairing nobody has started for nobody", () => {
    /*
     * THE CONTROL, and it is the one that matters. `resolveMatch` calls an
     * empty card complete AND halved — there are no holes left to play — so a
     * freshly drawn round robin would otherwise hand every side half a point
     * and crown somebody before a ball was struck. That exact symptom was seen
     * on a real board: every player "P 1, ½ 1" with nothing entered.
     */
    const rows = teamMatchStandings(["a", "b"], [pairing("a", "b", undrawn())]);
    expect(rows.map((r) => r.points)).toEqual([0, 0]);
    expect(rows.map((r) => r.played)).toEqual([0, 0]);
    expect(rows.map((r) => r.halved)).toEqual([0, 0]);
  });

  it("separates sides level on points by the holes the matches produced", () => {
    // Both win one and lose one, so both are on a point. A won its by more.
    const rows = teamMatchStandings(
      ["a", "b", "c", "d"],
      [
        pairing("a", "b", closeout(6, 4)),
        pairing("c", "d", closeout(2, 1)),
        pairing("b", "a", closeout(2, 1)),
        pairing("d", "c", closeout(6, 4)),
      ],
    );
    const points = new Map(rows.map((r) => [r.teamId, r.points]));
    expect(points.get("a")).toBe(1);
    expect(points.get("d")).toBe(1);
    // A beat B 6&4 and lost 2&1, so it is +4 on holes; D is the same. B and C
    // are the mirror at -4, and must finish behind.
    const order = rows.map((r) => r.teamId);
    expect(order.slice(0, 2).sort()).toEqual(["a", "d"]);
    expect(order.slice(2).sort()).toEqual(["b", "c"]);
  });

  it("does not credit the holes a closeout never played", () => {
    /*
     * Rule 3.2a(3): a match ends when a side leads by more holes than remain.
     * 10&8 means eight holes nobody walked, and a system paying for them would
     * reward conceding. `resolveMatch` counts only what was played, and this
     * pins that it still does when the result is read for a standing.
     */
    const rows = teamMatchStandings(["a", "b"], [pairing("a", "b", closeout(10, 8))]);
    expect(rows[0].holesDiff).toBe(10);
    expect(rows[1].holesDiff).toBe(-10);
  });

  it("honours a club that counts holes instead of matches", () => {
    /*
     * The customization, and the reason the system is an argument. Under
     * "holes" a 1-hole win is worth far less than a thrashing, which is the
     * whole point of a club choosing it — so the ORDER can differ from the
     * match system on the same results.
     */
    const played = [
      pairing("thrashed-them", "x", closeout(6, 4)),
      pairing("squeaked-it", "y", closeout(1, 0)),
    ];
    const byMatch = teamMatchStandings(["thrashed-them", "squeaked-it", "x", "y"], played, "match");
    const byHoles = teamMatchStandings(["thrashed-them", "squeaked-it", "x", "y"], played, "holes");

    // Both won a match, so match play cannot separate them on points.
    const m = new Map(byMatch.map((r) => [r.teamId, r.points]));
    expect(m.get("thrashed-them")).toBe(1);
    expect(m.get("squeaked-it")).toBe(1);

    // Counting holes, the thrashing is worth more — a different answer from
    // the same results, which is what makes it a real setting.
    const h = new Map(byHoles.map((r) => [r.teamId, r.points]));
    expect(h.get("thrashed-them")!).toBeGreaterThan(h.get("squeaked-it")!);
    expect(byHoles[0].teamId).toBe("thrashed-them");
  });

  it("puts a side that has played nothing last, whatever the arithmetic says", () => {
    // Zero points sorts above nobody: a side yet to play must not appear to be
    // beating one that has lost. The same rule `teamStandings` applies to a
    // side with no card.
    const rows = teamMatchStandings(
      ["played-and-lost", "not-out-yet"],
      [pairing("played-and-lost", "someone", closeout(3, 2)), pairing("someone", "played-and-lost", closeout(5, 3))],
    );
    const last = rows[rows.length - 1];
    expect(last.teamId).toBe("not-out-yet");
    expect(last.played).toBe(0);
  });
});
