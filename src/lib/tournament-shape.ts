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

/**
 * `match` is the odd one out and is meant to be.
 *
 * The other three are shapes of TOURNAMENT — answers an organizer gives when
 * setting one up, and so the three the builder offers. A match is two people
 * playing each other, created from its own screen in one step, and it is
 * recorded here rather than inferred from "a single round with two players"
 * for the reason this codebase has been bitten by twice: a state inferred from
 * a comparison is a state that changes meaning the day the thing it is
 * compared against moves. A two-player field is a fact about today's entries;
 * being a match is a fact about what somebody set out to create, and only one
 * of those is still true after a third player is added.
 *
 * See `TOURNAMENT_SHAPES` for why it is absent from the builder's list.
 */
export type TournamentShape = "single" | "series" | "knockout" | "match";

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

/**
 * The shapes the tournament builder offers.
 *
 * Three, not four: `match` has its own screen, which asks two names and
 * creates everything in one step, so listing it here would be a fourth radio
 * button that leads to the same six screens the match screen exists to skip.
 * `MATCH_SHAPE` below carries its details for the code that needs them.
 */
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

/**
 * A match, described the same way as the three above so every reader of a
 * `ShapeOption` keeps working. Kept out of `TOURNAMENT_SHAPES` deliberately —
 * see the note on that array.
 */
export const MATCH_SHAPE: ShapeOption = {
  key: "match",
  label: "A match",
  blurb: "Two players, one round, hole by hole. Set it up in one screen and start scoring.",
  openingRound: { type: "Round Robin", format: "Match Play", scoringBasis: "gross", holes: 18 },
};

export const DEFAULT_SHAPE: TournamentShape = "series";

export function isTournamentShape(v: string): v is TournamentShape {
  return v === "single" || v === "series" || v === "knockout" || v === "match";
}

/** True for the one shape that is not a tournament. Asked by the screens that
 *  would otherwise talk to two friends about fields, flights and entries. */
export function isMatch(shape: string | null | undefined): boolean {
  return shapeOf(shape) === "match";
}

/** Resolve a stored value, falling back rather than throwing — an unknown
 *  shape must never stop a tournament from opening. */
export function shapeOf(v: string | null | undefined): TournamentShape {
  return v && isTournamentShape(v) ? v : DEFAULT_SHAPE;
}

export function shapeOption(shape: TournamentShape): ShapeOption {
  // MATCH_SHAPE is searched alongside the builder's three, because a shape
  // that is absent from the picker still has to describe itself everywhere
  // else. Without it, `shapeOption("match")` fell through to the fallback and
  // reported a match as a series of rounds — the opening round included.
  if (shape === "match") return MATCH_SHAPE;
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
    // Same answer as a single round, arrived at for a different reason: not
    // "this tournament happens to have one round" but "this is one game".
    // Spelled out rather than left to the fallback, because the fallback is a
    // series and a match that chains rounds offers two friends a cut line.
    case "match":
      return { chainsRounds: false, hasBracket: false, multipleRounds: false };
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
