/**
 * The kinds of round a tournament can be made of.
 *
 * A round has two independent axes, and conflating them is the mistake this
 * file exists to prevent:
 *
 *   - its **type** — the structure. Does everyone play everyone? Does the
 *     field just return cards? Is it a knockout draw? That is what this file
 *     describes, and it decides what the app *generates*.
 *   - its **format** — how a score is turned into a result. Four-ball,
 *     Stableford, skins, scramble. That lives in formats.ts and is chosen
 *     separately on every round.
 *
 * So "a Stableford round" is not a type — it is a Stroke Play Round with the
 * Stableford basis. Adding it here would duplicate the format axis and force
 * an organizer to say the same thing twice. Only genuinely different
 * *structures* belong in this list.
 *
 * Each entry carries what the engine actually does with it, in the same
 * spirit as the `playable` flag in formats.ts: a picker that offers a type
 * nothing implements is worse than a picker that offers fewer.
 */

export const STAGE_TYPES = [
  "Round Robin",
  "Stroke Play Round",
  "Qualification Stage",
  "Single Match Stage",
  "Bracket Stage",
] as const;

export type StageTypeKey = (typeof STAGE_TYPES)[number];

export interface StageTypeInfo {
  key: StageTypeKey;
  /** What an organizer calls it. */
  label: string;
  /** The one-liner in the picker. */
  blurb: string;
  /** Stored on the stage as its description. */
  description: string;
  icon: string;
  /**
   * Whether the scheduler draws player-against-player pairings for it.
   *
   * False for a medal round: the field goes out and returns cards, and nobody
   * is playing "against" anyone. Generating pairings there produced matches
   * that were never played and could still be scored.
   */
  generatesPairings: boolean;
  /**
   * Whether this is a round the field actually plays — as opposed to a
   * structural marker like a cut. Playing rounds appear in score entry and
   * decide how many holes the tournament is being scored over.
   */
  isPlayingRound: boolean;
  /** Whether its results feed the running match-points standings. */
  chainsMatchPoints: boolean;
}

export const STAGE_TYPE_INFO: StageTypeInfo[] = [
  {
    key: "Round Robin",
    label: "Round robin",
    blurb: "Everyone plays everyone in their flight.",
    description: "Every player meets every other in their group.",
    icon: "ph ph-arrows-clockwise",
    generatesPairings: true,
    isPlayingRound: true,
    chainsMatchPoints: true,
  },
  {
    key: "Stroke Play Round",
    label: "Stroke play round",
    blurb: "The whole field plays and returns a card. No head-to-head pairings.",
    description: "The field plays the round and returns cards; standings come from the scores.",
    icon: "ph ph-flag-banner",
    // The medal round. It was missing entirely: the only way to run one was a
    // round robin set to Stroke Play, which generated a full set of pairings
    // for a round in which nobody plays anybody.
    generatesPairings: false,
    isPlayingRound: true,
    chainsMatchPoints: false,
  },
  {
    key: "Qualification Stage",
    label: "Qualification",
    blurb: "Cut the field — the top players carry on.",
    description: "Cut the field — top players per flight advance.",
    icon: "ph ph-funnel",
    generatesPairings: false,
    isPlayingRound: false,
    chainsMatchPoints: false,
  },
  {
    key: "Single Match Stage",
    label: "Single match",
    blurb: "One match — a play-off, a play-in, or a seeding decider.",
    description: "A single seeding or play-in match.",
    icon: "ph ph-sword",
    generatesPairings: false,
    isPlayingRound: true,
    chainsMatchPoints: false,
  },
  {
    key: "Bracket Stage",
    label: "Bracket",
    blurb: "Knockout draw to a champion, seeded from the standings.",
    description: "Single-elimination bracket to a champion.",
    icon: "ph ph-tree-structure",
    generatesPairings: false,
    isPlayingRound: true,
    chainsMatchPoints: false,
  },
];

export function isStageType(v: string): v is StageTypeKey {
  return (STAGE_TYPES as readonly string[]).includes(v);
}

/** Forgiving lookup for display; unknown types fall back to round robin. */
export function stageTypeInfo(key: string): StageTypeInfo {
  return STAGE_TYPE_INFO.find((t) => t.key === key) ?? STAGE_TYPE_INFO[0];
}

/** Null for an unknown type, so callers can tell "unknown" from "defaulted". */
export function lookupStageType(key: string): StageTypeInfo | undefined {
  return STAGE_TYPE_INFO.find((t) => t.key === key);
}

/**
 * Whether the scheduler should draw pairings for this type.
 *
 * Unknown types get `false` — the safe direction. A type nobody has taught the
 * scheduler about should produce no matches rather than a full round of
 * fabricated ones.
 */
export function generatesPairings(type: string): boolean {
  return lookupStageType(type)?.generatesPairings ?? false;
}

/** Rounds the field actually plays, in play order. */
export function isPlayingRound(type: string): boolean {
  return lookupStageType(type)?.isPlayingRound ?? false;
}

/**
 * The next round the field plays after a given position, of any format.
 *
 * The round-config chain used to look only for the next Round Robin, so a
 * Round Robin whose next round was a stroke-play final reported "No round after
 * this yet" and offered no way to cut into it. The next round is the next
 * *playing* stage, whatever its format — that is what a round feeds into.
 */
export function nextPlayingStage<T extends { position: number; type: string }>(
  stages: T[],
  afterPosition: number,
): T | undefined {
  return [...stages]
    .sort((a, b) => a.position - b.position)
    .find((s) => s.position > afterPosition && isPlayingRound(s.type));
}

export const STAGE_DESCRIPTIONS: Record<string, string> = Object.fromEntries(
  STAGE_TYPE_INFO.map((t) => [t.key, t.description]),
);
