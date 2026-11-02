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

/**
 * A NAMED-WINNER CONTEST ON A SHARED-BALL ROUND: FREE, NEVER STAKED (2026-11-01).
 *
 * Closest to the pin and the long drive are not decided by a card. At a
 * scramble every player still hits their own tee shot on the par 3, and the
 * committee names whoever finished nearest — an individual, as at any outing.
 * So the contest itself is ordinary golf on a shared-ball round, and hiding it
 * there (which the screens did, by reading `perPlayerPotRefusal`) took away
 * something every scramble day runs.
 *
 * What stays refused is MONEY between players on such a round: the rule above
 * holds for every per-player pot, and a staked contest is one. A free contest
 * moves nothing, so it is allowed; a stake is refused at the action in words,
 * and if one ever reaches a shared-ball round anyway (the round's format
 * changed after the stake was set) the money sink reads it as free through
 * `contestStakeOnRound`, so it can never settle.
 *
 * ONE RULE, three readers: the screen asks `contestStakeNotOffered` to decide
 * whether to offer a stake box; the action asks `contestStakeRefusal`; the
 * ledger asks `contestStakeOnRound`. Both arguments are required, so a caller
 * cannot forget the round. `format` is null for a contest tied to no round.
 * `contest-stake-rule-one-place.test.ts` refuses a contest write or a contest
 * money reader that does not go through here.
 */
export function contestStakeNotOffered(format: string | null): string | null {
  if (format == null || !sharedBallRound(format)) return null;
  return `${format} is played with one ball per side, so a contest here is for the honour: no stake is offered, because the app keeps no per-player money on a shared-ball round.`;
}

/** Why this stake cannot go on a contest on this round, or null when it can. */
export function contestStakeRefusal(format: string | null, stakeCents: number): string | null {
  if (!(stakeCents > 0)) return null;
  const why = contestStakeNotOffered(format);
  if (!why) return null;
  return `${format} is played with one ball per side, so a contest on it can only be free. Set the stake to 0, or run the staked game on a round where everyone plays their own ball.`;
}

/** The stake the money may use: zero wherever the rule above refuses one. */
export function contestStakeOnRound(format: string | null, stakeCents: number): number {
  const stake = Math.max(0, Math.round(Number.isFinite(stakeCents) ? stakeCents : 0));
  return contestStakeRefusal(format, stake) ? 0 : stake;
}
