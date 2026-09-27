import "server-only";
import { prisma } from "../db";

/**
 * Whether removing this person would DESTROY something.
 *
 * Lives in a service rather than in `actions/tournament.ts`, where it was
 * written, because two actions now ask it — the organizer's `removeSignup` and
 * the member's own `withdrawMyEntry` — and a `"use server"` file turns every
 * export into a public endpoint. The two must answer this identically: a member
 * who withdraws themselves after playing a round must be kept as `withdrawn`
 * exactly as the organizer would keep them, or their card is deleted by the
 * door they happened to use.
 *
 * The whole point of the soft `withdrawn` path is that a delete is
 * unrecoverable, so the question this answers has to cover everything a delete
 * takes with it — not the two tables that happened to be checked.
 *
 * It counted `Scorecard` and `Match` only, and team golf writes NEITHER: a
 * partner's card goes to `TeamScorecard`, and a team match leaves the player
 * columns empty on purpose ("the sides are teams, so the player columns stay
 * empty"). So a pairs member-guest that had already played a round took the
 * hard-delete branch. `TeamMember` cascades, so the side lost that partner and
 * `teamStandings` rebuilt the four-ball from ONE ball — a finished round
 * silently re-scored, no longer agreeing with the `Match.holes` already stored
 * for it. `TeamScorecard.playerId` has no foreign key, so their card survived
 * as a row nothing can reach or render.
 *
 * `SkinsEntry` cascades too, and it is MONEY. Four players hand over $20 each
 * and the organizer ticks them in before play; take one name out of the field
 * between then and the cards going in, and the stake row goes with them — the
 * pot silently drops from $80 to $60 and the winner is paid $20 less than the
 * cash on the table, with nothing left to show a stake ever existed. Skins is
 * the only pot where this happens: ExpenseShare, ContestEntry and SideGameEntry
 * hold `playerId` as a plain column and survive, which is why the settle-up can
 * still render "Someone no longer in the field".
 *
 * Deliberately NOT counted: `RoundAttendance`, which is an intention rather than
 * a result and would turn every player who ever ticked a box into a permanent
 * withdrawn row; and `RoundHandicap`, which is derived from the roster and
 * survives the delete as a plain column anyway.
 */
export async function hasPlayingHistory(eventId: string, playerId: string): Promise<boolean> {
  const [cards, matches, teamCards, teamMemberships, stakes, ties] = await Promise.all([
    prisma.scorecard.count({ where: { eventId, playerId } }),
    prisma.match.count({
      where: { eventId, OR: [{ playerAId: playerId }, { playerBId: playerId }] },
    }),
    // Team golf's cards, which live in their own table.
    prisma.teamScorecard.count({ where: { eventId, playerId } }),
    // Being on a side at all: removing them re-scores that side's card.
    prisma.teamMember.count({ where: { playerId } }),
    // Money already collected. Cascades, so a delete destroys the record of it.
    prisma.skinsEntry.count({ where: { playerId } }),
    /**
     * TIES WON IN A KNOCKOUT, which is the fourth result table and was not
     * counted. A Bracket Stage files no Scorecard, no TeamScorecard and no
     * Match — its results are `BracketWinner` rows — so a player who had won
     * their way to a semi-final could read as having no history at all and be
     * hard DELETED rather than withdrawn.
     *
     * `winnerId` is a plain column with no relation, so the row survives the
     * delete exactly as `ExpenseShare` does, and the bracket is then left
     * naming an id that resolves to nobody. That is the same "an opponent who
     * does not exist" shape as #525, arrived at from the other direction.
     */
    prisma.bracketWinner.count({ where: { eventId, winnerId: playerId } }),
  ]);
  return (
    cards > 0 ||
    matches > 0 ||
    teamCards > 0 ||
    teamMemberships > 0 ||
    stakes > 0 ||
    ties > 0
  );
}
