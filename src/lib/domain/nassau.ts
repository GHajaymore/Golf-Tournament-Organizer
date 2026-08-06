// Nassau: three matches played on one card — front nine, back nine, and the
// full eighteen. Each is worth the same, so a player who loses the front can
// still take the day by winning the back and the overall.
//
// This is not a new scoring engine so much as three views of one. The hole
// results come from the existing match engine; Nassau just slices them and
// resolves each slice independently.

import { resolveMatch, type MatchResolution } from "./match";
import type { HoleResult } from "./types";

export interface NassauSegment {
  key: "front" | "back" | "overall";
  label: string;
  /** Null when the segment has no completed holes yet. */
  result: MatchResolution | null;
  /** Holes belonging to this segment that have a result. */
  played: number;
}

export interface NassauOutcome {
  segments: NassauSegment[];
  /** Net points: +1 per segment A leads or has won, -1 per segment for B. */
  balance: number;
  /** Segments decided so far, out of three. */
  decided: number;
}

/**
 * Resolve a Nassau from the full hole-by-hole result of one match.
 *
 * A nine-hole round yields a single segment. Slicing nine holes into "front"
 * and "overall" would report the same match twice under two names, and there
 * is no back nine to report — a Nassau needs eighteen holes to be three bets.
 */
export function playNassau(holes: HoleResult[]): NassauOutcome {
  const segment = (key: NassauSegment["key"], label: string, slice: HoleResult[]): NassauSegment => {
    const played = slice.filter((h) => h !== null).length;
    return { key, label, result: played > 0 ? resolveMatch(slice) : null, played };
  };

  const segments: NassauSegment[] =
    holes.length > 9
      ? [
          segment("front", "Front nine", holes.slice(0, 9)),
          segment("back", "Back nine", holes.slice(9, 18)),
          segment("overall", "Overall 18", holes),
        ]
      : [segment("overall", "Overall", holes)];

  let balance = 0;
  let decided = 0;
  for (const s of segments) {
    if (!s.result) continue;
    if (s.result.complete) decided += 1;
    // Counts a lead, not only a finished segment, so the running state of the
    // bet is visible mid-round — which is the whole appeal of a Nassau.
    if (s.result.lead > 0) balance += 1;
    else if (s.result.lead < 0) balance -= 1;
  }

  return { segments, balance, decided };
}
