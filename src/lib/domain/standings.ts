// Standings: aggregate player records from match data, apply the configured
// scoring + tiebreaker chain, rank within groups and overall, and compute the
// qualification cutoff. All values are derived on every call — never stored.

import { resolveMatch } from "./match";
import { breakMatchTie, type MatchTiebreakKey } from "./match-tiebreak";
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
  playedForPoints: 0,
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
  /**
   * How an all-square match is decided, and the card to decide it on.
   *
   * Applied here rather than stored on the match, so changing the sequence
   * re-decides every affected match instead of leaving results frozen at
   * whatever rule was in force when the card was entered.
   */
  matchTiebreak?: { sequence: MatchTiebreakKey[]; strokeIndex: number[] },
): Map<string, PlayerStats> {
  const stats = new Map<string, PlayerStats>();
  for (const p of players) stats.set(p.id, emptyStats(p.id));

  /**
   * Points earned match by match, so a cap has something to cap.
   *
   * The totals below used to be worked out from season aggregates —
   * wins × winPts plus holesWon × holeRatioPts — which cannot express "no
   * more than N from any one match". Summing per match instead gives exactly
   * the same number when no cap is set (the sum of the parts is the whole),
   * and gives the cap somewhere to bite when there is one.
   */
  const earned = new Map<string, number>();
  const take = (playerId: string, outcomePts: number, holesWon: number) => {
    const raw = outcomePts + holesWon * scoring.holeRatioPts;
    const capped = scoring.maxPerMatch > 0 ? Math.min(raw, scoring.maxPerMatch) : raw;
    earned.set(playerId, (earned.get(playerId) ?? 0) + capped);
  };

  for (const m of matches) {
    const a = stats.get(m.playerAId);
    const b = stats.get(m.playerBId);
    if (!a && !b) continue;

    /**
     * A forfeited match is decided by the forfeit, not by the card.
     *
     * The opponent takes the win and the configured win points; the player who
     * forfeited takes the configured loss points and nothing else — no holes,
     * and no point for playing, because they did not play it. Whatever holes
     * were entered before they walked in are discarded rather than counted:
     * crediting a conceder the three holes he was up would flatter him in
     * hole differential, which is what the flight is ranked on.
     */
    const conceded = forfeitWinnerSide(m);
    if (conceded) {
      const forfeitedBy = conceded === "B" ? m.playerAId : m.playerBId;
      const loser = conceded === "B" ? a : b;
      const winner = conceded === "B" ? b : a;
      const winnerId = conceded === "B" ? m.playerBId : m.playerAId;
      if (loser) {
        loser.played += 1;
        loser.losses += 1;
      }
      if (winner) {
        winner.played += 1;
        winner.wins += 1;
        winner.playedForPoints += 1;
      }
      if (loser) take(forfeitedBy, scoring.lossPts, 0);
      if (winner) take(winnerId, scoring.winPts, 0);
      continue;
    }

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
      if (a) a.playedForPoints += 1;
      if (b) b.playedForPoints += 1;
      if (a) a.played += 1;
      if (b) b.played += 1;
      // A halved match is only halved if nothing decides it. The countback
      // runs here so the points follow the organizer's rule rather than the
      // raw card.
      const decided =
        r.winner === "H" && matchTiebreak?.sequence.length
          ? breakMatchTie(m.holes, matchTiebreak.strokeIndex, matchTiebreak.sequence).winner
          : null;
      const outcome = decided ?? r.winner;

      if (outcome === "H") {
        if (a) a.ties += 1;
        if (b) b.ties += 1;
      } else if (outcome === "A") {
        if (a) a.wins += 1;
        if (b) b.losses += 1;
      } else if (outcome === "B") {
        if (b) b.wins += 1;
        if (a) a.losses += 1;
      }

      const ptsFor = (side: "A" | "B") =>
        outcome === "H" ? scoring.tiePts : outcome === side ? scoring.winPts : scoring.lossPts;
      if (a) take(m.playerAId, ptsFor("A"), r.holesWonA);
      if (b) take(m.playerBId, ptsFor("B"), r.holesWonB);
    } else {
      // A match still being played pays nothing for an outcome it hasn't had,
      // but its holes already count — that is what makes the board move during
      // the round. Capped the same way, so a live blowout can't sail past the
      // limit and then fall back to it when the match finishes.
      if (a) take(m.playerAId, 0, r.holesWonA);
      if (b) take(m.playerBId, 0, r.holesWonB);
    }
  }

  for (const s of stats.values()) {
    // The bonus and the appearance points sit outside the cap: both are
    // awarded for taking part, not earned from any one match. `playPts` is per
    // match contested, which is what makes it different from the flat bonus —
    // in a league where availability varies, turning up eight times should not
    // pay the same as turning up once.
    s.points =
      (earned.get(s.playerId) ?? 0) + scoring.bonusPts + scoring.playPts * s.playedForPoints;
    s.totalPoints = s.points + (carriedPoints[s.playerId] ?? 0);
  }

  return stats;
}

/**
 * Head-to-head as a NUMBER, over the players who are actually tied.
 *
 * The pairwise version below is not a total order. Beating each other in a
 * cycle — A beat B, B beat C, C beat A — is an ordinary thing to happen in a
 * round robin, and `Array.sort` given an intransitive comparator returns
 * whatever its algorithm happens to produce: the order then depends on how
 * many OTHER players are in the array. The audit found exactly that, two
 * players level on points ranking differently over a field of 24 than over 28,
 * which is a leaderboard that changes when somebody unrelated enters.
 *
 * So the tie is broken the way golf and every league actually breaks it: a
 * mini-league among the tied players only. Wins less losses against that
 * group is a scalar, scalars are transitive, and for the common case of two
 * players it is exactly the old answer — who won the meeting.
 */
/**
 * Which side won by forfeit, or null when the match was played out.
 *
 * The one place that answers it. `aggregateStats` already honoured a forfeit,
 * but the two tiebreakers below went to the card themselves — so a conceder
 * three up when he walked in was reported as having WON the meeting, and the
 * holes the forfeit discards still counted towards his differential. Two
 * players level on points could be separated by a match one of them never
 * finished, in favour of the one who quit.
 *
 * Returns null when `forfeitedBy` names neither player. That covers a team
 * round, where the forfeit holds a team id and the player columns are empty:
 * such a match contributes nothing to a player's record either way, and
 * guessing a side from an id that is not in it would be worse than ignoring
 * it.
 */
function forfeitWinnerSide(m: Match): "A" | "B" | null {
  const by = m.forfeitedBy ?? "";
  if (!by) return null;
  if (by === m.playerAId) return "B";
  if (by === m.playerBId) return "A";
  return null;
}

function miniLeague(playerId: string, tied: Player[], matches: Match[]): number {
  const others = new Set(tied.map((p) => p.id).filter((id) => id !== playerId));
  if (others.size === 0) return 0;

  let score = 0;
  for (const m of matches) {
    const isA = m.playerAId === playerId;
    const isB = m.playerBId === playerId;
    if (!isA && !isB) continue;
    const opponent = isA ? m.playerBId : m.playerAId;
    if (!others.has(opponent)) continue;

    // A forfeit decides the meeting, whatever the card says.
    const conceded = forfeitWinnerSide(m);
    if (conceded) {
      score += (conceded === "A" && isA) || (conceded === "B" && isB) ? 1 : -1;
      continue;
    }

    const r = resolveMatch(m.holes);
    if (!r.complete || r.winner === "H") continue;
    const wonIt = (r.winner === "A" && isA) || (r.winner === "B" && isB);
    score += wonIt ? 1 : -1;
  }
  return score;
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

/** Indexes (0-based) of the `n` hardest holes, by ascending stroke index (1 = hardest). */
function toughestHoleIndexes(strokeIndex: number[], n: number): Set<number> {
  return new Set(
    strokeIndex
      .map((si, i) => ({ si, i }))
      .sort((a, b) => a.si - b.si)
      .slice(0, n)
      .map((x) => x.i),
  );
}

/** A player's (holes won − holes lost) restricted to a set of hole indexes, across all their matches. */
function holesDiffOn(playerId: string, matches: Match[], holeIdxs: Set<number>): number {
  let diff = 0;
  for (const m of matches) {
    const isA = m.playerAId === playerId;
    const isB = m.playerBId === playerId;
    if (!isA && !isB) continue;
    // A forfeited match has no card worth reading. aggregateStats discards
    // those holes for exactly this reason — crediting a conceder the holes he
    // was up flatters him — and this tiebreaker was still counting them, on
    // the six hardest holes of the course.
    if (forfeitWinnerSide(m)) continue;
    for (const idx of holeIdxs) {
      const h = m.holes[idx];
      if (h === null || h === "H") continue;
      const won = (h === "A" && isA) || (h === "B" && isB);
      diff += won ? 1 : -1;
    }
  }
  return diff;
}

function tiebreakerCompare(
  key: TiebreakerKey,
  pa: Player,
  pb: Player,
  sa: PlayerStats,
  sb: PlayerStats,
  matches: Match[],
  holeDifficulty?: number[],
  /** Mini-league scores for the tied group this comparison belongs to. */
  h2h?: Map<string, number>,
): number {
  switch (key) {
    case "head-to-head":
      // The scalar, when the caller has grouped the tie (rankPlayers always
      // does). The pairwise fallback is kept for the handful of callers that
      // compare two players outside a ranking, where a "group" of two makes
      // the two answers identical anyway.
      if (h2h) return (h2h.get(pb.id) ?? 0) - (h2h.get(pa.id) ?? 0);
      return headToHead(pa.id, pb.id, matches);
    case "most-wins":
      return sb.wins - sa.wins; // more wins ranks first
    case "win-percentage": {
      const wa = sa.played > 0 ? sa.wins / sa.played : 0;
      const wb = sb.played > 0 ? sb.wins / sb.played : 0;
      return wb - wa; // higher win% ranks first
    }
    case "holes-won-ratio": {
      const da = sa.holesWon - sa.holesLost;
      const db = sb.holesWon - sb.holesLost;
      return db - da; // higher differential ranks first
    }
    case "fewest-holes-lost":
      return sa.holesLost - sb.holesLost; // fewer lost ranks first
    case "toughest-6":
    case "toughest-3": {
      // No course/stroke-index data available — skip to the next tiebreaker.
      if (!holeDifficulty || holeDifficulty.length === 0) return 0;
      const n = key === "toughest-6" ? 6 : 3;
      const idxs = toughestHoleIndexes(holeDifficulty, n);
      const da = holesDiffOn(pa.id, matches, idxs);
      const db = holesDiffOn(pb.id, matches, idxs);
      return db - da; // better record on the toughest holes ranks first
    }
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
  /** Stroke index per hole (1 = hardest), for the "toughest N holes" tiebreakers. Omit if unknown. */
  holeDifficulty?: number[],
): RankedPlayer[] {
  const chain = scoring.tiebreakers?.length
    ? scoring.tiebreakers
    : (["head-to-head", "holes-won-ratio", "fewest-holes-lost", "lower-handicap"] as TiebreakerKey[]);

  /**
   * Points first, and then each tie broken WITHIN its own group.
   *
   * Sorting the whole field with one comparator is what made the order depend
   * on the field: head-to-head is pairwise, a cycle of results is ordinary in
   * a round robin, and `Array.sort` handed an intransitive comparator returns
   * whatever its algorithm reaches. Grouping first means the mini-league is
   * computed over exactly the players who are level, which is both the rule
   * every league actually uses and a scalar — and a scalar cannot be
   * intransitive.
   */
  const byPoints = [...players].sort((pa, pb) => {
    const diff = (stats.get(pb.id)?.totalPoints ?? 0) - (stats.get(pa.id)?.totalPoints ?? 0);
    return diff !== 0 ? diff : pa.seed - pb.seed;
  });

  const sorted: Player[] = [];
  let i = 0;
  while (i < byPoints.length) {
    const points = stats.get(byPoints[i].id)?.totalPoints ?? 0;
    let j = i;
    while (j < byPoints.length && (stats.get(byPoints[j].id)?.totalPoints ?? 0) === points) j += 1;

    const tied = byPoints.slice(i, j);
    if (tied.length === 1) {
      sorted.push(tied[0]);
    } else {
      // One mini-league for this group, computed once rather than per
      // comparison — and it is the group's own results, not the field's.
      const h2h = new Map(tied.map((p) => [p.id, miniLeague(p.id, tied, matches)]));
      const ordered = [...tied].sort((pa, pb) => {
        const sa = stats.get(pa.id)!;
        const sb = stats.get(pb.id)!;
        for (const key of chain) {
          const c = tiebreakerCompare(key, pa, pb, sa, sb, matches, holeDifficulty, h2h);
          if (c !== 0) return c;
        }
        return pa.seed - pb.seed;
      });
      sorted.push(...ordered);
    }
    i = j;
  }

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
  holeDifficulty?: number[],
  matchTiebreakers: MatchTiebreakKey[] = [],
): RankedPlayer[] {
  const stats = aggregateStats(players, matches, scoring, carriedPoints, {
    sequence: matchTiebreakers,
    strokeIndex: holeDifficulty ?? [],
  });
  return rankPlayers(players, stats, scoring, matches, holeDifficulty);
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

export interface BubblePlayer {
  id: string;
  /** Ranking value. Read as points (higher is better) or strokes (lower is
   *  better) per `higherIsBetter` — the caller decides which its format uses. */
  score: number;
  /** The flight this player is in; used only for a per-flight cut. */
  groupId?: string | null;
  /** Whether they are currently inside the cut. */
  advancing: boolean;
}

/** The cut line's closest race: who holds the last spot and who just misses. */
export interface Bubble {
  lastIn: BubblePlayer;
  firstOut: BubblePlayer;
  /** Distance from the first player out to the cut line, never negative. */
  gap: number;
}

/**
 * The bubble to watch, measured against the line that actually applies.
 *
 * "Bubble watch" reported how far the first player out was from the last player
 * in. Under a per-flight cut it compared each near-miss against the *overall*
 * standings — so a flight winner sitting well down the combined list looked
 * "behind" a stronger player in a deeper flight, and the gap came out negative:
 * a player safe in their own flight was told they were points outside
 * qualification. The two are not on the same ladder. A per-flight cut is a
 * separate race inside every flight, so the only meaningful comparison is
 * within a flight.
 *
 * Per flight, this finds each flight's own bubble — its worst qualifier against
 * its best near-miss — and surfaces the tightest of them, the race actually
 * worth watching. Because a flight's qualifiers are by definition its better
 * scores, the last-in always outranks the first-out and the gap is never
 * negative. Overall, the whole field is one flight and the behaviour is
 * unchanged.
 */
export function qualificationBubble(
  players: BubblePlayer[],
  scope: "overall" | "perFlight",
  higherIsBetter: boolean,
): Bubble | null {
  const better = (a: number, b: number) => (higherIsBetter ? a > b : a < b);
  const gapOf = (lastIn: BubblePlayer, firstOut: BubblePlayer) =>
    higherIsBetter ? lastIn.score - firstOut.score : firstOut.score - lastIn.score;

  const buckets = new Map<string, BubblePlayer[]>();
  for (const p of players) {
    const key = scope === "perFlight" ? p.groupId ?? "" : "__all__";
    const list = buckets.get(key);
    if (list) list.push(p);
    else buckets.set(key, [p]);
  }

  let tightest: Bubble | null = null;
  for (const list of buckets.values()) {
    // The worst-placed player still inside, and the best-placed one outside.
    let lastIn: BubblePlayer | null = null;
    let firstOut: BubblePlayer | null = null;
    for (const p of list) {
      if (p.advancing) {
        if (!lastIn || better(lastIn.score, p.score)) lastIn = p;
      } else if (!firstOut || better(p.score, firstOut.score)) {
        firstOut = p;
      }
    }
    if (!lastIn || !firstOut) continue;
    const gap = gapOf(lastIn, firstOut);
    if (!tightest || gap < tightest.gap) tightest = { lastIn, firstOut, gap };
  }
  return tightest;
}
