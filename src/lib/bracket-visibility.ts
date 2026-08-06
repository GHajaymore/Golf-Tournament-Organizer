/**
 * When the bracket is worth showing.
 *
 * The question is never "how much round robin is done" — that assumes one
 * tournament shape. It's whether the thing that *decides* the bracket has got
 * far enough to mean something, and different tournaments decide it
 * differently:
 *
 *   - A round robin feeding a bracket decides it by matches played.
 *   - A stroke-play qualifier decides it by cards returned.
 *   - A Qualification Stage decides it outright, the moment it resolves.
 *   - A straight knockout has nothing feeding it at all: the bracket is the
 *     tournament, seeded from entry, and is meaningful from the first day.
 *
 * So this takes the *progress of whatever feeds the bracket*, expressed as a
 * fraction, and leaves it to the caller to measure that in its own terms. A
 * null feeder means nothing feeds it, which is a reason to show the bracket
 * immediately rather than a reason to hide it.
 *
 * Deliberately a rule rather than a model call: visibility has to be instant,
 * identical on every reload, and explainable to an organizer who asks why the
 * bracket disappeared. A non-deterministic answer to "should this be on
 * screen" is a bug however well it reads.
 */

/** Below this share of the feeder, seeding is mostly noise. */
export const BRACKET_MEANINGFUL_AT = 0.5;

export type BracketVisibility = "hidden" | "provisional" | "set";

export interface BracketProgress {
  /** Whether the tournament has a bracket at all. */
  hasBracketStage: boolean;
  /**
   * How far along the stages that decide the bracket are, from 0 to 1 — or
   * null when nothing feeds it, as in a straight knockout.
   *
   * Measured by the caller in whatever unit the feeder uses: matches for a
   * round robin, cards for stroke play. That keeps this rule free of any one
   * format's assumptions.
   */
  feederProgress: number | null;
  /** True once any bracket match has a recorded result. */
  bracketStarted: boolean;
  /** True once qualification has resolved who advances. */
  qualificationDecided: boolean;
}

export function bracketVisibility(p: BracketProgress): BracketVisibility {
  if (!p.hasBracketStage) return "hidden";

  // Being played beats every other consideration: it's the live competition.
  if (p.bracketStarted) return "set";

  // Qualification resolving is the whole point of a qualification stage —
  // the field is decided whatever fraction of anything else has happened.
  if (p.qualificationDecided) return "set";

  // Nothing feeds it: a straight knockout seeded from entry. The draw is known
  // from the start, so hiding it would withhold the tournament itself.
  if (p.feederProgress === null) return "set";

  if (p.feederProgress >= 1) return "set";
  if (p.feederProgress >= BRACKET_MEANINGFUL_AT) return "provisional";
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

/**
 * Fraction complete for whatever feeds the bracket.
 *
 * Returns null when nothing does — which the rule reads as "show it", not as
 * "no progress". Callers pass counts in the feeder's own unit, so a stroke
 * qualifier can pass cards returned and a round robin can pass matches.
 */
export function feederFraction(done: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.min(1, Math.max(0, done / total));
}
