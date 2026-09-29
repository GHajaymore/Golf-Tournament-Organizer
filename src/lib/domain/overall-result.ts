import { isStablefordFormat } from "./week-basis";

/**
 * WHAT THE TOURNAMENT'S "OVERALL RESULT" IS CALLED (Ajay, 2026-09-28, left to
 * my recommendation).
 *
 * The setting is a choice between two engines — totals of strokes, or totals
 * of match points — and it read "Stroke play" on a Stableford competition. The
 * stroke engine ranks a Stableford round on its POINTS, so a tournament whose
 * playing rounds are all Stableford is decided on Stableford points, and that
 * is what a golfer should read. Anything mixed keeps "Stroke play": the engine
 * name is then the honest summary.
 *
 * One function, so the launch dialog and Tournament details cannot name the
 * same setting two ways.
 */
export function overallResultLabel(format: string, playingRoundFormats: readonly string[]): string {
  if (format !== "stroke") return "Match play";
  if (playingRoundFormats.length > 0 && playingRoundFormats.every((f) => isStablefordFormat(f))) {
    return "Stableford points";
  }
  return "Stroke play";
}
