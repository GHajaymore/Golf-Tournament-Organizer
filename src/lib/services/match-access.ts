import "server-only";
import { prisma } from "../db";

/**
 * Whether this person is actually in this match.
 *
 * The rule existed three times over and only twice correctly. `assertOwnMatch`
 * in the tournament actions knows a four-ball partner counts through their
 * team; `nameMatchVenue` checked only the two player columns, which are EMPTY
 * in a team round — so it quietly refused every partner their own match. And
 * `setMatchCourse`, which writes the same fields as `nameMatchVenue`, checked
 * nothing at all: any signed-in player could repoint anybody's match at
 * another course and silently rescore it against a different stroke index
 * (S5 of the 2026-08-12 audit).
 *
 * One implementation, here, in a plain module rather than beside the actions —
 * a `"use server"` file may only export async functions, and every export of
 * one is a public endpoint. A guard should not be reachable over HTTP.
 *
 * Staff are not the subject: they may write any match in their tournament, and
 * callers check the role before asking this.
 */
export async function playsInMatch(
  eventId: string,
  email: string,
  match: { playerAId: string; playerBId: string; teamAId?: string; teamBId?: string },
): Promise<boolean> {
  const own = await prisma.player.findMany({
    where: { eventId, email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });
  const mine = new Set(own.map((p) => p.id));
  if (mine.size === 0) return false;

  if (match.playerAId && mine.has(match.playerAId)) return true;
  if (match.playerBId && mine.has(match.playerBId)) return true;

  // A team round leaves the player columns empty and puts the sides in the
  // team columns. Being in one of those teams is being in the match.
  const teamIds = [match.teamAId, match.teamBId].filter((id): id is string => !!id);
  if (teamIds.length === 0) return false;

  const member = await prisma.teamMember.findFirst({
    where: { teamId: { in: teamIds }, playerId: { in: [...mine] } },
    select: { id: true },
  });
  return !!member;
}
