/**
 * When the bracket is worth showing.
 *
 * A bracket seeded from two of forty-eight matches isn't cautious
 * information, it's noise — and organizers screenshot it and players argue
 * about it. The tile earns its place once the ordering is stable enough to
 * mean something.
 *
 * Deliberately a rule rather than a model call: UI visibility has to be
 * instant, identical on every reload, and explainable to an organizer who
 * asks why the bracket disappeared. A non-deterministic answer to "should
 * this be on screen" is a bug, however well it reads.
 */

/** Below this share of the round robin, seeding is mostly noise. */
export const BRACKET_MEANINGFUL_AT = 0.5;

export type BracketVisibility = "hidden" | "provisional" | "set";

export interface BracketProgress {
  /** Whether the tournament actually has a bracket stage configured. */
  hasBracketStage: boolean;
  /** Round-robin matches finished, and how many there are in total. */
  matchesComplete: number;
  matchesTotal: number;
  /** True once any bracket match has a recorded result. */
  bracketStarted: boolean;
  /** True once qualification has resolved who advances. */
  qualificationDecided: boolean;
}

export function bracketVisibility(p: BracketProgress): BracketVisibility {
  if (!p.hasBracketStage) return "hidden";

  // Once the bracket is being played it's the live competition, whatever the
  // round robin says.
  if (p.bracketStarted) return "set";

  if (p.matchesTotal === 0) return "hidden";
  const share = p.matchesComplete / p.matchesTotal;

  if (share >= 1 || p.qualificationDecided) return "set";
  if (share >= BRACKET_MEANINGFUL_AT) return "provisional";
  return "hidden";
}

/** Whether the tile should render at all. */
export function showBracket(p: BracketProgress): boolean {
  return bracketVisibility(p) !== "hidden";
}

/** Badge text for the tile, or null when it isn't shown. */
export function bracketBadge(p: BracketProgress): string | null {
  const v = bracketVisibility(p);
  if (v === "hidden") return null;
  return v === "set" ? "Set" : "Provisional";
}
