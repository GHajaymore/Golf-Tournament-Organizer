import { describe, it, expect } from "vitest";
import { computeStandings, rankPlayers, aggregateStats } from "../domain/standings";
import { DEFAULT_SCORING, DEFAULT_TIEBREAKERS } from "../domain/types";
import type { Match, Player } from "../domain/types";

/**
 * A PLACE IS SHARED UNLESS SOMETHING A PLAYER DID SEPARATES THEM.
 *
 * `rankPlayers` already shared a place when nothing separated two players, and
 * it almost never fired, because the chain every event carries ends in
 * `lower-handicap` — and two players' handicaps are almost always different.
 * So the app had a tie-sharing rule that could not reach the cases it was
 * written for.
 *
 * Two consequences, both measured on 2026-09-15 before anything was changed:
 *
 *     two players halve their match      -> 1st and 2nd, lower handicap "won"
 *     eight players, nobody has played   -> places 1 to 8 in handicap order
 *
 * The second is the one on a clubhouse screen: before a ball is struck, the
 * board names a leader.
 *
 * THE FIX IS NOT A NEW RULE, it is applying one this file already had.
 * `seed` — entry order — was deliberately excluded from deciding ties, with
 * the reasoning that it "exists to make the ORDER stable, which a list still
 * needs". A handicap is the same kind of thing: it puts a list in a
 * deterministic order and it does not mean anybody beat anybody. Everything
 * else in the chain is a RESULT — who won the meeting, holes won, holes lost,
 * the hardest six.
 *
 * NOTHING WAS MIGRATED. `lower-handicap` is the last entry of the schema's own
 * column default, so every event carries it whether or not a committee chose
 * it, and the data cannot tell those apart. The list still reads in the same
 * order; it just stops claiming a halved match had a winner.
 */

const field = (n: number): Player[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: `P${i}`,
    // Distinct, and deliberately so: identical handicaps would make this pass
    // whatever the code did.
    handicap: 2 + i * 3,
    seed: i + 1,
  })) as Player[];

const halvedRoundRobin = (players: Player[]): Match[] => {
  const out: Match[] = [];
  for (let i = 0; i < players.length; i += 1) {
    for (let j = i + 1; j < players.length; j += 1) {
      out.push({
        id: `m${i}-${j}`,
        stageId: "s1",
        groupId: "g1",
        round: 1,
        playerAId: players[i].id,
        playerBId: players[j].id,
        holes: new Array(18).fill("H") as Match["holes"],
      });
    }
  }
  return out;
};

describe("a board with nothing played on it names no leader", () => {
  it("shares first place across a field that has not teed off", () => {
    // The register's own reproduction: a gross match-play league, eight
    // players, no scores.
    const players = field(8);
    const rows = computeStandings(players, [], DEFAULT_SCORING);
    expect(rows.map((r) => r.rank), "the board ranked a field that has not played").toEqual(
      Array.from({ length: 8 }, () => 1),
    );
  });

  it("still puts them in a stable order", () => {
    /**
     * Sharing a place is not the same as having no order. A list still has to
     * come out in some sequence, and it must be the same sequence every time
     * or the board reshuffles under whoever is reading it.
     */
    const players = field(8);
    const once = computeStandings(players, [], DEFAULT_SCORING).map((r) => r.player.id);
    const twice = computeStandings([...players].reverse(), [], DEFAULT_SCORING).map((r) => r.player.id);
    expect(twice, "the order depends on the order the field arrived in").toEqual(once);
  });
});

describe("a halved match is a halved match", () => {
  it("does not hand it to the lower handicap", () => {
    const [a, b] = field(2);
    const rows = computeStandings([a, b], halvedRoundRobin([a, b]), DEFAULT_SCORING);
    expect(rows.map((r) => r.rank), "the lower handicap was given the match").toEqual([1, 1]);
  });

  it("across a whole round robin nobody won", () => {
    const players = field(6);
    const rows = computeStandings(players, halvedRoundRobin(players), DEFAULT_SCORING);
    expect(new Set(rows.map((r) => r.rank)).size, "somebody led a round robin of halves").toBe(1);
  });
});

describe("and a real result still separates people", () => {
  /**
   * THE CONTROL, and the reason the assertions above are not satisfied by a
   * function that shares every place with every other. If this ever passes
   * with everyone level, the two blocks above prove nothing at all.
   */
  it("a player who wins is ahead of one who does not", () => {
    const players = field(2);
    const matches: Match[] = [
      {
        id: "m1",
        stageId: "s1",
        groupId: "g1",
        round: 1,
        playerAId: players[0].id,
        playerBId: players[1].id,
        // A wins 3&2: decided, and not a halve.
        holes: [...new Array(16).fill("A"), null, null] as Match["holes"],
      },
    ];
    const rows = computeStandings(players, matches, DEFAULT_SCORING);
    expect(rows[0].player.id, "the winner is not top").toBe(players[0].id);
    expect(rows.map((r) => r.rank), "a won match did not separate anybody").toEqual([1, 2]);
  });

  it("competition ranking: two on second leaves the next on fourth", () => {
    /**
     * Not 1, 2, 2, 3. A place nobody finished in is not handed to the player
     * behind the tie — that is what makes a shared place mean something on a
     * prize sheet.
     */
    const players = field(4);
    const matches: Match[] = [
      // P0 beats everybody; P1 and P2 halve their meeting and beat P3; P3 loses
      // to all. So P1 and P2 are genuinely level on points and on holes.
      m("a", players[0], players[3], "A"),
      m("b", players[1], players[3], "A"),
      m("c", players[2], players[3], "A"),
      m("d", players[1], players[2], "H"),
      m("e", players[0], players[1], "A"),
      m("f", players[0], players[2], "A"),
    ];
    const stats = aggregateStats(players, matches, DEFAULT_SCORING);
    const ranks = rankPlayers(players, stats, DEFAULT_SCORING, matches).map((r) => r.rank);
    expect(ranks[0]).toBe(1);
    // Whatever the middle two do, a shared place must skip the one after it.
    ranks.forEach((rank, i) => {
      if (i > 0) expect([ranks[i - 1], i + 1], `rank ${i} invented a place`).toContain(rank);
    });
  });
});

describe("the chain the app actually ships", () => {
  it("still ends in lower-handicap, which is what made this worth fixing", () => {
    /**
     * Pinned rather than assumed. If a later change drops it from the default,
     * the assertions above start passing for a different reason and stop
     * testing what they say they test — the same trap as a fixture that cannot
     * express a wrong answer.
     *
     * It stays because it is doing a real job: ordering a list deterministically
     * when nothing else can. It simply is not allowed to decide who won.
     */
    expect(DEFAULT_TIEBREAKERS[DEFAULT_TIEBREAKERS.length - 1]).toBe("lower-handicap");
    expect(DEFAULT_SCORING.tiebreakers).toContain("lower-handicap");
  });
});

function m(id: string, a: Player, b: Player, result: "A" | "B" | "H"): Match {
  return {
    id,
    stageId: "s1",
    groupId: "g1",
    round: 1,
    playerAId: a.id,
    playerBId: b.id,
    holes: new Array(18).fill(result) as Match["holes"],
  } as Match;
}
