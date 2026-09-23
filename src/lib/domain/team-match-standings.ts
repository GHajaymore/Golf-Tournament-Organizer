import { resolveMatch, matchIsOver } from "./match";
import { pairingPoints, type LeaguePointsSystem } from "./league-meeting";
import type { HoleResult } from "./types";

/**
 * A ROUND ROBIN OF TEAM MATCHES, RANKED ON THE MATCHES.
 *
 * A four-ball round robin was ranked on stroke totals, because `boardKind`
 * asks the FORMAT and a team format lands on the team stroke board whatever
 * stage it is on. Measured 2026-09-22 on a fixture built so the two answers
 * differ — a side winning holes 1-10 and blowing up on the 18th:
 *
 *     Four-Ball · 2 sides · lowest net wins.
 *     1  lower-total       72   E
 *     2  wins-the-match    77
 *
 * The side that won 10&8 is second, and every match result in the round is
 * thrown away. Singles match play has had a match-points board all along.
 *
 * NOTHING ABOUT THE GOLF IS NEW HERE, which is the point. Ajay's ruling when
 * asked how far to take it: "go with what other golf club do and what is the
 * standard (plus customization)". So:
 *
 *   - `pairingPoints` decides what a match is worth. It already implements the
 *     four systems a club picks between, already scores a closeout on the
 *     holes actually walked, and is already what the interclub league uses.
 *   - the DEFAULT is "match" — one point a win, a half each for a half —
 *     which `league-meeting.ts` calls "the simplest" and is what a club does
 *     when nobody has said otherwise.
 *   - a club that HAS said otherwise keeps their answer, because the system is
 *     an argument rather than a constant.
 *
 * Pure: it takes resolved matches and returns rows. No Prisma, no clock — the
 * same shape `league-meeting.ts` holds to, and what lets every combination be
 * swept without a database.
 */
export interface TeamMatchPairing {
  /** The two sides. Empty means the match is not between two teams. */
  teamAId: string;
  teamBId: string;
  /** Per-hole winner, as `matchHolesOffTheLow` returns it. */
  holes: HoleResult[];
}

export interface TeamMatchStanding {
  teamId: string;
  /** Matches with a result in them. An undrawn pairing counts for nobody. */
  played: number;
  wins: number;
  halved: number;
  losses: number;
  /** Holes won less holes lost, across the matches actually played. */
  holesDiff: number;
  points: number;
  rank: number;
}

/**
 * Ranked sides, best first.
 *
 * `matchIsOver` rather than `resolveMatch().complete`: an empty card has no
 * holes left to play, so `resolveMatch` calls it complete AND halved — which
 * would hand half a point to both sides of every pairing nobody has started.
 * That is the same trap `pairingPoints` documents, and the reason a freshly
 * drawn round robin showed every player on one point.
 */
export function teamMatchStandings(
  teamIds: readonly string[],
  pairings: readonly TeamMatchPairing[],
  system: LeaguePointsSystem = "match",
  matchBonus?: number,
): TeamMatchStanding[] {
  const blank = (): Omit<TeamMatchStanding, "teamId" | "rank"> => ({
    played: 0,
    wins: 0,
    halved: 0,
    losses: 0,
    holesDiff: 0,
    points: 0,
  });
  const acc = new Map<string, ReturnType<typeof blank>>();
  for (const id of teamIds) acc.set(id, blank());
  const of = (id: string) => {
    if (!acc.has(id)) acc.set(id, blank());
    return acc.get(id)!;
  };

  for (const p of pairings) {
    if (!p.teamAId || !p.teamBId) continue;
    const a = of(p.teamAId);
    const b = of(p.teamBId);

    const [pa, pb] = pairingPoints(p.holes, system, matchBonus);
    a.points += pa;
    b.points += pb;

    if (!matchIsOver(p.holes)) continue;

    a.played += 1;
    b.played += 1;
    const res = resolveMatch(p.holes);
    if (res.winner === "A") {
      a.wins += 1;
      b.losses += 1;
    } else if (res.winner === "B") {
      b.wins += 1;
      a.losses += 1;
    } else {
      a.halved += 1;
      b.halved += 1;
    }
    // Holes won less holes lost. `resolveMatch` counts only the holes walked,
    // so a closeout does not credit the ones nobody played.
    a.holesDiff += res.holesWonA - res.holesWonB;
    b.holesDiff += res.holesWonB - res.holesWonA;
  }

  const rows = [...acc.entries()].map(([teamId, r]) => ({ teamId, ...r, rank: 0 }));
  /**
   * Points, then the holes. A club separating two sides level on points looks
   * at the matches themselves before anything else, and the holes are what the
   * matches produced — the same countback order `league-order.ts` uses.
   *
   * A side that has played NOTHING sorts last whatever its points say, so a
   * round nobody has started does not crown somebody on zero.
   */
  rows.sort((x, y) => {
    if ((x.played === 0) !== (y.played === 0)) return x.played === 0 ? 1 : -1;
    return y.points - x.points || y.holesDiff - x.holesDiff;
  });

  let rank = 0;
  let seen = 0;
  let last: string | null = null;
  for (const r of rows) {
    seen += 1;
    const key = `${r.points}|${r.holesDiff}|${r.played === 0}`;
    // Sides level on the figures share a place, and the next side takes the
    // place its position deserves — 1, 1, 3 rather than 1, 1, 2.
    if (key !== last) rank = seen;
    last = key;
    r.rank = rank;
  }
  return rows;
}
