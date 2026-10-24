import "server-only";
import { loadEventState } from "./tournament";
import { valueOnBasis, type WeekBasis } from "../domain/week-basis";
import type { MovementInput } from "../domain/week-movement";

/**
 * THE STROKE TABLE AFTER A ROUND IS THE BOARD, RANKED THROUGH THAT ROUND.
 *
 * Rules of Golf, Rule 3.3a: in stroke play the winner is the player who
 * completes ALL the rounds in the fewest total strokes. A cut is a term of the
 * competition (Committee Procedures 5A): those it leaves out are not playing
 * the rounds after it, so they hold no place in a total of those rounds, and
 * neither does a player who withdrew or has not completed. After round 2 of a
 * thirty-six-hole championship cut to sixteen, the table is the sixteen on
 * thirty-six holes — and the twelve who went home on round 1 are beneath it,
 * without a place, or not on it at all.
 *
 * The league week sheet used to build this itself: it added up whatever cards
 * each player held and ranked the totals. On a stroke basis that ranked the
 * twelve who missed the cut on ONE round's strokes against the survivors' two,
 * so "standings after round 2" was led by twelve players who did not play it.
 * In a weekly stroke league it did the same to anybody who missed a week:
 * fewer strokes, so higher. Found 2026-10-21 building the tournament report,
 * which read the board instead.
 *
 * So there is one answer and this is it: `loadEventState(eventId, stageId)` —
 * the reading the cut itself is made on (`applyStrokeCut`) — keeping only the
 * players the board gives a place (`ranked`), with the board's own place
 * (countback and all) and the board's own figure. Who holds a place is the
 * board's rule and is not restated here: a cut applied after a round, a closed
 * round with no card on it (a stroke board; a Stableford board charges the
 * points instead and keeps the player), a card stopped short.
 *
 * `value` is the total on the basis the board RANKS on, not on whatever basis
 * a caller would like to print, so the column beside the places runs in their
 * order. `holes` is carried because the board ranks against par for the holes
 * played: while a round is live a player thru 27 can sit above one thru 36,
 * and a total printed without its holes would read as out of order.
 */
export interface StandingThrough extends MovementInput {
  name: string;
  value: number;
  rank: number;
  /** Holes the total is over. */
  holes: number;
}

export async function standingsThroughRound(
  eventId: string,
  stageId: string,
): Promise<{ rows: StandingThrough[]; basis: WeekBasis } | null> {
  const board = await loadEventState(eventId, stageId);
  if (!board) return null;
  const basis = board.strokeRankingBasis;
  const rows = board.strokeStandings
    .filter((s) => s.ranked && s.thru > 0)
    .map((s) => ({
      playerId: s.player.id,
      name: s.player.name,
      value: valueOnBasis(basis, { gross: s.gross, net: s.net, points: s.points }),
      rank: s.rank,
      holes: s.thru,
    }));
  return { rows, basis };
}
