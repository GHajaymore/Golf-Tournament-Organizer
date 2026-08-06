/**
 * What shape of tournament this is — asked once, at the start.
 *
 * It is the most consequential structural decision an organizer makes, and
 * until now the app never asked. Every tournament was offered every control:
 * a one-day charity scramble showed carry-forward percentages and a cut line
 * into a round that would never exist, and a straight knockout showed
 * round-robin scoring it would never use.
 *
 * The shape decides what the rest of setup is *about*. It is deliberately not
 * a lock — an organizer can still add any round type afterwards — but it sets
 * the defaults and hides the controls that cannot mean anything, which is the
 * difference between a setup screen that guides and one that interrogates.
 */

export type TournamentShape = "single" | "series" | "knockout";

export interface ShapeCapabilities {
  /**
   * Standings pass from one round to the next, so carry-forward and cut lines
   * are meaningful. False for a single round: there is nothing to carry into.
   */
  chainsRounds: boolean;
  /** A knockout bracket is part of this tournament. */
  hasBracket: boolean;
  /** More than one round is expected, so round-adding is a normal act. */
  multipleRounds: boolean;
}

export interface ShapeOption {
  key: TournamentShape;
  label: string;
  blurb: string;
  /** What this shape starts with, so nobody begins on an empty screen. */
  openingRound: { type: string; format: string; scoringBasis: string; holes: number };
}

export const TOURNAMENT_SHAPES: ShapeOption[] = [
  {
    key: "single",
    label: "A single round",
    blurb:
      "One day, one round, one result. A club medal, a charity day, a society outing — everyone plays, and the scores decide it.",
    openingRound: { type: "Round Robin", format: "Stroke Play", scoringBasis: "gross", holes: 18 },
  },
  {
    key: "series",
    label: "A series of rounds",
    blurb:
      "Several rounds that add up: a league over a season, or a championship over a weekend. Standings carry from one round to the next, and you can cut the field between them.",
    openingRound: { type: "Round Robin", format: "Match Play", scoringBasis: "gross", holes: 18 },
  },
  {
    key: "knockout",
    label: "A knockout",
    blurb:
      "Win and play on, lose and you're out. Start straight into the bracket, or qualify into it from a group stage first.",
    openingRound: { type: "Bracket Stage", format: "Match Play", scoringBasis: "gross", holes: 18 },
  },
];

export const DEFAULT_SHAPE: TournamentShape = "series";

export function isTournamentShape(v: string): v is TournamentShape {
  return v === "single" || v === "series" || v === "knockout";
}

/** Resolve a stored value, falling back rather than throwing — an unknown
 *  shape must never stop a tournament from opening. */
export function shapeOf(v: string | null | undefined): TournamentShape {
  return v && isTournamentShape(v) ? v : DEFAULT_SHAPE;
}

export function shapeOption(shape: TournamentShape): ShapeOption {
  return TOURNAMENT_SHAPES.find((s) => s.key === shape) ?? TOURNAMENT_SHAPES[1];
}

export function capabilitiesOf(shape: TournamentShape): ShapeCapabilities {
  switch (shape) {
    case "single":
      return { chainsRounds: false, hasBracket: false, multipleRounds: false };
    case "knockout":
      // A knockout can be fed by a group stage, so rounds still chain — the
      // qualifying round's standings decide the draw.
      return { chainsRounds: true, hasBracket: true, multipleRounds: true };
    case "series":
    default:
      return { chainsRounds: true, hasBracket: false, multipleRounds: true };
  }
}

/**
 * Whether a tournament has outgrown the shape it was set up as.
 *
 * The shape is a starting point, not a cage: an organizer who adds a bracket
 * to a series has simply changed their mind, and the app should follow rather
 * than argue. This reports that so the UI can stop hiding controls the
 * tournament now genuinely uses — the alternative is a bracket stage with no
 * way to reach its own screen.
 */
export function effectiveCapabilities(
  shape: TournamentShape,
  actual: { roundCount: number; hasBracketStage: boolean },
): ShapeCapabilities {
  const base = capabilitiesOf(shape);
  return {
    chainsRounds: base.chainsRounds || actual.roundCount > 1,
    hasBracket: base.hasBracket || actual.hasBracketStage,
    multipleRounds: base.multipleRounds || actual.roundCount > 1,
  };
}
