import { prisma } from "@/lib/db";
import { leagueMeetings, leaguePlayoffs, leagueTable } from "@/lib/services/league";
import {
  isLeaguePointsSystem,
  LEAGUE_POINTS_LABEL,
  type LeaguePointsSystem,
} from "@/lib/domain/league-meeting";
import { LeagueMeetings } from "@/components/LeagueMeetings";
import { LeagueTable } from "@/components/LeagueTable";
import { LeaguePlayoffs } from "@/components/LeaguePlayoffs";

/**
 * THE LEAGUE AS A MEMBER SEES IT: who my club played, and where we stand.
 *
 * The whole interclub league lived on Teams, which is a staff screen. So a
 * member of a club in a twelve-club league could not see the league at all —
 * not their club's meeting on Thursday night, not the table on Friday
 * morning. `/week` is the screen a league member already opens (`roles.ts`
 * lists it for players) and it showed only the PLAYER standings, which for an
 * interclub league is the wrong competition.
 *
 * READ-ONLY, and that is the whole difference from the Teams section. No team
 * sheets, no draw, no settings: nominating is the captain's business and the
 * organizer's screen, and this is the record of what happened. Same components
 * as Teams renders, so the two cannot print different numbers.
 *
 * Renders nothing at all unless the tournament is a league, so every ordinary
 * weekly event sees what it saw before.
 */
export async function LeagueWeekSection({ eventId, stageId }: { eventId: string; stageId: string }) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { leaguePoints: true, leagueMatchBonus: true },
  });
  if (!isLeaguePointsSystem(event?.leaguePoints)) return null;

  const system: LeaguePointsSystem = event.leaguePoints;
  const matchBonus = event.leagueMatchBonus ?? 2;

  const [meetings, table, playoffs] = await Promise.all([
    leagueMeetings(eventId, stageId, system, matchBonus),
    leagueTable(eventId, system, matchBonus),
    leaguePlayoffs(eventId, system, matchBonus),
  ]);
  if (table.rows.length === 0) return null;

  return (
    <div className="card elev-sm" style={{ gap: 12, marginBottom: 16 }}>
      <div>
        <div className="card-kicker">The league</div>
        <span className="card-title" style={{ fontSize: 16 }}>
          Clubs and meetings
        </span>
        <p className="text-muted" style={{ margin: "4px 0 0", fontSize: 12.5 }}>
          {LEAGUE_POINTS_LABEL[system]}
        </p>
      </div>

      <div>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>This week&rsquo;s meetings</div>
        <LeagueMeetings meetings={meetings} system={system} matchBonus={matchBonus} />
      </div>

      <div>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
          {playoffs ? "Season table" : "League table"}
        </div>
        <LeagueTable rows={table.rows} pointsLabel="Points" orderNote={table.orderNote} />
      </div>

      {playoffs && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Play-offs</div>
          <LeaguePlayoffs playoffs={playoffs} />
        </div>
      )}
    </div>
  );
}
