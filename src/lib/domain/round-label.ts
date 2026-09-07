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

/**
 * The longest a round's own description may be and still work as a KICKER.
 *
 * A kicker is the small, upper-cased, letter-spaced line above a heading. It
 * is a label slot: "ROUND 2 · BLUE ASH". Twenty-four characters is about where
 * one stops being a label at that size — "Semi-finals", "Match 3 of 5" and
 * "Final round" all fit comfortably; a sentence does not.
 */
const KICKER_MAX = 24;

/**
 * A round's name for a LABEL SLOT, which is not the same as its name in prose
 * or its name in a heading.
 *
 * The description is the organizer's own words for the round, and where those
 * words are a name they beat any number the app can generate: "Semi-finals"
 * tells a player far more than "Round 3". But the same field holds whatever
 * they typed, and a template writes a whole sentence into it — the seeded
 * round robin's is "Every player meets every other in their group over 3
 * rounds."
 *
 * Rendered in an 11px upper-cased, letter-spaced kicker, that came out as
 *
 *   EVERY PLAYER MEETS EVERY OTHER IN THEIR GROUP OVER 3 ROUNDS.
 *
 * across two lines above a heading reading "Board", on both player screens.
 * The comment beside one of them claimed the kicker "already names the round";
 * it was reciting the round's blurb.
 *
 * Two tests, and the punctuation one is the sharper: a label does not end in a
 * full stop. The length cap catches the description that rambles without ever
 * reaching one. Where the description fails both, the caller's own fallback —
 * "Round 3", the stage type — takes over, which is what the slot was built for.
 */
export function roundKicker(description: string | null | undefined, fallback: string): string {
  const text = (description ?? "").trim();
  if (!text) return fallback;
  if (/[.!?]$/.test(text)) return fallback;
  if (text.length > KICKER_MAX) return fallback;
  return text;
}
