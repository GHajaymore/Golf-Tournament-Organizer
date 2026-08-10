// Core domain types for the Golf Tournament Organizer.
// These mirror the entities described in the design handoff (README) and are the
// single source of truth for the pure engine below — deliberately free of any
// framework, database, or React dependency so they can be unit-tested directly.

export type Role = "admin" | "player";
export type EventFormat = "match" | "stroke";
export type PlayerCountMode = "registration" | "manual";
export type SignupStatus = "confirmed" | "waitlisted";

/** Per-hole match-play result. `null` = not yet played. */
export type HoleResult = "A" | "B" | "H" | null;

export type StageType =
  | "Round Robin"
  | "Stroke Play Round"
  | "Qualification Stage"
  | "Single Match Stage"
  | "Bracket Stage";

export type FormationRule = "balanced" | "handicap" | "seeding" | "random" | "manual";

export type BracketKind = "winners" | "consolation";

/** Ordered tiebreaker keys, applied after points when standings are level.
 *  Match-play only — stroke play breaks ties by low net, then low gross. */
export type TiebreakerKey =
  | "head-to-head"
  | "most-wins"
  | "win-percentage"
  | "holes-won-ratio"
  | "fewest-holes-lost"
  | "lower-handicap"
  | "toughest-6"
  | "toughest-3";

export const TIEBREAKER_KEYS: TiebreakerKey[] = [
  "head-to-head",
  "most-wins",
  "win-percentage",
  "holes-won-ratio",
  "fewest-holes-lost",
  "toughest-6",
  "toughest-3",
  "lower-handicap",
];

export const TIEBREAKER_LABELS: Record<TiebreakerKey, string> = {
  "head-to-head": "Head-to-head result",
  "most-wins": "Most match wins",
  "win-percentage": "Winning percentage",
  "holes-won-ratio": "Hole differential (won − lost)",
  "fewest-holes-lost": "Fewest holes lost",
  "toughest-6": "Toughest 6 holes (by stroke index)",
  "toughest-3": "Toughest 3 holes (by stroke index)",
  "lower-handicap": "Lower handicap",
};

/**
 * What each tiebreaker actually does, in the words a committee would use.
 *
 * Kept beside the labels — and so beside compareByTiebreak, which implements
 * them — because the failure mode here is an explanation that describes what
 * somebody assumed the app does rather than what it does. Two of these have a
 * genuine catch that only shows up on the day, and both are stated plainly:
 * head-to-head does nothing between players who never met, and the countbacks
 * do nothing on a course with no stroke index entered.
 */
export const TIEBREAKER_HELP: Record<TiebreakerKey, string> = {
  "head-to-head":
    "Whoever won when these two played each other. If they never met, or their match was halved, this decides nothing and the next tiebreaker is used.",
  "most-wins": "Most matches won outright. Halved matches don't count either way.",
  "win-percentage":
    "Matches won as a share of matches played. Ranks a player who won 3 of 4 above one who won 3 of 6 — worth having where players have played different numbers of matches.",
  "holes-won-ratio":
    "Holes won minus holes lost across every match. The usual first countback in match play: it rewards winning holes rather than winning narrowly.",
  "fewest-holes-lost":
    "Fewest holes dropped across every match — the defensive twin of hole differential.",
  "toughest-6":
    "Record on the six hardest holes, taken from the card's stroke index. Needs a stroke index on the course; without one it decides nothing and the next tiebreaker is used.",
  "toughest-3":
    "As above, on the three hardest holes. A tighter countback where the six-hole one still leaves players level.",
  "lower-handicap":
    "The lower handicap ranks first. Traditional, and a definite answer — worth keeping last in the list so a tie always resolves.",
};

export interface Player {
  id: string;
  name: string;
  handicap: number;
  /** Ranking seed (1 = top). Drives "by seeding" grouping and display order. */
  seed: number;
  groupId?: string | null;
}

export interface ScoringRules {
  winPts: number;
  tiePts: number;
  lossPts: number;
  /** Points per net hole won (a scoring component and de-facto tiebreaker weight). */
  holeRatioPts: number;
  /** Flat bonus added per player. */
  bonusPts: number;
  /**
   * The most a player or side can take from any single match. Zero is no cap.
   *
   * Without one, a flight can be decided by a single thrashing: holes won
   * count toward points, so a 7&6 pays several times what a 1-up win pays and
   * the last match of the week is played for nothing. Capping the take keeps
   * a flight live to the end, which is why it is standard in member-guest
   * invitationals.
   *
   * The bonus sits outside the cap — it is a flat award for turning up, not
   * something earned from a match.
   */
  maxPerMatch: number;
  tiebreakers: TiebreakerKey[];
}

export interface Match {
  id: string;
  stageId: string;
  groupId: string;
  round: number;
  playerAId: string;
  playerBId: string;
  /** One entry per hole: 'A' | 'B' | 'H' | null. All match logic derives from this. */
  holes: HoleResult[];
}

export interface Group {
  id: string;
  name: string;
  playerIds: string[];
}

export interface Stage {
  id: string;
  position: number;
  type: StageType;
  description: string;
  deadline: string;
  carryForwardEnabled: boolean;
  /** 0–100 in steps of 5. */
  carryForwardPct: number;
}

/** Aggregated per-player record within a stage/group, derived (never stored). */
export interface PlayerStats {
  playerId: string;
  played: number;
  wins: number;
  losses: number;
  ties: number;
  holesWon: number;
  holesLost: number;
  /** Points from this stage's matches only (before any carry-forward). */
  points: number;
  /** points + carried-in points from the previous stage. */
  totalPoints: number;
}

export const DEFAULT_TIEBREAKERS: TiebreakerKey[] = [
  "head-to-head",
  "holes-won-ratio",
  "fewest-holes-lost",
  "lower-handicap",
];

export const DEFAULT_SCORING: ScoringRules = {
  winPts: 3,
  tiePts: 1,
  lossPts: 0,
  holeRatioPts: 0.5,
  bonusPts: 0,
  // Off by default. A cap is a deliberate choice about how a flight should
  // feel, not something to impose on every tournament that never asked.
  maxPerMatch: 0,
  tiebreakers: DEFAULT_TIEBREAKERS,
};
