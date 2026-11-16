import { isIndividualStrokeRound } from "../stage-types";
import { usesStandardBoard } from "../formats";
import { holesPlayed } from "./handicap";

/**
 * HOW MANY HOLES A PLAYER'S OWN CARD MUST HOLD FOR A CLOSED ROUND TO COUNT AS
 * COMPLETED, on a board of STROKES. The one answer; the leaderboard's sink
 * (`missedClosedRoundId` in `services/tournament.ts`) and the week sheet's
 * "This week" (`services/week-view.ts`) both ask it, so the two screens that
 * place a field cannot disagree about a short card.
 *
 * INDIVIDUAL STROKE PLAY, on the ordinary board: every hole of the round. A
 * player must hole out at every hole (Rule 3.3c) and the score is the total of
 * them all (Rule 3.3a); a closed round is one no more holes are coming for, so
 * twelve holes of it are no more a round's score than none.
 *
 * EVERY OTHER ROUND: one hole, which is "did they play it at all", the test
 * there has always been. In four-ball, best ball and a shamble only one
 * partner need hole out (Rule 23.2b), so a blank hole on a partner's own card
 * is a pick-up, not a failure; in skins and a Nassau a player out of the hole
 * picks up, and neither is placed on this board anyway (`usesStandardBoard`).
 *
 * A POINTS board does not ask this at all: a hole not completed scores no
 * points and the player stays in (Rule 21.1c), so a short Stableford card is
 * ranked on the points it holds.
 *
 * Asked only of a round the committee has CLOSED. An open round's short card
 * is a card still in play, "thru 12", and keeps its provisional place.
 */
export function holesToComplete(round: { type: string; format: string; holes: number | null | undefined }): number {
  return isIndividualStrokeRound(round) && usesStandardBoard(round.format) ? holesPlayed(round.holes) : 1;
}
