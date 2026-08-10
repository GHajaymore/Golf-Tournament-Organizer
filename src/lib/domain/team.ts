// Team scoring: turning several players' cards into one side's score.
//
// Two shapes, and the difference is physical rather than arithmetic:
//
//   Aggregate (four-ball, best ball, shamble) — everyone plays their own ball,
//   so there are N cards and the side's score on a hole is the best of them.
//   A hole where only some partners hold out still has a team score.
//
//   Single ball (foursomes, alternate shot, scramble, Chapman) — the side plays
//   one ball, so there is one card and nothing to combine. What remains is the
//   handicap, which is computed from the whole side.

import { holeStrokesReceived, stablefordPointsForHole , allocationHoles } from "./stroke";

export interface TeamMemberCard {
  playerId: string;
  /** Per-hole gross strokes; null for a hole not yet played or picked up. */
  strokes: (number | null)[];
  /** This player's course handicap, before any format allowance. */
  courseHandicap: number;
}

export interface TeamHole {
  /** Best net score among partners on this hole, or null if nobody holed out. */
  net: number | null;
  /** The gross that produced it. */
  gross: number | null;
  /** Who contributed the counting score. Empty when the hole is unplayed. */
  playerId: string;
  /** Stableford points for the counting score. */
  points: number;
}

export interface TeamCard {
  holes: TeamHole[];
  grossTotal: number;
  netTotal: number;
  pointsTotal: number;
  played: number;
  /** Gross minus par over the holes played. */
  toPar: number;
}

/**
 * Per-hole handicap strokes for one player, under a format allowance.
 *
 * The allowance is applied to the course handicap *before* the strokes are
 * spread across holes — applying it afterwards would round every hole
 * separately and drift by several strokes over a round.
 */
export function allocatedStrokes(
  courseHandicap: number,
  allowancePct: number,
  strokeIndex: number[],
): number[] {
  const playing = Math.round((courseHandicap * allowancePct) / 100);
  return strokeIndex.map((si) => holeStrokesReceived(playing, si, allocationHoles(strokeIndex.length)));
}

/**
 * The side's score on every hole, taking the best `countBest` partner scores.
 *
 * `countBest` is 1 for four-ball and ordinary best ball. Some club formats
 * count the best two or three of four, which is the same operation with a
 * different count — hence the parameter rather than a hardcoded "best one".
 */
export function aggregateTeamCard(
  members: TeamMemberCard[],
  pars: number[],
  strokeIndex: number[],
  allowancePct: number,
  countBest = 1,
): TeamCard {
  const holeCount = pars.length;
  const perPlayerStrokes = new Map(
    members.map((m) => [m.playerId, allocatedStrokes(m.courseHandicap, allowancePct, strokeIndex)]),
  );

  const holes: TeamHole[] = [];
  let grossTotal = 0;
  let netTotal = 0;
  let pointsTotal = 0;
  let played = 0;
  let parPlayed = 0;

  for (let h = 0; h < holeCount; h += 1) {
    const candidates = members
      .map((m) => {
        const gross = m.strokes[h];
        if (gross == null || !Number.isFinite(gross)) return null;
        const shots = perPlayerStrokes.get(m.playerId)![h] ?? 0;
        return {
          playerId: m.playerId,
          gross,
          net: gross - shots,
          points: stablefordPointsForHole(gross, pars[h] ?? 0, shots),
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null)
      // Lowest net counts. Gross breaks a net tie so the hole credits the
      // better actual score rather than whoever the input order happened to
      // put first — otherwise a team's card would depend on roster order.
      .sort((a, b) => a.net - b.net || a.gross - b.gross);

    if (candidates.length === 0) {
      holes.push({ net: null, gross: null, playerId: "", points: 0 });
      continue;
    }

    const counting = candidates.slice(0, Math.max(1, countBest));
    const best = counting[0];
    holes.push({
      net: counting.reduce((sum, c) => sum + c.net, 0),
      gross: counting.reduce((sum, c) => sum + c.gross, 0),
      playerId: best.playerId,
      points: counting.reduce((sum, c) => sum + c.points, 0),
    });
    grossTotal += counting.reduce((sum, c) => sum + c.gross, 0);
    netTotal += counting.reduce((sum, c) => sum + c.net, 0);
    pointsTotal += counting.reduce((sum, c) => sum + c.points, 0);
    played += 1;
    parPlayed += (pars[h] ?? 0) * Math.max(1, countBest);
  }

  return { holes, grossTotal, netTotal, pointsTotal, played, toPar: grossTotal - parPlayed };
}

/**
 * The side's playing handicap where they share one ball.
 *
 * Foursomes take a percentage of the partners' *combined* handicaps — that is
 * why the allowance is 50 rather than 100: half of two handicaps is roughly
 * one player's worth of shots for one ball.
 *
 * A scramble takes a descending share of each player's handicap, best player
 * first, which is the common club convention rather than a published standard.
 * Passing descending weights expresses that; passing none splits evenly.
 */
export function sideHandicap(
  courseHandicaps: number[],
  allowancePct: number,
  weights?: number[],
): number {
  if (courseHandicaps.length === 0) return 0;
  const sorted = [...courseHandicaps].sort((a, b) => a - b); // best player first
  if (!weights || weights.length === 0) {
    const combined = sorted.reduce((sum, h) => sum + h, 0);
    return Math.round((combined * allowancePct) / 100);
  }
  // Weighted: each weight is a percentage applied to one player's handicap,
  // in ability order. Extra players beyond the weight list contribute nothing,
  // which is how a 4-person scramble table (25/20/15/10) is meant to behave.
  const total = sorted.reduce((sum, h, i) => sum + (h * (weights[i] ?? 0)) / 100, 0);
  return Math.round(total);
}

/**
 * A committee's allowance shares, cleaned up, or null if they don't apply.
 *
 * These arrive from a form, so they are checked rather than trusted: a share
 * outside 0–100 is not a preference, and a list that doesn't match the number
 * of players on the side would silently drop somebody's handicap from the
 * calculation — `sideHandicap` gives absent positions a weight of zero. Both
 * fall back to the format's own split instead of scoring the round wrong.
 *
 * Shares are deliberately *not* required to sum to 100. Greensomes' 60/40
 * does, but a scramble's 25/20/15/10 sums to 70, and both are real.
 */
export function committeeWeights(weights: number[] | undefined | null, sideSize: number): number[] | null {
  if (!weights || weights.length === 0) return null;
  if (weights.length !== sideSize) return null;
  if (weights.some((w) => !Number.isFinite(w) || w < 0 || w > 100)) return null;
  // All zeroes would hand the side a scratch handicap by arithmetic rather
  // than by anyone's intent.
  if (weights.every((w) => w === 0)) return null;
  return weights.map((w) => Math.round(w));
}

/** The common 4-person scramble allowance table, best player first. */
export const SCRAMBLE_WEIGHTS_4 = [25, 20, 15, 10];
/** The common 2-person scramble allowance table. */
export const SCRAMBLE_WEIGHTS_2 = [35, 15];

/**
 * A side's card where they play a single ball.
 *
 * There is nothing to combine, so this is ordinary stroke scoring against a
 * side handicap that was computed from all the partners.
 */
export function singleBallTeamCard(
  strokes: (number | null)[],
  pars: number[],
  sidePlayingHandicap: number,
  strokeIndex: number[],
): TeamCard {
  const holes: TeamHole[] = [];
  let grossTotal = 0;
  let netTotal = 0;
  let pointsTotal = 0;
  let played = 0;
  let parPlayed = 0;

  for (let h = 0; h < pars.length; h += 1) {
    const gross = strokes[h];
    if (gross == null || !Number.isFinite(gross)) {
      holes.push({ net: null, gross: null, playerId: "", points: 0 });
      continue;
    }
    const shots = holeStrokesReceived(sidePlayingHandicap, strokeIndex[h] ?? 18, allocationHoles(strokeIndex.length));
    const net = gross - shots;
    const points = stablefordPointsForHole(gross, pars[h] ?? 0, shots);
    holes.push({ net, gross, playerId: "", points });
    grossTotal += gross;
    netTotal += net;
    pointsTotal += points;
    played += 1;
    parPlayed += pars[h] ?? 0;
  }

  return { holes, grossTotal, netTotal, pointsTotal, played, toPar: grossTotal - parPlayed };
}

/**
 * Hole-by-hole match result between two sides, from their team cards.
 *
 * Returns the same "A" | "B" | "H" | null shape the singles match engine uses,
 * so four-ball match play reuses resolveMatch unchanged rather than growing a
 * parallel implementation.
 */
export function teamMatchHoles(sideA: TeamCard, sideB: TeamCard): ("A" | "B" | "H" | null)[] {
  const holes = Math.max(sideA.holes.length, sideB.holes.length);
  const out: ("A" | "B" | "H" | null)[] = [];
  for (let h = 0; h < holes; h += 1) {
    const a = sideA.holes[h]?.net ?? null;
    const b = sideB.holes[h]?.net ?? null;
    if (a == null || b == null) out.push(null);
    else if (a < b) out.push("A");
    else if (b < a) out.push("B");
    else out.push("H");
  }
  return out;
}
