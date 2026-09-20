import { findFormat } from "../formats";

/**
 * A ROUND WHERE THE SIDE PLAYS ONE BALL, AND SO HAS NO INDIVIDUAL SCORE.
 *
 * Foursomes, greensomes, alternate shot, Chapman, a scramble: partners hit one
 * ball between them, and the card that comes in belongs to the SIDE. There is
 * no such thing as what a player went round in.
 *
 * `round-cards.ts` states the consequence and keeps to it — "foursomes stays
 * out … inventing an individual score would pay a skin to a player who never
 * hit the shot". That is right, and it leaves a hole one level up: the pots
 * screen offered a per-player skins pot on such a round anyway. An organizer
 * could take £5 a head for a game with no per-player scores to decide it, and
 * the pot would sit staked for ever, never settling, never paying.
 *
 * Found on 2026-09-20 by putting a real pot on a seeded foursomes and watching
 * the money screen say "Nothing settled yet" over eight complete cards.
 *
 * SO THE REFUSAL IS THE FEATURE. A per-player pot on a shared-ball round is
 * not a thing golf has, and the honest answer is to say so where it is asked
 * for, rather than to invent an attribution.
 */
export function sharedBallRound(format: string): boolean {
  return findFormat(format).ball === "single";
}

/**
 * Why a per-player pot cannot run on this round, or null when it can.
 *
 * Names the format, because "this round" tells an organizer nothing when they
 * are looking at a list of six.
 */
export function perPlayerPotRefusal(format: string): string | null {
  if (!sharedBallRound(format)) return null;
  return `${format} is played with one ball per side, so there are no individual scores to decide a pot on. Run it on a round where everyone plays their own ball.`;
}
