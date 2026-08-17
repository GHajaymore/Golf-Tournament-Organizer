import { describe, it, expect } from "vitest";
import { computeStandings } from "@/lib/domain/standings";
import { marginToHoles } from "@/lib/domain/match";
import { DEFAULT_SCORING } from "@/lib/domain/types";
import type { Player, Match, ScoringRules } from "@/lib/domain/types";

/**
 * A forfeit decides the match everywhere, not just in the points.
 *
 * `aggregateStats` always honoured one. The two tiebreakers went to the card
 * themselves, so a player who conceded while three up was reported as having
 * WON the meeting, and the holes the forfeit discards still counted towards
 * his differential. Both are the same mistake — asking the card a question the
 * forfeit has already answered — and both could put the quitter above the man
 * who stayed on the course.
 */

const player = (id: string, handicap = 10, seed = 1): Player => ({
  id, name: id.toUpperCase(), handicap, seed,
});

const match = (over: Partial<Match> & Pick<Match, "playerAId" | "playerBId">): Match =>
  ({
    id: `m-${over.playerAId}-${over.playerBId}`,
    stageId: "s",
    groupId: "g",
    round: 1,
    holes: marginToHoles("A", "2&1", 18),
    ...over,
  }) as Match;

/** Head-to-head first, so the meeting is what separates a tie. */
const H2H: ScoringRules = { ...DEFAULT_SCORING, tiebreakers: ["head-to-head"] };

describe("head-to-head reads the forfeit, not the card", () => {
  it("gives the meeting to the player who did not concede", () => {
    // A was three up and walked in. The card says A; the forfeit says B.
    const players = [player("a"), player("b")];
    const matches = [
      match({ playerAId: "a", playerBId: "b", holes: marginToHoles("A", "3&2", 18), forfeitedBy: "a" }),
    ];
    // Level them on points so only the head-to-head can separate them.
    const carried = { a: 100 - DEFAULT_SCORING.lossPts, b: 100 - DEFAULT_SCORING.winPts };
    const order = computeStandings(players, matches, H2H, carried).map((r) => r.player.id);
    expect(order).toEqual(["b", "a"]);
  });

  it("still reads a played match off the card", () => {
    // The control. Without it, "always rank B" would pass the test above.
    const players = [player("a"), player("b")];
    const matches = [match({ playerAId: "a", playerBId: "b", holes: marginToHoles("A", "3&2", 18) })];
    const carried = { a: 100 - DEFAULT_SCORING.winPts, b: 100 - DEFAULT_SCORING.lossPts };
    const order = computeStandings(players, matches, H2H, carried).map((r) => r.player.id);
    expect(order).toEqual(["a", "b"]);
  });

  it("ignores a forfeit naming somebody outside the match", () => {
    // A team round holds a team id here and leaves the player columns empty.
    // Guessing a side from an id that is not in the match would be worse than
    // reading the card.
    const players = [player("a"), player("b")];
    const matches = [
      match({ playerAId: "a", playerBId: "b", holes: marginToHoles("A", "3&2", 18), forfeitedBy: "team-7" }),
    ];
    const carried = { a: 100 - DEFAULT_SCORING.winPts, b: 100 - DEFAULT_SCORING.lossPts };
    const order = computeStandings(players, matches, H2H, carried).map((r) => r.player.id);
    expect(order).toEqual(["a", "b"]);
  });
});

describe("the toughest-holes tiebreaker discards a forfeited card", () => {
  const TOUGH: ScoringRules = { ...DEFAULT_SCORING, tiebreakers: ["toughest-3"] };
  // Hole 1 is the hardest, then 2, then 3.
  const strokeIndex = Array.from({ length: 18 }, (_, i) => i + 1);

  it("does not credit a conceder the holes he was up", () => {
    // C wins the three hardest holes on the card and then concedes. D beat E
    // over the same three legitimately. Ranked on the toughest three, D must
    // come out ahead of C — the forfeit threw C's card away.
    const players = [player("c"), player("d"), player("e")];
    // C is three up on the three hardest holes and walks in — the card never
    // finishes, because the forfeit is what ends it.
    const cWon: Match["holes"] = Array(18).fill(null);
    cWon[0] = "A"; cWon[1] = "A"; cWon[2] = "A";
    // D wins the same three and halves the rest: three up with none to play.
    const dWon: Match["holes"] = Array(18).fill("H") as Match["holes"];
    dWon[0] = "A"; dWon[1] = "A"; dWon[2] = "A";

    const matches = [
      match({ id: "m1", playerAId: "c", playerBId: "e", holes: cWon, forfeitedBy: "c" }),
      match({ id: "m2", playerAId: "d", playerBId: "e", holes: dWon }),
    ];
    // Level c and d on total points by carrying in the complement of what each
    // earns, so the toughest-three tiebreaker is the only thing left to
    // separate them. D earns the win plus three holes; C earns the loss and,
    // because the forfeit discards them, no holes at all.
    const carried = {
      c: 100 - DEFAULT_SCORING.lossPts,
      d: 100 - DEFAULT_SCORING.winPts - 3 * DEFAULT_SCORING.holeRatioPts,
      e: 0,
    };
    const order = computeStandings(players, matches, TOUGH, { ...carried }, strokeIndex)
      .map((r) => r.player.id);
    expect(order.slice(0, 2)).toEqual(["d", "c"]);
  });
});

describe("the points a forfeit awards", () => {
  it("gives the win to the opponent and no holes to either", () => {
    const players = [player("a"), player("b")];
    const matches = [
      match({ playerAId: "a", playerBId: "b", holes: marginToHoles("A", "5&4", 18), forfeitedBy: "a" }),
    ];
    const rows = computeStandings(players, matches, DEFAULT_SCORING, {});
    const a = rows.find((r) => r.player.id === "a")!.stats;
    const b = rows.find((r) => r.player.id === "b")!.stats;

    expect(a.losses).toBe(1);
    expect(b.wins).toBe(1);
    // The holes A was up when he walked in are discarded, both ways.
    expect(a.holesWon).toBe(0);
    expect(b.holesWon).toBe(0);
    expect(a.holesLost).toBe(0);
    expect(b.holesLost).toBe(0);
  });
});
