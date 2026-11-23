import Link from "next/link";
import { prisma } from "@/lib/db";
import { cupBoard } from "@/lib/services/cup";
import { screenLocksFor } from "@/lib/services/tournament-status";
import { CupTeams, CreateCupTeams } from "@/components/CupTeams";
import { LockedOnce } from "@/components/setup/LockedOnce";

/**
 * THE PLAYERS ROOM'S CUP TEAMS TAB (R6): the cup's two teams, made and filled here while Players is shown
 * (`cupTeamsHome`). The teams are the tournament's two flights, so the page says so when there are not two.
 * It holds the `cup` scope's lock, once; the cup page's lineups and score stay where they are.
 */
export async function CupTeamsTab({ eventId, isAdmin }: { eventId: string; isAdmin: boolean }) {
  const [locks, flights, board] = await Promise.all([
    screenLocksFor(eventId, ["cup"]),
    prisma.group.findMany({
      where: { eventId, stageId: null, isCarrier: false },
      orderBy: { position: "asc" },
      select: { id: true, name: true, captainId: true },
    }),
    cupBoard(eventId, { staff: true }),
  ]);
  const locked = locks.locks.length > 0;

  let body;
  if (flights.length === 0) {
    body = <CreateCupTeams locked={locked} />;
  } else if (flights.length !== 2) {
    body = (
      <div className="card elev-sm" style={{ maxWidth: "62ch" }}>
        <p style={{ margin: 0, lineHeight: 1.6 }}>
          A cup is played between <strong>two teams</strong>, and the teams are this tournament&rsquo;s flights. This one has a different
          number of flights, so they can&rsquo;t be the two teams. Make it exactly two on <Link href="/grouping">Flights</Link> and name each after its team.
        </p>
      </div>
    );
  } else {
    const ids = flights.map((f) => f.id);
    const [players, unplaced] = await Promise.all([
      prisma.player.findMany({
        where: { eventId, status: "confirmed", groupId: { in: ids } },
        orderBy: { name: "asc" },
        select: { id: true, name: true, groupId: true, handicap: true, handicapSource: true, handicapType: true },
      }),
      prisma.player.findMany({
        where: { eventId, status: "confirmed", groupId: null },
        orderBy: { name: "asc" },
        select: { id: true, name: true, handicap: true, handicapSource: true, handicapType: true },
      }),
    ]);
    const roster = (id: string) =>
      players
        .filter((p) => p.groupId === id)
        .map((p) => ({ id: p.id, name: p.name, handicap: p.handicap, handicapSource: p.handicapSource, handicapType: p.handicapType }));
    const team = (f: (typeof flights)[number]) => ({ id: f.id, name: f.name?.trim() || "Team", captainId: f.captainId ?? "", players: roster(f.id) });
    body = (
      <CupTeams
        teams={[team(flights[0]), team(flights[1])]}
        unplaced={unplaced}
        inLineup={board.ok ? board.board.sessions.flatMap((s) => s.matches.flatMap((m) => m.playerIds)) : []}
        locked={locked}
      />
    );
  }

  return (
    <LockedOnce locks={locks.locks} isAdmin={isAdmin} correction={locks.correction} open={null}>
      {() => body}
    </LockedOnce>
  );
}
