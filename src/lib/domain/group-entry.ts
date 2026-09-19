import { canEnterScoreFor } from "./attest";
import type { TeeSheet } from "./tee-sheet";

/**
 * WHO A PLAYER MAY KEEP SCORE FOR ON A STROKE CARD: THEMSELVES, AND THE
 * FOURSOME THEY WERE DRAWN WITH.
 *
 * The club asked for score entry "individual and foursome" — one phone in a
 * group keeping everyone's card, which is how a marker has always worked on
 * paper. `domain/attest.ts` has held the rule since it was written — "a player
 * may write down scores for their own scoring group and nobody else" — and
 * nothing called it: the save action allowed a player their own card only.
 *
 * THE GROUP IS THE PUBLISHED TEE SHEET'S, AND ONLY THAT. A draft draw is the
 * committee's to reshuffle (the rule `services/me.ts` follows for showing a
 * group at all), so until it is published a player keeps their own card and
 * nobody else's. And only CONFIRMED players count: a withdrawn player left on
 * the sheet is not somebody whose card the group should be writing.
 *
 * Certifying and disputing are NOT widened. Whose card it is decides who signs
 * it; keeping the numbers for a partner is not signing for them.
 */

/** The published foursomes, each narrowed to the confirmed field. */
export function publishedFoursomes(
  sheet: TeeSheet | null,
  published: boolean,
  confirmed: ReadonlySet<string>,
): string[][] {
  if (!published || !sheet) return [];
  return sheet.groups.map((g) => g.playerIds.filter((id) => confirmed.has(id))).filter((g) => g.length > 0);
}

/**
 * Whether someone who IS `ownIds` may write `target`'s stroke card.
 *
 * Matches are passed as none: this is the stroke card, and a round played as
 * a match is scored on the match screen under `assertOwnMatch`.
 */
export function mayWriteCard(ownIds: ReadonlySet<string>, target: string, foursomes: string[][]): boolean {
  if (ownIds.has(target)) return true;
  const ctx = { foursomes, matches: [] };
  for (const me of ownIds) {
    if (canEnterScoreFor(me, target, ctx)) return true;
  }
  return false;
}

/** The rest of `playerId`'s published foursome, in draw order. */
export function partnersOf(playerId: string, foursomes: string[][]): string[] {
  return (foursomes.find((g) => g.includes(playerId)) ?? []).filter((id) => id !== playerId);
}
