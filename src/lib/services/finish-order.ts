import "server-only";
import { bracketFinishOrder } from "../domain/bracket";
import type { loadEventState } from "./tournament";
import type { FinishingPosition } from "../domain/honours";

type EventState = NonNullable<Awaited<ReturnType<typeof loadEventState>>>;

/**
 * The order a finished tournament ended in. One answer, for everybody who asks.
 *
 * There were two readers of this question and they disagreed. The honours board
 * built its own list; the season table built another; and neither could see a
 * knockout at all, because both read the points standings and a knockout has no
 * points. `computeStandings` with no matches gives every player zero and falls
 * back to seed, which is handicap order — so the board proposed the lowest
 * handicap in the field as champion of a competition they may have lost in the
 * first round, and the season table scored everybody in handicap order behind
 * them.
 *
 * The two readers also drifted on a smaller thing: the season table filtered out
 * players who returned nothing and the honours board did not, so a match-play
 * event could propose a champion who never took the tee.
 *
 * Three sources, in the order they answer:
 *
 *   1. A KNOCKOUT is decided by its draw — the one place the result was already
 *      written down and the one place nobody looked.
 *   2. STROKE play ranks on the stroke standings, where `ranked` already means
 *      "holds a position" and a card that stopped short does not.
 *   3. Everything else ranks on the chained round-robin standings, filtered to
 *      players who actually played, and re-indexed so the survivors run 1..N
 *      without a gap where an absentee was — while KEEPING any tie that
 *      `rankPlayers` found, for the reason below.
 */
export function finishingPositions(state: EventState): FinishingPosition[] {
  const fromBracket = bracketFinishOrder(state.brackets.winners);
  if (fromBracket.length > 0) return fromBracket;

  if (state.isStroke) {
    return state.strokeStandings
      .filter((s) => s.ranked)
      .map((s) => ({ playerId: s.player.id, name: s.player.name, rank: s.rank }));
  }

  /**
   * Closing the absentee's gap is the whole job here; inventing a winner is not.
   *
   * This mapped `rank: i + 1`, which does both. `rankPlayers` gives two players
   * the SAME rank when the points are level and every configured tiebreaker
   * returns zero — deliberately, and it refuses to consult the seed fallback to
   * separate them because "using it here is exactly what hid the tie". Renumbering
   * the list positionally consulted the sort order instead, which for a level
   * field IS that seed fallback, one step removed.
   *
   * A genuinely halved flight therefore produced a champion: `suggestChampion`
   * looks for `leaders.length > 1` to refuse one, and that branch was unreachable
   * for every non-stroke event because two shared 1s always arrived here as a 1
   * and a 2. It went onto the honours board and into the season table as a
   * permanent record — the exact failure the shared rank was written to prevent.
   *
   * Same shape as `rankPlayers`' own rank pass, so the two cannot drift: a player
   * level with the one above keeps their rank, anyone else takes their position.
   * Absentees are filtered first, so the numbering still closes over them.
   */
  const played = state.overall.filter((rp) => rp.stats.played > 0);
  const ranks: number[] = [];
  played.forEach((rp, i) => {
    const prev = i > 0 ? played[i - 1] : null;
    ranks.push(prev && prev.rank === rp.rank ? ranks[i - 1] : i + 1);
  });

  return played.map((rp, i) => ({ playerId: rp.player.id, name: rp.player.name, rank: ranks[i] }));
}
