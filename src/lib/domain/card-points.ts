import { stablefordPointsForHole, modifiedStablefordForHole } from "./stroke";

/** Which Stableford table a round is scored on, or none. */
export type PointsTable = "standard" | "modified";

/**
 * A card's Stableford points, as the board counts them.
 *
 * The player's card showed gross, to par and net — and on a Stableford round
 * no points at all, although points are the only thing that round is decided
 * on. Walked as a member of the seeded Twilight Nine on 2026-09-26: the card
 * said "Net 37" and nothing else, while Today said 13 points.
 *
 * Per hole through the SAME functions the engine totals with
 * (`aggregateStroke` via `stablefordTableFor`), from the same par and the same
 * shots on each hole, so the card and the board cannot disagree. A hole with
 * no score adds nothing, as on the board.
 */
export function cardPoints(
  strokes: readonly (number | null)[],
  pars: readonly number[],
  shotsPerHole: readonly number[],
  table: PointsTable,
): number {
  const perHole = table === "modified" ? modifiedStablefordForHole : stablefordPointsForHole;
  let points = 0;
  strokes.forEach((s, i) => {
    if (typeof s !== "number" || s <= 0 || !pars[i]) return;
    points += perHole(s, pars[i], shotsPerHole[i] ?? 0);
  });
  return points;
}

/**
 * THE SCORE A STABLEFORD PICK-UP IS RECORDED AS (2026-10-08).
 *
 * Rule 21.1b: in Stableford a player who cannot score a point on a hole may
 * pick up; the hole scores zero points and the player is not penalised. For
 * handicap purposes (World Handicap System) a hole not completed is recorded
 * as net double bogey — par, plus two, plus the strokes received there — and
 * net double bogey is exactly the score that earns zero Stableford points. So
 * recording a pick-up as net double bogey is right twice over: the points are
 * zero, and the card holds the figure a handicap record would put there. The
 * card is then complete, which a blank hole never let it be.
 *
 * Standard Stableford only. Modified Stableford pays a NEGATIVE score for a
 * double bogey, so there is no "cannot score" to pick up from.
 */
export function stablefordPickUp(par: number, strokesReceived: number): number {
  return par + 2 + Math.max(0, Math.round(strokesReceived));
}
