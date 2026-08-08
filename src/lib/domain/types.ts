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
  tiebreakers: DEFAULT_TIEBREAKERS,
};
