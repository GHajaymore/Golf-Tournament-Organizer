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
