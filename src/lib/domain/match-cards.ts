/**
 * The join that was missing: a match's cards, read as players' cards.
 *
 * Strokes for a match live in `MatchScorecard`, keyed `(matchId, slot)`. Every
 * stroke reader in the app is keyed `(playerId, stageId)` — `parseStrokeCards`,
 * `aggregateStroke`, the countback, the leaderboard. So the numbers existed and
 * nothing could see them, which is why a to-par board in a match-play event was
 * a column of zeros (`services/tournament.ts`, the hard-coded
 * `gross: 0, net: 0, toPar: 0, thru: 0` row).
 *
 * WHAT WAS MISSING IS THE JOIN, NOT THE ARITHMETIC. Nothing here computes an
 * allowance, a net score or a countback: it resolves a slot to a player and
 * hands the card to the aggregation that already exists.
 *
 * Team cards are deliberately absent. They live in `TeamScorecard`, and a
 * side's card is not a player's card — a foursomes pair returns one card for
 * two people, and crediting it to either of them individually would invent a
 * round neither played.
 */

import { resolveMatch } from "./match";
import type { HoleResult } from "./types";

/** A row of `MatchScorecard`, as stored. */
export interface MatchCardRow {
  matchId: string;
  /** "A" | "B". Typed as a string because it arrives from the database. */
  slot: string;
  /** JSON array of per-hole gross strokes. */
  strokes: string;
}

/** The part of a `Match` this join needs. */
export interface MatchForCards {
  id: string;
  stageId: string;
  playerAId: string;
  playerBId: string;
  /** JSON `HoleResult[]` — who won each hole. */
  holes: string;
  forfeitedBy?: string | null;
}

/** A card resolved to the key every stroke reader already uses. */
export interface JoinedCard {
  playerId: string;
  stageId: string;
  strokes: string;
  /**
   * No more holes are coming for this card.
   *
   * NOT the same question as `matchSettled`, and deliberately read by a
   * different function. `matchSettled` answers "is the MATCH decided" — it
   * settles the bracket, the standings, the round and the money, and it is true
   * from the first hole written because that is how hole-by-hole match play is
   * recorded. This answers "can this CARD still gain holes", which decides one
   * thing only: whether the player is ranked on a stroke board.
   *
   * Merging the two is the defect shape `docs/scoring-input-model.md` exists to
   * prevent: a 5&4 match would never complete, its round would never close and
   * its pots would never pay out. Nothing about rounds, brackets or money
   * consults this flag.
   */
  finished: boolean;
}

/**
 * Whether a match card has stopped growing.
 *
 * Rule 3.2a(3): a match ends when a side leads by more holes than remain — so
 * a match won 5&4 is over on the 14th and the last four holes are never played.
 * Rule 3.2b: a player may concede a hole, a match, or walk in, and a conceded
 * hole has no score at all.
 *
 * `resolveMatch(...).winner !== null` is the Rules answer to "is this match
 * over", and it is read HERE rather than reused from `matchSettled` on purpose
 * — see `JoinedCard.finished`.
 *
 * An empty `holes` array is the schema default for a match nobody has touched,
 * and `resolveMatch([])` reports a halved match over zero holes. Guarded, or a
 * match that has never been played would claim to be finished.
 */
export function matchCardFinished(m: { holes: string; forfeitedBy?: string | null }): boolean {
  if (m.forfeitedBy) return true;
  let holes: HoleResult[];
  try {
    holes = JSON.parse(m.holes) as HoleResult[];
  } catch {
    return false;
  }
  if (!Array.isArray(holes) || holes.length === 0) return false;
  return resolveMatch(holes).winner !== null;
}

/**
 * Resolve every match card to `(playerId, stageId)`.
 *
 * Rows whose match is unknown, whose slot is neither A nor B, or whose slot has
 * no player (a bye) are dropped rather than guessed at — the same treatment
 * `parseStrokeCards` gives a card it cannot parse.
 *
 * One player can come back with SEVERAL cards for one stage: a Round Robin
 * stage holds the whole round robin, so a flight of four gives every player
 * three matches inside one round. That is not an error and they are all
 * returned; `aggregateStroke` is what has to cope with it.
 */
export function matchStrokeCards(cards: MatchCardRow[], matches: MatchForCards[]): JoinedCard[] {
  const byId = new Map(matches.map((m) => [m.id, m]));
  const finishedById = new Map(matches.map((m) => [m.id, matchCardFinished(m)]));
  const out: JoinedCard[] = [];

  for (const c of cards) {
    const m = byId.get(c.matchId);
    if (!m) continue;
    if (c.slot !== "A" && c.slot !== "B") continue;
    const playerId = c.slot === "A" ? m.playerAId : m.playerBId;
    if (!playerId) continue;
    out.push({
      playerId,
      stageId: m.stageId,
      strokes: c.strokes,
      finished: finishedById.get(c.matchId) ?? false,
    });
  }

  return out;
}
