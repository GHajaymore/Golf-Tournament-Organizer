import "server-only";
import { bracketFinishOrder } from "../domain/bracket";
import { resolveMatch } from "../domain";
import type { loadEventState } from "./tournament";
import type { FinishingPosition } from "../domain/honours";

type EventState = NonNullable<Awaited<ReturnType<typeof loadEventState>>>;

/**
 * Who won the play-off for third, if one was played and settled.
 *
 * `round: 0` is the marker `createThirdPlaceMatch` uses and nothing else does —
 * a bracket's own rounds are 1-based. The match is stored outside the draw
 * because it is fed by losers rather than winners, which is exactly why the
 * bracket could not report its result on its own.
 *
 * Null for a match that exists but is not finished. A play-off half played is
 * not a placing, and the two semi-finalists genuinely share third until it is
 * settled — the same rule the bracket applies to an unfinished final.
 */
function thirdPlaceWinner(state: EventState): string | null {
  const playoff = state.matches.find((m) => m.round === 0);
  if (!playoff) return null;

  // A concession settles it as surely as a card does, and leaves no holes.
  if (playoff.forfeitedBy) {
    if (playoff.forfeitedBy === playoff.playerAId) return playoff.playerBId;
    if (playoff.forfeitedBy === playoff.playerBId) return playoff.playerAId;
    return null;
  }

  let holes;
  try {
    holes = JSON.parse(playoff.holes);
  } catch {
    return null;
  }
  const result = resolveMatch(holes);
  if (!result.complete) return null;
  // "H" is a HALVED play-off, and it separates nobody — the two stay sharing
  // third, which is where they started. Only A or B is a winner; treating
  // anything-not-A as B would have handed third to the wrong player on a
  // match that ended all square.
  if (result.winner === "A") return playoff.playerAId;
  if (result.winner === "B") return playoff.playerBId;
  return null;
}

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
 *      without a gap where an absentee was.
 */
export function finishingPositions(state: EventState): FinishingPosition[] {
  const fromBracket = bracketFinishOrder(state.brackets.winners, thirdPlaceWinner(state));
  if (fromBracket.length > 0) return fromBracket;

  if (state.isStroke) {
    return state.strokeStandings
      .filter((s) => s.ranked)
      .map((s) => ({ playerId: s.player.id, name: s.player.name, rank: s.rank }));
  }

  return state.overall
    .filter((rp) => rp.stats.played > 0)
    .map((rp, i) => ({ playerId: rp.player.id, name: rp.player.name, rank: i + 1 }));
}
