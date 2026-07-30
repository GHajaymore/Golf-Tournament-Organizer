// Standings: aggregate player records from match data, apply the configured
// scoring + tiebreaker chain, rank within groups and overall, and compute the
// qualification cutoff. All values are derived on every call — never stored.

import { resolveMatch } from "./match";
import type {
  Match,
  Player,
  PlayerStats,
  ScoringRules,
  TiebreakerKey,
} from "./types";

export interface RankedPlayer {
  player: Player;
  stats: PlayerStats;
  /** 1-based rank within the ranking context this appears in. */
  rank: number;
}

const emptyStats = (playerId: string): PlayerStats => ({
  playerId,
  played: 0,
  wins: 0,
  losses: 0,
  ties: 0,
  holesWon: 0,
  holesLost: 0,
  points: 0,
  totalPoints: 0,
});

/**
 * Aggregate raw stats for a set of players from the matches they appear in.
 * Holes won/lost accumulate from every entered hole (live), while W/L/T and
 * `played` count only completed matches.
 */
export function aggregateStats(
  players: Player[],
  matches: Match[],
  scoring: ScoringRules,
  carriedPoints: Record<string, number> = {},
): Map<string, PlayerStats> {
  const stats = new Map<string, PlayerStats>();
  for (const p of players) stats.set(p.id, emptyStats(p.id));

  for (const m of matches) {
    const a = stats.get(m.playerAId);
    const b = stats.get(m.playerBId);
    if (!a && !b) continue;
    const r = resolveMatch(m.holes);

    if (a) {
      a.holesWon += r.holesWonA;
      a.holesLost += r.holesWonB;
    }
    if (b) {
      b.holesWon += r.holesWonB;
      b.holesLost += r.holesWonA;
    }

    if (r.complete) {
      if (a) a.played += 1;
      if (b) b.played += 1;
      if (r.winner === "H") {
        if (a) a.ties += 1;
        if (b) b.ties += 1;
      } else if (r.winner === "A") {
        if (a) a.wins += 1;
        if (b) b.losses += 1;
      } else if (r.winner === "B") {
        if (b) b.wins += 1;
        if (a) a.losses += 1;
      }
    }
  }

  for (const s of stats.values()) {
    s.points =
      s.wins * scoring.winPts +
      s.losses * scoring.lossPts +
      s.ties * scoring.tiePts +
      s.holesWon * scoring.holeRatioPts +
      scoring.bonusPts;
    s.totalPoints = s.points + (carriedPoints[s.playerId] ?? 0);
  }

  return stats;
}

/**
 * Result of the head-to-head between two players within `matches`:
 * -1 if `aId` won the meeting, 1 if `bId` won, 0 if halved / no completed meeting.
 */
function headToHead(aId: string, bId: string, matches: Match[]): number {
  for (const m of matches) {
    const isPair =
      (m.playerAId === aId && m.playerBId === bId) ||
      (m.playerAId === bId && m.playerBId === aId);
    if (!isPair) continue;
    const r = resolveMatch(m.holes);
    if (!r.complete || r.winner === "H") continue;
    const winnerId = r.winner === "A" ? m.playerAId : m.playerBId;
    if (winnerId === aId) return -1;
    if (winnerId === bId) return 1;
  }
  return 0;
}

function tiebreakerCompare(
  key: TiebreakerKey,
  pa: Player,
  pb: Player,
  sa: PlayerStats,
  sb: PlayerStats,
  matches: Match[],
): number {
  switch (key) {
    case "head-to-head":
      return headToHead(pa.id, pb.id, matches);
    case "holes-won-ratio": {
      const da = sa.holesWon - sa.holesLost;
      const db = sb.holesWon - sb.holesLost;
      return db - da; // higher differential ranks first
    }
    case "fewest-holes-lost":
      return sa.holesLost - sb.holesLost; // fewer lost ranks first
    case "lower-handicap":
      return pa.handicap - pb.handicap; // lower handicap ranks first
    default:
      return 0;
  }
}

/**
 * Rank players by total points desc, then the configured tiebreaker chain.
 * Falls back to seed for a fully deterministic ordering.
 */
export function rankPlayers(
  players: Player[],
  stats: Map<string, PlayerStats>,
  scoring: ScoringRules,
  matches: Match[],
): RankedPlayer[] {
  const chain = scoring.tiebreakers?.length
    ? scoring.tiebreakers
    : (["head-to-head", "holes-won-ratio", "fewest-holes-lost", "lower-handicap"] as TiebreakerKey[]);

  const sorted = [...players].sort((pa, pb) => {
    const sa = stats.get(pa.id)!;
    const sb = stats.get(pb.id)!;
    if (sb.totalPoints !== sa.totalPoints) return sb.totalPoints - sa.totalPoints;
    for (const key of chain) {
      const c = tiebreakerCompare(key, pa, pb, sa, sb, matches);
      if (c !== 0) return c;
    }
    return pa.seed - pb.seed;
  });

  return sorted.map((player, i) => ({
    player,
    stats: stats.get(player.id)!,
    rank: i + 1,
  }));
}

/** Convenience: aggregate + rank in one call for a group or the whole field. */
export function computeStandings(
  players: Player[],
  matches: Match[],
  scoring: ScoringRules,
  carriedPoints: Record<string, number> = {},
): RankedPlayer[] {
  const stats = aggregateStats(players, matches, scoring, carriedPoints);
  return rankPlayers(players, stats, scoring, matches);
}

/**
 * Qualification cutoff for a single group: the totalPoints of the last player
 * who still advances (the `qualifyPerGroup`-th ranked player). Returns null if
 * the group has fewer players than the cutoff.
 */
export function groupCutoff(ranked: RankedPlayer[], qualifyPerGroup: number): number | null {
  if (ranked.length === 0 || qualifyPerGroup <= 0) return null;
  const idx = Math.min(qualifyPerGroup, ranked.length) - 1;
  return ranked[idx].stats.totalPoints;
}
