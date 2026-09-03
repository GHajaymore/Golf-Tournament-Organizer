/**
 * What number a round is, answered once.
 *
 * "Round 3" was built by hand in about twenty places, off two different
 * counts, and the two disagree the moment a tournament has a cut in it.
 *
 *   `stage.position + 1`        counts EVERY stage, including a Qualification
 *                               stage — which is a cut, and is the one stage
 *                               type with `isPlayingRound: false`.
 *   index within playing rounds counts only the rounds the field tees off in.
 *
 * Round Robin, cut, Bracket is an ordinary shape for a club championship, and
 * it made the bracket "Round 3" on the Stages screen, on the Teams screen and
 * in the flight name the matches were filed under, while the prizes screen,
 * group games, score entry and the player's own dashboard all called the same
 * round "Round 2". Nothing was wrong with either count in isolation, which is
 * why it survived: each screen was self-consistent and no screen showed both.
 *
 * A CUT IS NOT A ROUND OF GOLF. Nobody plays it, nobody returns a card for it,
 * and a club that plays two rounds either side of a cut has played two rounds.
 * So the count here is over playing rounds, and a stage that is not one has no
 * number at all rather than a misleading one.
 *
 * Takes the stage LIST rather than a stage, deliberately. The number is a fact
 * about where a round sits among the others, so it cannot be read off the round
 * alone — and passing `position + 1` is exactly the shortcut that produced the
 * second answer.
 */

import { isPlayingRound } from "@/lib/stage-types";

/** All this needs of a round: which one it is, and whether it is played. */
export interface NumberedStage {
  id: string;
  type: string;
}

/**
 * Which round of golf this is, 1-based. Zero when it is not one.
 *
 * Safe to hand either the full stage list or one already filtered to playing
 * rounds — filtering twice changes nothing — so a caller that happens to have
 * only `playingStages` in scope cannot get a different answer from one that
 * has them all. What is NOT safe is handing it some other subset (the team
 * rounds, the Round Robins), because a subset is not the tournament; there is
 * a test for both halves of that.
 */
export function roundNumber(stages: readonly NumberedStage[], stageId: string): number {
  if (!stageId) return 0;
  let n = 0;
  for (const s of stages) {
    if (!isPlayingRound(s.type)) continue;
    n += 1;
    if (s.id === stageId) return n;
  }
  return 0;
}

/**
 * "Round 3", or empty for a stage the field does not play.
 *
 * Empty rather than "Round 0" or a throw: the caller knows what to say about a
 * cut on its own screen, and this does not.
 */
export function roundLabel(stages: readonly NumberedStage[], stageId: string): string {
  const n = roundNumber(stages, stageId);
  return n > 0 ? `Round ${n}` : "";
}

/**
 * "Round 3 — Match Play", with whatever the screen wants after the number.
 *
 * The suffix is dropped when it is empty, so a round with no format set reads
 * "Round 3" rather than "Round 3 — ". Several screens were assembling this by
 * hand and each had its own separator.
 */
export function roundLabelWith(
  stages: readonly NumberedStage[],
  stageId: string,
  suffix: string,
  separator = " · ",
): string {
  const base = roundLabel(stages, stageId);
  const tail = suffix.trim();
  if (!base) return tail;
  return tail ? `${base}${separator}${tail}` : base;
}
