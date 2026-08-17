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
export type FixedTiebreakerKey =
  | "head-to-head"
  | "most-wins"
  | "win-percentage"
  | "holes-won-ratio"
  | "fewest-holes-lost"
  | "lower-handicap";

/**
 * A countback over the N hardest holes, N chosen by the committee.
 *
 * Was two fixed keys, `toughest-6` and `toughest-3`, which is one club's
 * convention rather than a rule. Committees write their own ladder — hardest
 * 9, then 6, then 3, then the hardest hole — and each cut is tighter than the
 * one before it. Any N from 1 to 18 is now expressible, and a chain may hold
 * as many as a committee wants.
 */
export type ToughestTiebreakerKey = `toughest-${number}`;

export type TiebreakerKey = FixedTiebreakerKey | ToughestTiebreakerKey;

/** Holes on a full card — the ceiling on N. */
export const MAX_TOUGHEST_N = 18;

/**
 * The N in `toughest-N`, or null when the key is not one.
 *
 * Bounded here rather than at the call sites, because a key arrives from the
 * database as free text: `toughest-0` would decide nothing while looking like
 * a tiebreaker, and `toughest-99` would read holes off the end of the card.
 * Neither may be treated as a countback at all.
 */
export function toughestN(key: string): number | null {
  const m = /^toughest-(\d+)$/.exec(key);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isInteger(n) || n < 1 || n > MAX_TOUGHEST_N) return null;
  return n;
}

export const FIXED_TIEBREAKER_KEYS: FixedTiebreakerKey[] = [
  "head-to-head",
  "most-wins",
  "win-percentage",
  "holes-won-ratio",
  "fewest-holes-lost",
  "lower-handicap",
];

export function isTiebreakerKey(key: string): key is TiebreakerKey {
  return (FIXED_TIEBREAKER_KEYS as string[]).includes(key) || toughestN(key) !== null;
}

/** The chain a tournament starts with, before a committee changes it. */
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

const FIXED_TIEBREAKER_LABELS: Record<FixedTiebreakerKey, string> = {
  "head-to-head": "Head-to-head result",
  "most-wins": "Most match wins",
  "win-percentage": "Winning percentage",
  "holes-won-ratio": "Hole differential (won − lost)",
  "fewest-holes-lost": "Fewest holes lost",
  "lower-handicap": "Lower handicap",
};

export function tiebreakerLabel(key: string): string {
  const n = toughestN(key);
  if (n !== null) return `Toughest ${n} ${n === 1 ? "hole" : "holes"} (by stroke index)`;
  return FIXED_TIEBREAKER_LABELS[key as FixedTiebreakerKey] ?? key;
}

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
const TIEBREAKER_HELP: Record<FixedTiebreakerKey, string> = {
  "head-to-head":
    "Whoever won when these two played each other. If they never met, or their match was halved, this decides nothing and the next tiebreaker is used.",
  "most-wins": "Most matches won outright. Halved matches don't count either way.",
  "win-percentage":
    "Matches won as a share of matches played. Ranks a player who won 3 of 4 above one who won 3 of 6 — worth having where players have played different numbers of matches.",
  "holes-won-ratio":
    "Holes won minus holes lost across every match. The usual first countback in match play: it rewards winning holes rather than winning narrowly.",
  "fewest-holes-lost":
    "Fewest holes dropped across every match — the defensive twin of hole differential.",
  "lower-handicap":
    "The lower handicap ranks first. Traditional, and a definite answer — worth keeping last in the list so a tie always resolves.",
};

export function tiebreakerHelp(key: string): string {
  const n = toughestN(key);
  if (n !== null) {
    return (
      `Record on the ${n === 1 ? "hardest hole" : `${n} hardest holes`}, taken from the card's stroke ` +
      `index. Needs a stroke index on the course; without one it decides nothing and the next tiebreaker ` +
      `is used.` +
      (n <= 3 ? " A tight cut, for where a wider countback still leaves players level." : "")
    );
  }
  return TIEBREAKER_HELP[key as FixedTiebreakerKey] ?? "";
}

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
   * Points for playing a match — awarded once per match contested.
   *
   * Distinct from `bonusPts`, which is a single flat award per player however
   * many matches they play. In a league where availability varies week to week
   * that difference is the whole point: a regular who plays eight matches and
   * a stand-in who plays one both collected the same bonus, so turning up paid
   * nothing.
   *
   * A player who forfeits does not collect it. They take the configured loss
   * points and nothing else — they did not play the match.
   */
  playPts: number;
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
  /**
   * The player who forfeited, when the match was not played out.
   *
   * Covers the concession of a match (Rule 3.2b(1)), a no-show, and a
   * withdrawal — all of which end a match without a card, and none of which
   * the app could previously record at all. A conceded match had to be entered
   * as a fabricated scoreline or left Live forever.
   *
   * Empty means the match was played. When set it OVERRIDES the holes: the
   * opponent takes the win however few holes were entered before the player
   * walked in, because a conceded match is won, not led.
   *
   * Holds a player id in an individual match and a team id in a team match,
   * matching whichever pair of columns the round uses.
   */
  forfeitedBy?: string;
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
  /**
   * Matches that earn the appearance point — see ScoringRules.playPts.
   *
   * Separate from `played` because a forfeited match counts as played for both
   * sides (it is a win and a loss, and belongs in the record) but only the
   * player who turned up is paid for turning up.
   */
  playedForPoints: number;
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
  // Off by default: a tournament that never asked for an appearance point
  // should not suddenly start paying one.
  playPts: 0,
  // Off by default. A cap is a deliberate choice about how a flight should
  // feel, not something to impose on every tournament that never asked.
  maxPerMatch: 0,
  tiebreakers: DEFAULT_TIEBREAKERS,
};
