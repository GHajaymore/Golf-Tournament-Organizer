import { describe, it, expect } from "vitest";
import { deriveNetHoles, resolveMatch, marginToHoles, matchStrokesGiven } from "@/lib/domain/match";
import { buildBracket } from "@/lib/domain/bracket";
import { applyNine, cleanNine } from "@/lib/services/course-resolution";
import type { HoleResult } from "@/lib/domain/types";

/**
 * The match-play defects found by the 2026-08-12 audit, each pinned so it
 * cannot come back.
 *
 * Every one of these shipped with a green suite. They are grouped by the thing
 * that was actually wrong rather than by file, because several screens shared
 * one root cause: a nine-hole round handed an eighteen-hole stroke index.
 */

const PAR_18 = [4, 5, 3, 4, 4, 4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 3, 4, 4];
// A real layout: odds on the front, evens on the back, not ascending by hole.
const SI_18 = [5, 11, 1, 15, 3, 17, 7, 13, 9, 10, 2, 16, 6, 12, 4, 18, 8, 14];
const card = (name: string) => ({
  name,
  city: "",
  pars: PAR_18,
  yards: new Array(18).fill(400),
  strokeIndex: SI_18,
  source: "event" as const,
});

describe("a nine-hole round is a nine-hole round", () => {
  it("re-ranks the nine's stroke indexes to 1..9", () => {
    // Sliced but not re-ranked, the back nine kept values 2,4,6…18 while every
    // consumer allocates on a base of nine — so a five-stroke player received
    // strokes on two holes instead of five.
    const back = applyNine(card("Bushwood"), "back", 9);
    expect([...back.strokeIndex].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    // Relative difficulty preserved: the 11th (SI 2 of 18) is the hardest.
    expect(back.strokeIndex[1]).toBe(1);
  });

  it("gives a player every stroke they are owed over the nine", () => {
    const back = applyNine(card("Bushwood"), "back", 9);
    const { toA } = matchStrokesGiven(14, 9, back.strokeIndex);
    expect(toA.reduce((n, s) => n + s, 0)).toBe(5);
  });

  it("lets a nine-hole match actually finish", () => {
    // The bug that killed the member-guest shape: deriveNetHoles sized itself
    // from the stroke index, so a nine-hole match came back as an eighteen-hole
    // match with nine unplayed. `absLead > remaining` was never true and the
    // match stayed Live forever — no result, no standings, no confirmation.
    const nine = applyNine(card("Bushwood"), "front", 9);
    const A = [4, 4, 3, 4, 4, 4, 3, 4, 5];
    const B = [5, 5, 4, 5, 5, 5, 4, 5, 6];
    const holes = deriveNetHoles(A, B, 0, 0, nine.strokeIndex, 9);
    expect(holes).toHaveLength(9);
    const res = resolveMatch(holes);
    expect(res.complete).toBe(true);
    expect(res.winner).toBe("A");
    expect(res.resultText).toBe("5&4");
  });

  it("still sizes from the card when no hole count is given", () => {
    // Sizing from the cards alone would be worse than the bug: a part-entered
    // card is short, and the match would call itself complete at the turn.
    const holes = deriveNetHoles([4, 4], [5, 5], 0, 0, SI_18);
    expect(holes).toHaveLength(18);
    expect(resolveMatch(holes).complete).toBe(false);
  });

  it("cleanNine refuses to guess at an unknown value", () => {
    expect(cleanNine("back")).toBe("back");
    expect(cleanNine("")).toBe("full");
    expect(cleanNine(null)).toBe("full");
    expect(cleanNine("BACK")).toBe("full");
  });
});

describe("a match is decided when it is decided, not at the 18th", () => {
  const H = (s: string) => s.split("").map((c) => (c === "-" ? null : c)) as HoleResult[];

  it("reports the closing margin even if the players played on", () => {
    // A is 3 up with 2 to play at the 16th — the match is over, 3&2. Under the
    // old reading, B winning 17 and 18 made this "1 UP".
    const r = resolveMatch(H("AAAHHHHHHHHHHHHHBB"));
    expect(r.resultText).toBe("3&2");
    expect(r.winner).toBe("A");
  });

  it("does not credit holes won after the match was over", () => {
    // holesWon feeds holes-won-ratio and fewest-holes-lost, so a beaten player
    // was being given a better differential for holes played after the finish.
    const r = resolveMatch(H("AAAHHHHHHHHHHHHHBB"));
    expect(r.holesWonA).toBe(3);
    expect(r.holesWonB).toBe(0);
    expect(r.played).toBe(16);
  });

  it("leaves a genuine 1 UP alone", () => {
    expect(resolveMatch(H("ABABABABABABABABAB")).resultText).toBe("AS");
    expect(resolveMatch(H("HHHHHHHHHHHHHHHHHA")).resultText).toBe("1 UP");
  });

  it("cannot close out past an undecided hole", () => {
    // Nothing after a hole with no result is known, so a gap must not let the
    // scan declare a winner from holes played later.
    const r = resolveMatch(H("AA-AAAAAAAAAAAAAAA"));
    expect(r.complete).toBe(false);
    expect(r.winner).toBeNull();
  });
});

describe("a reconstructed margin agrees with the margin it came from", () => {
  // marginToHoles put the winner's holes first, which built a card that
  // contradicted its own result: "2 UP" became two up with one to play, which
  // is a match that ended 2&1.
  for (const [winner, margin] of [
    ["A", "3&2"],
    ["B", "2 UP"],
    ["A", "1 UP"],
    ["B", "5&4"],
    ["A", "4&3"],
  ] as const) {
    it(`${margin} for ${winner} round-trips`, () => {
      const r = resolveMatch(marginToHoles(winner, margin, 18));
      expect(r.winner).toBe(winner);
      expect(r.resultText).toBe(margin);
    });
  }

  it("round-trips over nine holes too", () => {
    const r = resolveMatch(marginToHoles("A", "2 UP", 9));
    expect(r.resultText).toBe("2 UP");
    expect(r.winner).toBe("A");
  });
});

describe("a bracket only honours a winner who is in the match", () => {
  const players = Array.from({ length: 8 }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Player ${i + 1}`,
    handicap: i,
    seed: i + 1,
  }));

  it("discards a stored winner who is not one of the two slots", () => {
    // The plate rebuilds from the losers known so far, so a positional key like
    // consolation-0-1 can be a semi-final one minute and a quarter-final the
    // next. The stored winner was applied regardless, advancing a player out of
    // a match he was not in.
    const view = buildBracket("winners", players, { "winners-0-0": "p7" });
    const opening = view.rounds[0].matches[0];
    expect([opening.a.playerId, opening.b.playerId]).not.toContain("p7");
    expect(opening.winnerId).toBeNull();
  });

  it("still honours a legitimate winner", () => {
    const view = buildBracket("winners", players, { "winners-0-0": "p1" });
    const opening = view.rounds[0].matches[0];
    expect(opening.winnerId).toBe("p1");
  });

  it("never advances an unknown id", () => {
    const view = buildBracket("winners", players, { "winners-0-0": "nobody" });
    expect(view.rounds[0].matches[0].winnerId).toBeNull();
    expect(view.rounds[1].matches[0].a.playerId).toBeNull();
  });
});
