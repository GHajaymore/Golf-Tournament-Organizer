import "server-only";
import { prisma } from "@/lib/db";
import { lineupHidden, LINEUP_HIDDEN } from "@/lib/domain/cup-lineup";
import { myPlayerIds } from "@/lib/services/me";
import { keeperGate } from "@/lib/services/group-keeping";
import type { Session } from "@/lib/auth";
import { playerEntryRefusal } from "@/lib/domain/round-scoring";
import { cleanSettings } from "@/lib/tournament-settings";

/**
 * WHO IS IN A MATCH, and whether a player may write it — once (2026-11-04).
 *
 * "Being in a match" has two shapes. An individual match names its players in
 * `playerAId` / `playerBId`; a TEAM match names two sides and leaves those
 * columns empty by design, so membership is a `TeamMember` row on either side.
 * Reading only the player columns refused every four-ball partner their own
 * match — the fault each copy of this check records having had once.
 *
 * There were three copies: two inline in `actions/play.ts` (the round code's
 * hole-by-hole save and its phoned-in result) and `assertOwnMatch` in
 * `actions/tournament.ts` (the signed-in player's). They agreed, by being
 * written alike; now they are one, and the play-session twin of confirming a
 * result (sprint 2) asks the same one.
 */

export interface MatchSidesRow {
  playerAId: string;
  playerBId: string;
  teamAId?: string | null;
  teamBId?: string | null;
}

/** Whether any of `playerIds` plays in this match, on either side. */
export async function isInMatch(match: MatchSidesRow, playerIds: Iterable<string>): Promise<boolean> {
  const mine = new Set([...playerIds].filter(Boolean));
  if (mine.size === 0) return false;
  if ((match.playerAId && mine.has(match.playerAId)) || (match.playerBId && mine.has(match.playerBId))) return true;
  const teamIds = [match.teamAId, match.teamBId].filter((id): id is string => !!id);
  if (teamIds.length === 0) return false;
  const member = await prisma.teamMember.findFirst({
    where: { teamId: { in: teamIds }, playerId: { in: [...mine] } },
    select: { id: true },
  });
  return member !== null;
}

/** Everyone in the match, both sides, as player ids — what a write to it touches. */
export async function playersInMatch(match: MatchSidesRow): Promise<string[]> {
  const direct = [match.playerAId, match.playerBId].filter(Boolean);
  const teamIds = [match.teamAId, match.teamBId].filter((id): id is string => !!id);
  if (teamIds.length === 0) return direct;
  const members = await prisma.teamMember.findMany({ where: { teamId: { in: teamIds } }, select: { playerId: true } });
  return [...new Set([...direct, ...members.map((m) => m.playerId)])];
}

/**
 * A PLAYER MAY WRITE A MATCH: their own — or, on a round kept by ONE SCORER
 * PER GROUP, a match in the group whose card they keep (`keeperGate`).
 *
 * Returns the refusal in words, or the epoch the scorer holds. Staff never
 * come here: entering the whole field's cards is their job.
 */
export async function mayWriteMatch(input: {
  eventId: string;
  match: MatchSidesRow & { stageId: string };
  actorIds: readonly string[];
  epoch: number | undefined;
}): Promise<{ ok: true; epoch: number | null } | { ok: false; error: string; keeperName?: string }> {
  const kept = await keeperGate({
    eventId: input.eventId,
    stageId: input.match.stageId,
    actorIds: input.actorIds,
    targetIds: await playersInMatch(input.match),
    epoch: input.epoch,
  });
  if (kept.applies) {
    return kept.ok ? { ok: true, epoch: kept.epoch } : { ok: false, error: kept.error, keeperName: kept.keeperName };
  }
  return (await isInMatch(input.match, input.actorIds))
    ? { ok: true, epoch: null }
    : { ok: false, error: "You can only enter scores for your own match." };
}

/**
 * WHETHER A PLAYER MAY ENTER SCORES ON THIS ROUND, read from the rows: the one
 * gate (`playerEntryRefusal`) — the tournament's "staff" setting, then a round
 * the organizer keeps from paper cards. The sentence, or null.
 */
export async function playerRoundRefusal(eventId: string, stageId: string): Promise<string | null> {
  const [event, stage] = await Promise.all([
    prisma.event.findUnique({ where: { id: eventId }, select: { scoreEntryBy: true } }),
    prisma.stage.findFirst({ where: { id: stageId, eventId }, select: { scoreKeeping: true, endCheck: true } }),
  ]);
  if (!event) return null;
  return playerEntryRefusal(cleanSettings({ scoreEntryBy: event.scoreEntryBy }), stage);
}

/**
 * A signed-in player may write scores for their own match and nobody else's.
 *
 * `requireScoreEntry` answers "may this role enter scores at all"; it never
 * asked "for whom". With the answer missing, any signed-in player could
 * overwrite any match or any card in the event — the round-code path had this
 * check from day one, and the console path did not. Staff pass through
 * untouched: entering the whole field's cards is their job.
 *
 * On a round kept by one scorer per group, "their own" is the group's, and
 * only its scorer may write (`mayWriteMatch`).
 *
 * Moved here from `actions/tournament.ts` (2026-11-04), unchanged otherwise.
 */
export async function assertOwnMatch(session: Session, eventId: string, matchId: string, epoch?: number): Promise<void> {
  if (session.role !== "player") return;
  const match = await prisma.match.findFirst({
    where: { id: matchId, eventId },
    include: { stage: { select: { type: true, lineupPublished: true } } },
  });
  if (!match) throw new Error("Match not found.");
  // A cup match in a lineup nobody has announced: not playable yet. Every
  // match write a player can reach comes through here, so one check covers
  // the hole-by-hole, the result and the card paths alike.
  if (match.stage && lineupHidden(match.stage)) throw new Error(LINEUP_HIDDEN);
  // A round the organizer keeps from paper cards takes nothing from a player.
  const refused = await playerRoundRefusal(eventId, match.stageId);
  if (refused) throw new Error(refused);
  const own = await myPlayerIds(eventId, session.email);
  const may = await mayWriteMatch({ eventId, match, actorIds: [...own], epoch });
  if (!may.ok) throw new Error(may.error);
}
