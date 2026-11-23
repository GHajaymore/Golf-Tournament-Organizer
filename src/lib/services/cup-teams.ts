import "server-only";
import { prisma } from "@/lib/db";

/**
 * THE CUP'S TWO TEAMS AS `CupTeams` DRAWS THEM (R6): who is on each, who is on neither, and each captain. ONE loader, read by the
 * cup page's lineup region and by the Players room's Cup teams tab, so the two cannot name a team or a roster differently.
 *
 * `teams` is the two flights in their order (`cupBoard`'s `teams`, or the two flights read directly where there is no session yet).
 */
interface Person {
  id: string;
  name: string;
  handicap: number;
  handicapSource: string | null;
  handicapType: string | null;
}

export interface CupTeamsProps {
  teams: [
    { id: string; name: string; captainId: string; players: Person[] },
    { id: string; name: string; captainId: string; players: Person[] },
  ];
  unplaced: Person[];
}

export async function cupTeamsPropsFor(eventId: string, teams: readonly [{ id: string; name: string }, { id: string; name: string }]): Promise<CupTeamsProps> {
  const ids = teams.map((t) => t.id);
  const select = { id: true, name: true, handicap: true, handicapSource: true, handicapType: true } as const;
  const [players, unplaced, captains] = await Promise.all([
    prisma.player.findMany({ where: { eventId, status: "confirmed", groupId: { in: ids } }, orderBy: { name: "asc" }, select: { ...select, groupId: true } }),
    prisma.player.findMany({ where: { eventId, status: "confirmed", groupId: null }, orderBy: { name: "asc" }, select }),
    prisma.group.findMany({ where: { id: { in: ids }, eventId, isCarrier: false }, select: { id: true, captainId: true } }),
  ]);
  const team = (t: { id: string; name: string }) => ({
    id: t.id,
    name: t.name,
    captainId: captains.find((c) => c.id === t.id)?.captainId ?? "",
    players: players.filter((p) => p.groupId === t.id).map(({ groupId: _g, ...p }) => p),
  });
  return { teams: [team(teams[0]), team(teams[1])], unplaced };
}
