import { describe, it, expect } from "vitest";
import { aggregateStats, computeStandings, decidedOutcome } from "@/lib/domain/standings";
import { onBoard } from "@/lib/domain/board-hold";
import { marginToHoles } from "@/lib/domain/match";
import { DEFAULT_SCORING } from "@/lib/domain/types";
import type { HoleResult, Match, Player, ScoringRules } from "@/lib/domain/types";

/**
 * A RESULT HELD IN DISPUTE IS NOT A HALVED MATCH (2026-11-08, found by J49).
 *
 * The route, as the server takes it: a match whose `scoreStatus` is
 * "disputed" goes through `onBoard` (domain/board-hold.ts), which says a held
 * result is "read as not yet played" and blanks its holes to `"[]"`;
 * `toDomainMatch` parses that to `[]`. And `resolveMatch([])` is COMPLETE and
 * HALVED — no holes left to play, nobody ahead. The standings asked
 * `.complete`, so while the Committee had not ruled both players were given a
 * match played, a halve and the halve's points, on the table and in the
 * head-to-head.
 *
 * Worked from the Rules, by a route the code does not take: Rule 3.2a(3), a
 * match is decided when one side leads by more holes than remain to be
 * played. With no hole played nobody leads, and a match that has not been
 * decided has no result — not a halve, which is a result (Rule 3.2a(1)). A
 * forfeit decides a match whatever its card holds (Rule 3.2a(4) concession;
 * Rule 1.3c / 5.3 disqualification of a side), so it is still decided. A
 * match all square after the last hole IS halved (Rule 3.2a(1)).
 */

const player = (id: string, seed = 1): Player => ({ id, name: id.toUpperCase(), handicap: 10, seed });

const match = (over: Partial<Match> & Pick<Match, "playerAId" | "playerBId">): Match =>
  ({
    id: `m-${over.playerAId}-${over.playerBId}`,
    stageId: "s",
    groupId: "g",
    round: 1,
    holes: new Array(18).fill(null),
    forfeitedBy: "",
    ...over,
  }) as Match;

/**
 * The stored row a disputed result is, put through the server's own hold and
 * parsed the way `toDomainMatch` parses it — so the test walks the route the
 * fault took, not a hand-made `[]`.
 */
const heldInDispute = (a: string, b: string, card: HoleResult[], forfeitedBy = ""): Match => {
  const row = onBoard({ scoreStatus: "disputed", holes: JSON.stringify(card), forfeitedBy });
  return match({ playerAId: a, playerBId: b, holes: JSON.parse(row.holes) as HoleResult[], forfeitedBy: row.forfeitedBy });
};

/**
 * Every outcome figure switched on and DIFFERENT, so a halve, a win, a loss
 * and an appearance each show as their own number. On the defaults (no
 * appearance point) a leak through `playPts` would be invisible.
 */
const LOUD: ScoringRules = { ...DEFAULT_SCORING, winPts: 3, tiePts: 1, lossPts: 0, playPts: 10, bonusPts: 0 };

describe("a result held in dispute is not yet played", () => {
  // A won 2&1 on the course; B disputes it, and the Committee has not ruled.
  const card = marginToHoles("A", "2&1", 18);

  it("comes off the board as no holes at all (the route the fault took)", () => {
    expect(heldInDispute("a", "b", card).holes).toEqual([]);
  });

  it("is no match played, no halve and no outcome points, for either player", () => {
    const stats = aggregateStats([player("a"), player("b")], [heldInDispute("a", "b", card)], LOUD);
    for (const id of ["a", "b"]) {
      const s = stats.get(id)!;
      expect(s.played, `${id} played`).toBe(0);
      expect(s.playedForPoints, `${id} played for points`).toBe(0);
      expect(s.ties, `${id} ties`).toBe(0);
      expect(s.wins + s.losses, `${id} decided`).toBe(0);
      // Halve (1) + appearance (10) was 11 each before the fix.
      expect(s.points, `${id} points`).toBe(0);
    }
  });

  it("decides nothing: no outcome, not a halve", () => {
    expect(decidedOutcome(heldInDispute("a", "b", card))).toBeNull();
    // With an all-square countback configured too — there is no all square to
    // break, because there is no result.
    expect(
      decidedOutcome(heldInDispute("a", "b", card), { sequence: ["last-9", "last-6", "last-3", "last-1"], strokeIndex: [] }),
    ).toBeNull();
  });

  it("holds a disputed FORFEIT too: the concession is part of the result", () => {
    const held = heldInDispute("a", "b", [], "a");
    expect(held.forfeitedBy).toBe("");
    expect(decidedOutcome(held)).toBeNull();
    expect(aggregateStats([player("a"), player("b")], [held], LOUD).get("b")!.wins).toBe(0);
  });

  it("leaves the table and its order exactly as if the match did not exist", () => {
    // Three players. B beat C. A v B and A v C are both held in dispute.
    // Read as halves they gave A two halves and two appearances (22 points),
    // above B's one win — so a player with no result on the table led it. The
    // held matches must move nobody.
    const players = [player("a", 1), player("b", 2), player("c", 3)];
    const played = [match({ playerAId: "b", playerBId: "c", holes: marginToHoles("A", "3&2", 18) })];
    const held = [heldInDispute("a", "b", card), heldInDispute("a", "c", marginToHoles("B", "1 UP", 18))];
    const H2H: ScoringRules = { ...LOUD, tiebreakers: ["head-to-head", "most-wins"] };

    const withHeld = computeStandings(players, [...played, ...held], H2H);
    const without = computeStandings(players, played, H2H);
    expect(withHeld.map((r) => [r.player.id, r.rank, r.stats.points, r.stats.played])).toEqual(
      without.map((r) => [r.player.id, r.rank, r.stats.points, r.stats.played]),
    );
  });

  it("gives no head-to-head to a pair whose only meeting is held", () => {
    // A and B level on carried points; their one meeting is held (the card
    // under the hold says B won 4&3). The mini-league must see no meeting, so
    // nothing a player DID separates them and they share the place — not B
    // first off the held card, and no points from a phantom halve.
    const players = [player("a", 1), player("b", 2)];
    const H2H: ScoringRules = { ...DEFAULT_SCORING, tiebreakers: ["head-to-head"] };
    const heldForB = heldInDispute("a", "b", marginToHoles("B", "4&3", 18));
    const ranked = computeStandings(players, [heldForB], H2H, { a: 5, b: 5 });
    expect(ranked.map((r) => r.rank)).toEqual([1, 1]);
    expect(ranked.every((r) => r.stats.totalPoints === 5 && r.stats.played === 0)).toBe(true);
  });

  it("counts once the Committee rules and the hold is lifted", () => {
    // The same row, no longer disputed: the card comes back and A won 2&1.
    const row = onBoard({ scoreStatus: "confirmed", holes: JSON.stringify(card), forfeitedBy: "" });
    const settled = match({ playerAId: "a", playerBId: "b", holes: JSON.parse(row.holes) as HoleResult[] });
    expect(decidedOutcome(settled)).toBe("A");
    const stats = aggregateStats([player("a"), player("b")], [settled], LOUD);
    expect(stats.get("a")).toMatchObject({ played: 1, wins: 1, points: 13 });
    expect(stats.get("b")).toMatchObject({ played: 1, losses: 1, points: 10 });
  });
});

describe("the controls: what still IS a result", () => {
  it("a forfeit with no holes on the card is still decided, against the conceder", () => {
    const m = match({ playerAId: "a", playerBId: "b", holes: [], forfeitedBy: "a" });
    expect(decidedOutcome(m)).toBe("B");
    const stats = aggregateStats([player("a"), player("b")], [m], LOUD);
    expect(stats.get("b")).toMatchObject({ played: 1, wins: 1 });
    expect(stats.get("a")).toMatchObject({ played: 1, losses: 1 });
  });

  it("a match all square after the 18th is a halve (Rule 3.2a(1))", () => {
    // Nine each way: level after the last hole, played out.
    const holes: HoleResult[] = [...new Array(9).fill("A"), ...new Array(9).fill("B")];
    const m = match({ playerAId: "a", playerBId: "b", holes });
    expect(decidedOutcome(m)).toBe("H");
    const stats = aggregateStats([player("a"), player("b")], [m], LOUD);
    for (const id of ["a", "b"]) expect(stats.get(id)).toMatchObject({ played: 1, ties: 1, points: 11, holesWon: 9 });
  });

  it("a match still on the course is not decided, but its holes count live", () => {
    const holes: HoleResult[] = [...new Array(5).fill("A"), ...new Array(13).fill(null)];
    const m = match({ playerAId: "a", playerBId: "b", holes });
    expect(decidedOutcome(m)).toBeNull();
    const stats = aggregateStats([player("a"), player("b")], [m], { ...LOUD, holeRatioPts: 1 });
    expect(stats.get("a")).toMatchObject({ played: 0, holesWon: 5, points: 5 });
  });

  it("a match closed out before the 18th is decided there (Rule 3.2a(3))", () => {
    const m = match({ playerAId: "a", playerBId: "b", holes: marginToHoles("B", "5&4", 18) });
    expect(decidedOutcome(m)).toBe("B");
  });
});
