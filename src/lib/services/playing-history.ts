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

/**
 * WITHDRAWING IS NOT A REFUND — FOR A STAKE PAID BY DEFAULT TOO (2026-10-07).
 *
 * Called by both doors that withdraw a player with history, for the reason
 * `hasPlayingHistory` lives here: they must answer identically.
 *
 * An "everyone in the field" pot counts a player with no entry row as IN and
 * PAID; that is what the mode means. A withdrawal takes them out of the field,
 * and with no row there was nothing left to say they had paid: the stake
 * vanished. Walked on a casual round — Cat paid into a $10 birdie pot,
 * birdied the 3rd and left at the turn, and the money read "Cat square",
 * refunded by nobody, with the pot $10 short.
 *
 * An explicitly taken stake already survives a withdrawal (`potMembership`'s
 * "paid but gone"); this writes the default one down as taken, at the moment
 * they leave, so it becomes that same case. ONLY on rounds they have a card
 * in: a tournament entrant who withdraws before a round never put money into
 * its pot. A row that already exists — taken, owed, or opted out — is a
 * decision somebody made, and is left as it is.
 *
 * The Nassau and the match bet are left out: they are settled by the match,
 * not a pot, and have no entrant list to write to.
 */
export async function keepDefaultStakes(eventId: string, playerId: string): Promise<void> {
  const [cards, teamCards, games] = await Promise.all([
    prisma.scorecard.findMany({ where: { eventId, playerId }, select: { stageId: true, strokes: true } }),
    prisma.teamScorecard.findMany({ where: { eventId, playerId }, select: { stageId: true, strokes: true } }),
    prisma.sideGame.findMany({
      where: { eventId, entryMode: "opt-out", kind: { notIn: ["nassau", "match"] } },
      select: { id: true, stageId: true, entrants: { where: { playerId }, select: { id: true } } },
    }),
  ]);
  const hasHole = (s: string) => {
    try {
      return (JSON.parse(s) as unknown[]).some((v) => v != null);
    } catch {
      return false;
    }
  };
  const playedIn = new Set([...cards, ...teamCards].filter((c) => hasHole(c.strokes)).map((c) => c.stageId));
  const toKeep = games.filter((g) => playedIn.has(g.stageId) && g.entrants.length === 0);
  if (toKeep.length === 0) return;
  await prisma.sideGameEntry.createMany({
    data: toKeep.map((g) => ({ sideGameId: g.id, playerId, confirmed: true })),
    skipDuplicates: true,
  });
}
