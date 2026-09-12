import { isStrokeScored } from "./formats";

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

/**
 * THERE WAS A FIFTH, AND IT WAS NOT A ROUND.
 *
 * "Qualification Stage" was removed on 2026-09-11. Three things were true of
 * it at once, and together they made it the odd one out in a list of rounds:
 *
 * It was the only type the field does not PLAY — `isPlayingRound: false`, and
 * three separate files had to say "a Qualification Stage is a cut, not a
 * round" to stop readers counting it as one. Every sweep in the app carried
 * that exception.
 *
 * It DECIDED nothing on its own. Its one control wrote the EVENT's
 * `qualifyPerGroup`, and what actually selects a bracket's field is
 * `selectQualifiers(groups, qualifyPerGroup)` reading the group standings. The
 * stage row was a place to put a setting, not a step in the competition.
 *
 * And the app already had two better ways to say the same thing, which is the
 * point Ajay made when he asked for it to go: a round-to-round cut is a
 * property of the round it feeds (`cutEnabled`, and `cut.ts` calls itself "the
 * single source of truth" for it), and a bracket's qualifier is simply the
 * round the field plays before it — `bracket-visibility.ts` has always handled
 * "a stroke-play qualifier decides it by cards returned". *Let the organizer
 * decide which round that is*, rather than the app asking them to add a step
 * that is not golf.
 *
 * The qualification cut moved to the BRACKET's own settings, which is where it
 * belongs: how many players a bracket takes is the bracket's business.
 *
 * A consequence worth knowing: every remaining type is a playing round, so
 * `activeStage` is now non-null whenever a tournament has any stage at all.
 * Code that carried a `?? stages[0]` fallback for the qualification case no
 * longer needs it.
 */
export const STAGE_TYPES = [
  "Round Robin",
  "Stroke Play Round",
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
  /**
   * Whether this round's field comes from the event's QUALIFICATION settings
   * rather than from a cut on the round before it.
   *
   * True only for a bracket. Its field is the qualifiers the event seeds —
   * `qualifyMode`, `qualifyPerGroup`, `qualifyOverall` — and its results live
   * on the bracket, not in scorecards.
   *
   * Both of those were being ignored. A round cut set on a Bracket Stage did
   * not change who was in the bracket at all, so the published rules sheet
   * printed "Top 8 advance" while the engine seeded two per flight; and
   * "Generate" fabricated an empty stroke-play SCORECARD for each survivor of
   * a cut the bracket never applied, adding eighteen holes to everybody's
   * `holesOwed` for a round that is not scored that way at all.
   */
  seededFromQualifiers: boolean;
  /**
   * Whether somebody in this round is playing SOMEBODY, as opposed to playing
   * the course.
   *
   * Not the same question as `generatesPairings`, which is about whether the
   * SCHEDULER draws the fixtures. A bracket and a play-in draw no pairings —
   * their fixtures come from the seeding and from results — and both are
   * head-to-head all the same. Reading one for the other is what put Match
   * Play on a medal round: "Add stroke play round" produced "Round 1 · Stroke
   * Play Round — Match Play", a round with no opponents scored by a format
   * that needs one, and score entry then opened it in match mode with nothing
   * to enter.
   *
   * This is a fact about golf, so it is declared beside each type rather than
   * worked out at the call site. The rule it enforces is one line: a format
   * that needs an opponent is never chosen for a round that has none.
   */
  headToHead: boolean;
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
    seededFromQualifiers: false,
    headToHead: true,
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
    seededFromQualifiers: false,
    headToHead: false,
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
    // Left as it was, deliberately. A play-in's field is derived from results
    // too, so it may well have the same complaint — but the audit named the
    // bracket, and changing how a single match is generated is a separate
    // question that wants its own look.
    seededFromQualifiers: false,
    headToHead: true,
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
    seededFromQualifiers: true,
    headToHead: true,
  },
];

/**
 * The round types that make up a league's weeks.
 *
 * Narrower than isPlayingRound, deliberately. A bracket round and a play-off
 * are rounds the field plays, but they are not "week 4" — they are the end of
 * the thing. A league is a sequence of scheduled rounds where everyone goes
 * out and comes back, which is these two.
 */
export const WEEKLY_ROUND_TYPES: readonly StageTypeKey[] = ["Round Robin", "Stroke Play Round"];

/**
 * THE ROUNDS THAT MAKE A TOURNAMENT A KNOCKOUT.
 *
 * A bracket is a knockout draw, so a league or a medal that ends at its last
 * round has nothing to show on `/bracket` — `navForRole` hides the link on
 * exactly this condition, because without it "every tournament carried a
 * permanent door to an empty screen".
 *
 * This pair was written out in four separate files: the console layout, the
 * dashboard, `standingRows`, and the Reports screen. That is a rule with four
 * copies and no single place to correct it, which is how a fifth reader comes
 * to be written that never learned it — and one had been. The "Recommended
 * flow" card on `/event` told every organizer to visit the Bracket, on a
 * one-round charity day and a round-robin society league alike, which is the
 * same door reopened one screen along. `/reports` had the identical fault
 * closed on 2026-09-10 and the sidebar before that; this is the third time.
 *
 * ONE TYPE, NOW. There used to be two: a "Qualification Stage" counted as a
 * knockout's front half. It was removed on 2026-09-11 — see `STAGE_TYPES` —
 * and what seeds a bracket is the round the field actually plays, plus the
 * event's own `qualifyPerGroup`. Kept as a list rather than collapsed to a
 * comparison because a second knockout structure is a plausible thing to add
 * and every reader already asks this question through `hasKnockoutStage`.
 */
export const KNOCKOUT_STAGE_TYPES: readonly StageTypeKey[] = ["Bracket Stage"];

/**
 * STRUCTURE rather than a round the whole field plays.
 *
 * The type picker shows two groups — "Rounds the field plays" and "Structure" —
 * because nearly every round an organizer adds is the first kind, and showing
 * five peers made the common choice a five-way decision every time.
 *
 * It used to split on `isPlayingRound`, with the two structural types named as
 * exceptions on BOTH sides: `t.isPlayingRound && t.key !== "Single Match Stage"
 * && t.key !== "Bracket Stage"` for one group and the exact inverse for the
 * other. Two conditions that must stay opposite is the drift shape this
 * codebase keeps unwinding — invert one and a type lands in both groups or
 * neither.
 *
 * And after the "Qualification Stage" was removed on 2026-09-11 the
 * `isPlayingRound` half was dead: every remaining type is played, so the flag
 * decided nothing and only the names did.
 *
 * So the set is declared once and both groups read it. A single match is two
 * players and a bracket is a draw; neither is a round the field turns up for.
 */
export const STRUCTURAL_STAGE_TYPES: readonly StageTypeKey[] = ["Single Match Stage", "Bracket Stage"];

/** Whether this type is structure rather than a round the whole field plays. */
export function isStructuralStage(type: string): boolean {
  return (STRUCTURAL_STAGE_TYPES as readonly string[]).includes(type);
}

/**
 * The most rounds one click may create.
 *
 * A season, generously. High enough that no real league is refused, low enough
 * that a mistyped number cannot fill a tournament with hundreds of rounds
 * somebody then deletes one at a time.
 *
 * Lives here rather than beside addStage because a "use server" module may
 * only export async functions.
 */
export const MAX_ROUNDS_AT_ONCE = 40;

/** Whether this round is one of a league's weeks. */
export function isWeeklyRound(type: string): boolean {
  return (WEEKLY_ROUND_TYPES as readonly string[]).includes(type);
}

/** Whether this round is part of a knockout — the bracket, or the qualifying
 *  that seeds it. */
export function isKnockoutRound(type: string): boolean {
  return (KNOCKOUT_STAGE_TYPES as readonly string[]).includes(type);
}

/**
 * Whether this tournament has a knockout in it at all.
 *
 * The question every reader actually asks, so that none of them has to spell
 * the pair of types out — see `KNOCKOUT_STAGE_TYPES` for the four that did.
 */
export function hasKnockoutStage(stages: readonly { type: string }[]): boolean {
  return stages.some((s) => isKnockoutRound(s.type));
}

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

/**
 * Whether this round pits somebody against somebody.
 *
 * False for an unknown type, which is the safe direction: a type nobody has
 * taught the app about must not be handed a format that needs an opponent.
 */
export function isHeadToHead(type: string): boolean {
  return lookupStageType(type)?.headToHead ?? false;
}

/**
 * Whether a round produces STROKES rather than a match result.
 *
 * What decides whether a board prints a score or a win-loss-halved record, and
 * whether the column is headed with strokes or "match points".
 *
 * IT IS A FACT ABOUT THE ROUND, and that is the whole point. Every board used
 * to ask `event.format` — one value for a whole tournament — while each round
 * carries its own, so a match-play bracket inside an event whose format said
 * stroke tried to print strokes for a result that is "3&2". That is the second
 * half of an ordinary club championship, qualifier then bracket.
 *
 * IT TAKES BOTH THE TYPE AND THE FORMAT, and the first version took only the
 * type. That was wrong, and it shipped: a **Round Robin set to Stroke Play** is
 * head-to-head by type and a MEDAL in fact — it is what this file's own header
 * calls the shape the app had before `Stroke Play Round` existed, "the only way
 * to run one". Those rounds are still in the database and still scored off
 * cards, and calling them match play blanked every score on the board. Caught
 * on 2026-09-12 by measuring the shape rather than reasoning about it, after
 * three audit fixtures using it went red.
 *
 * So: a round is MATCH-scored only when somebody is drawn against somebody AND
 * the format is one the match engine scores. Anything else is strokes, which
 * is the safe direction — a card has a number to show, and a match played
 * without pairings has nothing.
 *
 * Neither half alone is enough, and it is worth saying why each is needed. The
 * TYPE is what makes a Four-Ball bracket match play and a Four-Ball medal not,
 * which no format string can tell you. The FORMAT is what makes a Round Robin
 * set to Stroke Play a medal, which no type can.
 */
export function roundIsStroke(type: string, format?: string): boolean {
  if (!isHeadToHead(type)) return true;
  // No format given: the type is the whole answer, which is right for a bare
  // type check and is what a caller with no stage in hand can ask.
  if (format === undefined) return false;
  return isStrokeScored(format);
}

/** Rounds the field actually plays, in play order. */
export function isPlayingRound(type: string): boolean {
  return lookupStageType(type)?.isPlayingRound ?? false;
}

/**
 * Whether this round's field is the event's qualifiers rather than the
 * survivors of a cut.
 *
 * False for an unknown type, which keeps a type nobody has taught the app about
 * on the ordinary path rather than silently exempting it.
 */
export function seededFromQualifiers(type: string): boolean {
  return lookupStageType(type)?.seededFromQualifiers ?? false;
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
