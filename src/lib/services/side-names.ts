import { prisma } from "@/lib/db";

/**
 * A SIDE'S NAME, ASKED ONE WAY.
 *
 * A match between two sides (a four-ball or foursomes pair, a cup's team) leaves
 * `playerAId` / `playerBId` empty and carries `teamAId` / `teamBId`. Its sides
 * are named by the team's own name, which for a pair is the pair's names
 * ("Third & Fourth"). The match card, the casual round's one-line summary and
 * the day's result line each wrote this query out for themselves; this is the
 * one, and `a-side-is-named-once.test.ts` refuses a fourth.
 *
 * `eventId` is REQUIRED and part of the query: a team id from another event
 * names nobody here.
 */
export async function sideNamesOf(eventId: string, teamIds: string[]): Promise<Map<string, string>> {
  const ids = teamIds.filter((id) => id !== "");
  if (ids.length === 0) return new Map();
  const teams = await prisma.team.findMany({
    where: { id: { in: ids }, eventId },
    select: { id: true, name: true },
  });
  return new Map(teams.map((t) => [t.id, t.name]));
}
