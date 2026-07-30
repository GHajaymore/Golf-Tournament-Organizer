// Carry-forward: a stage may start each player with a percentage of the points
// they accumulated in the previous stage (README "Stage" entity).

/**
 * Compute the carried-in points map for a stage given the previous stage's
 * final totals. Returns an empty map when carry-forward is disabled (every
 * player starts that stage at zero).
 */
export function carriedInto(
  previousTotals: Record<string, number>,
  enabled: boolean,
  pct: number,
): Record<string, number> {
  if (!enabled || pct <= 0) return {};
  const factor = pct / 100;
  const out: Record<string, number> = {};
  for (const [id, pts] of Object.entries(previousTotals)) {
    out[id] = Math.round(pts * factor * 100) / 100;
  }
  return out;
}
