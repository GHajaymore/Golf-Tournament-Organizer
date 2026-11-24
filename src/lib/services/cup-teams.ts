import "server-only";
import { prisma } from "@/lib/db";
import type { CupBoard } from "./cup";

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

/**
 * WHAT `CupLineup` IS HANDED (R9c): the two teams with their players, the cup's settings and every session of the board as the
 * lineup draws it. ONE reader, so the Team cup page and a session's own round on Tee times & draw cannot show different
 * pairs. `only` narrows it to one session (the round open on Tee times); absent, every session (the cup page).
 * `cupTeams` is returned too, for the cup page's team cards.
 */
export async function cupLineupPropsFor(eventId: string, board: CupBoard, only?: string) {
  const [event, cupTeams] = await Promise.all([
    prisma.event.findUnique({ where: { id: eventId }, select: { cupPointsToWin: true, cupHolderGroupId: true } }),
    cupTeamsPropsFor(eventId, board.teams),
  ]);
  const teamPlayers = (i: 0 | 1) => cupTeams.teams[i].players.map((p) => ({ id: p.id, name: p.name }));
  type Side = { id: string; name: string; players: { id: string; name: string }[] };
  const teams: [Side, Side] = [
    { id: board.teams[0].id, name: board.teams[0].name, players: teamPlayers(0) },
    { id: board.teams[1].id, name: board.teams[1].name, players: teamPlayers(1) },
  ];
  const lineup = {
    teams,
    pointsToWin: event?.cupPointsToWin ?? 0,
    holder: event?.cupHolderGroupId ?? "",
    sessions: board.sessions
      .filter((s) => only === undefined || s.id === only)
      .map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.kind,
        sideSize: s.sideSize,
        published: s.published,
        busy: s.matches.flatMap((m) => m.playerIds),
        matches: s.matches.map((m) => ({
          id: m.id,
          a: m.a,
          b: m.b,
          started: m.state.status !== "not-started" || m.conceded !== null,
          final: m.state.status === "final",
          label: m.state.label,
          aSideId: m.aSideId,
          bSideId: m.bSideId,
          conceded: m.conceded,
        })),
      })),
  };
  return { lineup, cupTeams };
}
