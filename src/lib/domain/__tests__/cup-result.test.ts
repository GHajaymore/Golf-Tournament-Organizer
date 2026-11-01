import { describe, expect, it } from "vitest";
import {
  cupFinishingPositions,
  cupResultNote,
  cupResultOf,
  cupTally,
  cupVerdict,
  type CupMatchInput,
  type CupSide,
} from "../cup";
import { suggestCupChampion } from "../honours";
import type { HoleResult } from "../types";

/**
 * A TEAM CUP'S RESULT, worked from the RULES of match play rather than from
 * the code's own tally: each match is one point, won outright by the side that
 * leads by more holes than remain (Rule 3.2a(3)), and a match all square after
 * the last hole is halved — half a point to each team. The expected score in
 * every case is counted here by hand from the list of results, never from
 * `cupTally`.
 *
 * Why this reader exists: /reports, the honours board and the season asked the
 * round-robin standings about a cup, which hold nothing for one — a completed
 * cup printed every player at P0 W0 ½0 L0 and "No ranked results yet".
 */

/** A decided match card: `w` wins 3&2 (four holes up after 16), or a halve over 18. */
const decided = (w: CupSide | "H"): CupMatchInput => {
  if (w === "H") return { holes: ["A", "B", ...Array<HoleResult>(16).fill("H")], conceded: null };
  return { holes: [...Array<HoleResult>(3).fill(w), ...Array<HoleResult>(13).fill("H"), null, null], conceded: null };
};
const unplayed: CupMatchInput = { holes: Array<HoleResult>(18).fill(null), conceded: null };

/** Counted by hand: a point a win, a half a halve. */
function byHand(results: Array<CupSide | "H">): [number, number] {
  let a = 0;
  let b = 0;
  for (const r of results) {
    if (r === "A") a += 1;
    else if (r === "B") b += 1;
    else {
      a += 0.5;
      b += 0.5;
    }
  }
  return [a, b];
}

const teams = (aPlayers: string[], bPlayers: string[]) =>
  [
    { id: "zz-team-oak", name: "Oakmere", players: aPlayers.map((n) => ({ id: `p-${n}`, name: n })) },
    { id: "zz-team-elm", name: "Elmbridge", players: bPlayers.map((n) => ({ id: `p-${n}`, name: n })) },
  ] as const;

function resultOf(results: Array<CupSide | "H">, holder: CupSide | null = null, extra: CupMatchInput[] = []) {
  const tally = cupTally([...results.map(decided), ...extra]);
  return cupResultOf({
    teams: [...teams(["Ann", "Bea"], ["Cal", "Dee", "Eve"])],
    tally,
    verdict: cupVerdict(tally, 0, holder),
    holder,
  });
}

describe("a cup of ten matches won 6½–3½", () => {
  // Six to Oakmere, three to Elmbridge, one halved — in a jumbled order.
  const results: Array<CupSide | "H"> = ["B", "A", "A", "H", "A", "B", "A", "A", "B", "A"];
  const r = resultOf(results);

  it("each team's points are a point a win and half a halve", () => {
    expect(byHand(results)).toEqual([6.5, 3.5]);
    expect([r.teams[0].points, r.teams[1].points]).toEqual(byHand(results));
  });

  it("names the team that reached 5½ of 10 as the champion, winner first in the score", () => {
    expect(r.outcome).toBe("won");
    expect(r.champion).toBe("A");
    expect(r.scoreLine).toBe("Oakmere 6½–3½");
    expect(cupResultNote(r)).toContain("Oakmere won the cup 6½–3½");
  });

  it("the other way round, the score is still written winner first", () => {
    const flipped = resultOf(results.map((x) => (x === "A" ? "B" : x === "B" ? "A" : x)));
    expect(flipped.champion).toBe("B");
    expect(flipped.scoreLine).toBe("Elmbridge 6½–3½");
  });

  it("the season places the winning team's players level first and the others level below them", () => {
    const pos = cupFinishingPositions(r);
    expect(pos.filter((p) => p.rank === 1).map((p) => p.name).sort()).toEqual(["Ann", "Bea"]);
    // Below BOTH winners: two share first, so the next place is third.
    expect(pos.filter((p) => p.rank === 3).map((p) => p.name).sort()).toEqual(["Cal", "Dee", "Eve"]);
    expect(pos).toHaveLength(5);
  });

  it("the honours board names the TEAM with its score", () => {
    const s = suggestCupChampion(true, r);
    expect(s).toMatchObject({ ok: true, playerId: "zz-team-oak", name: "Oakmere", team: { score: "Oakmere 6½–3½" } });
  });

  it("CONTROL: an unfinished tournament names nobody yet", () => {
    expect(suggestCupChampion(false, r)).toMatchObject({ ok: false, reason: "not-completed" });
  });
});

describe("a halved cup crowns nobody", () => {
  // Four each and two halved: 5–5.
  const results: Array<CupSide | "H"> = ["A", "B", "H", "A", "B", "A", "B", "H", "B", "A"];

  it("is 5–5 by hand, and says it was halved", () => {
    expect(byHand(results)).toEqual([5, 5]);
    const r = resultOf(results);
    expect(r.outcome).toBe("halved");
    expect(r.champion).toBeNull();
    expect(r.scoreLine).toBe("Halved 5–5");
  });

  it("with a holder, the holder keeps the cup and is STILL not crowned", () => {
    const r = resultOf(results, "B");
    expect(r.outcome).toBe("halved");
    expect(r.champion).toBeNull();
    expect(cupResultNote(r)).toContain("Elmbridge keep the cup as holders");
    expect(suggestCupChampion(true, r)).toMatchObject({ ok: false, reason: "cup-halved" });
  });

  it("the season places everybody who played level first", () => {
    const pos = cupFinishingPositions(resultOf(results));
    expect(pos.map((p) => p.rank)).toEqual([1, 1, 1, 1, 1]);
  });

  it("the honours board refuses it", () => {
    expect(suggestCupChampion(true, resultOf(results))).toMatchObject({ ok: false, reason: "cup-halved" });
  });
});

describe("a cup not yet decided", () => {
  // 4–3 with three matches unplayed: nobody has 5½.
  const r = resultOf(["A", "A", "B", "A", "B", "A", "B"], null, [unplayed, unplayed, unplayed]);

  it("is open, names no champion and places nobody", () => {
    expect(r.outcome).toBe("open");
    expect(r.champion).toBeNull();
    expect(r.scoreLine).toBe("Oakmere 4–3 Elmbridge");
    expect(cupFinishingPositions(r)).toEqual([]);
    expect(suggestCupChampion(true, r)).toMatchObject({ ok: false, reason: "cup-open" });
    expect(cupResultNote(r)).toContain("3 of 10 points still to be decided");
  });

  it("CONTROL: once a team has 5½ it is won, even with matches still out", () => {
    const won = resultOf(["A", "A", "A", "A", "A", "H"], null, [unplayed, unplayed, unplayed, unplayed]);
    expect(won.outcome).toBe("won");
    expect(won.scoreLine).toBe("Oakmere 5½–½");
  });
});
