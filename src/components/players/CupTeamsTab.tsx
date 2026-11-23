import Link from "next/link";
import { prisma } from "@/lib/db";
import { cupBoard } from "@/lib/services/cup";
import { cupTeamsPropsFor } from "@/lib/services/cup-teams";
import { screenLocksFor } from "@/lib/services/tournament-status";
import { CupTeams, CreateCupTeams } from "@/components/CupTeams";
import { LockedOnce } from "@/components/setup/LockedOnce";

/**
 * THE PLAYERS ROOM'S CUP TEAMS TAB (R6): the cup's two teams, made and filled here while Players is shown
 * (`cupTeamsHome`). The teams are the tournament's two flights, so the page says so when there are not two.
 * It holds the `cup` scope's lock, once; the cup page's lineups and score stay where they are. Its rosters come from
 * `cupTeamsPropsFor`, the one loader the cup page's lineup region reads too.
 */
export async function CupTeamsTab({ eventId, isAdmin, flightsHref }: { eventId: string; isAdmin: boolean; flightsHref: string }) {
  const [locks, flights, board] = await Promise.all([
    screenLocksFor(eventId, ["cup"]),
    prisma.group.findMany({ where: { eventId, stageId: null, isCarrier: false }, orderBy: { position: "asc" }, select: { id: true, name: true } }),
    cupBoard(eventId, { staff: true }),
  ]);
  // The board's two teams when there is a board; the two flights themselves while there is no session yet.
  const two = board.ok ? board.board.teams : flights.length === 2 ? ([flights[0], flights[1]] as const) : null;
  const props = two ? await cupTeamsPropsFor(eventId, [two[0], two[1]]) : null;

  return (
    <LockedOnce locks={locks.locks} isAdmin={isAdmin} correction={locks.correction} open={null}>
      {(locked) =>
        flights.length === 0 ? (
          <CreateCupTeams locked={locked} />
        ) : !props ? (
          <div className="card elev-sm" style={{ maxWidth: "62ch" }}>
            <p style={{ margin: 0, lineHeight: 1.6 }}>
              A cup is played between <strong>two teams</strong>, and the teams are this tournament&rsquo;s flights. This one has a different
              number of flights, so they can&rsquo;t be the two teams. Make it exactly two on <Link href={flightsHref}>Flights</Link> and name each after its team.
            </p>
          </div>
        ) : (
          <CupTeams
            teams={props.teams}
            unplaced={props.unplaced}
            inLineup={board.ok ? board.board.sessions.flatMap((s) => s.matches.flatMap((m) => m.playerIds)) : []}
            locked={locked}
          />
        )
      }
    </LockedOnce>
  );
}
