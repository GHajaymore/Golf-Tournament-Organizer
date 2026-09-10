import { isHeadToHead } from "@/lib/stage-types";
import { lookupFormat } from "@/lib/formats";

/**
 * A round's TYPE and its FORMAT, disagreeing about whether anybody plays
 * anybody.
 *
 * Two settings on one round, and they answer different questions:
 *
 *   `Stage.type`    Round Robin, Stroke Play Round, Bracket… — whether the
 *                   scheduler draws opponents. `isHeadToHead` says which.
 *   `Stage.format`  Match Play, Stroke Play, Four-Ball… — how a hole is
 *                   scored once they are out there.
 *
 * Most pairs are fine and several are deliberate: a FOUR-BALL is played as a
 * match between two pairs and equally as a better-ball medal, and only the
 * type says which. That is the design, not an ambiguity to be resolved here,
 * and it is why this rule covers less than it could.
 *
 * WHAT IT DOES COVER is the half that is never a judgement call. Match Play
 * and a Nassau are decided hole by hole against an opponent, so a round with
 * no opponents cannot produce a result. Stroke play and the two Stablefords
 * are decided by a card, so drawing opponents produces a schedule of matches
 * nobody plays.
 *
 * MEASURED, not reasoned about. On 2026-09-10 a charity day was created from
 * its own template through the ordinary flow, eight players entered, flights
 * generated — and the app drew TWELVE head-to-head matches for a Stableford
 * outing. `stage-types.ts` has described that exact failure since the medal
 * round was added ("a round robin set to Stroke Play, which generated a full
 * set of pairings for a round in which nobody plays anybody"), and
 * `createEvent` quotes it back when explaining why "Start from scratch" no
 * longer defaults a round. Two named templates were still doing it.
 *
 * It is not only a stray schedule. `/me/card` reads `generatesPairings` to
 * decide whether a player owns their own card, so every player on that
 * charity day — a template that turns player self-scoring ON — was told
 * "Round Robin is match play, so your score is recorded against your opponent
 * rather than as your own card". The one screen they were meant to use.
 */

export interface RoundShapeMismatch {
  /** What is wrong, in the words the screen should use. */
  message: string;
}

/** Formats that cannot be scored without an opponent. */
const NEEDS_OPPONENT = new Set(["match", "nassau"]);

/**
 * Formats that are scored from a card and nothing else.
 *
 * Team engines are deliberately absent: a four-ball is a match or a medal
 * depending on the type, which is the whole reason the type exists.
 */
const NEEDS_CARD = new Set(["stroke", "stableford", "modified-stableford"]);

/**
 * Whether this round's type and format can produce a result together.
 *
 * Null when they can, which is the ordinary case and the answer for every
 * combination this cannot be certain about.
 */
export function roundShapeMismatch(type: string, format: string): RoundShapeMismatch | null {
  // `lookupFormat`, not `findFormat`: the latter falls back to GOLF_FORMATS[0]
  // — Match Play — so an unrecognised name would be judged as a match format
  // and refused for having no opponent. Unknown means no opinion.
  const engine = lookupFormat(format)?.engine;
  if (!engine) return null;
  const headToHead = isHeadToHead(type);

  if (headToHead && NEEDS_CARD.has(engine)) {
    return {
      message:
        `${format} is scored from each player's card, and ${type} draws a full set of pairings — ` +
        `so this round schedules matches nobody plays, and a player's own card screen tells them ` +
        `their score belongs to an opponent. Use a Stroke Play Round.`,
    };
  }

  if (!headToHead && NEEDS_OPPONENT.has(engine)) {
    return {
      message:
        `${format} is decided hole by hole against an opponent, and ${type} draws none — ` +
        `so there is nothing for this round to be scored against.`,
    };
  }

  return null;
}
