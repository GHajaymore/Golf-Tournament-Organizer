import { prisma } from "@/lib/db";
import { flightsIn, nominationsFor } from "@/lib/services/league-nomination";
import { leagueMeetings, leaguePlayoffs, leagueTable } from "@/lib/services/league";
import {
  isLeaguePointsSystem,
  LEAGUE_POINTS_LABEL,
  type LeaguePointsSystem,
} from "@/lib/domain/league-meeting";
import { PairBuilder } from "@/components/PairBuilder";
import { LeagueMeetings } from "@/components/LeagueMeetings";
import { LeagueTable } from "@/components/LeagueTable";
import { LeagueSettings } from "@/components/LeagueSettings";
import { LeagueDraw } from "@/components/LeagueDraw";
import { LeaguePlayoffs } from "@/components/LeaguePlayoffs";

/**
 * AN INTERCLUB LEAGUE, ON THE SCREEN THAT ALREADY OWNS SIDES.
 *
 * Three things a captain and an organizer want on a Thursday, in the order
 * they want them: this week's team sheets, this week's meetings, and where the
 * clubs stand after six weeks.
 *
 * THE CLUB IS A FLIGHT. `Group` already is what a league club is: named,
 * belonging to the tournament rather than a round, its roster is
 * `Player.groupId`, and it carries the optional captain the organizer appoints
 * in flights setup. A league is a tournament whose flights are clubs.
 */
export async function LeagueSection({
  eventId,
  stageId,
  canEdit,
}: {
  eventId: string;
  stageId: string;
  /** Whether the viewer may change the league's rules — the organizer only. */
  canEdit: boolean;
}) {
  const clubs = await flightsIn(eventId);
  if (clubs.length === 0) return null;

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      leaguePoints: true,
      leagueMatchBonus: true,
      leaguePairs: true,
      leaguePlayoffClubs: true,
    },
  });

  const matchBonus = event?.leagueMatchBonus ?? 2;
  const pairs = event?.leaguePairs ?? 0;

  /**
   * A LEAGUE IS SWITCHED ON, NOT INFERRED. Flights and a four-ball round are
   * what a league is made of, and also what an ordinary flighted four-ball is
   * made of — so the section used to appear on both, calling a club's flights
   * "clubs" and its draw "meetings". Choosing a scoring system is the switch.
   *
   * Until then the organizer gets the switch and nobody else gets anything.
   */
  if (!isLeaguePointsSystem(event?.leaguePoints)) {
    if (!canEdit) return null;
    return (
      <section style={{ marginTop: 28 }}>
        <div className="page-kicker">League</div>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          Running a club league — flights as clubs, pairs nominated each week,
          meetings and a table? Choose a scoring system to switch it on.
        </p>
        <LeagueSettings
          points=""
          matchBonus={matchBonus}
          pairs={pairs}
          playoffs={event?.leaguePlayoffClubs ?? 0}
          canEdit={canEdit}
        />
      </section>
    );
  }
  const system: LeaguePointsSystem = event.leaguePoints;

  const [meetings, table, nominations, drawn, playoffs] = await Promise.all([
    leagueMeetings(eventId, stageId, system, matchBonus),
    leagueTable(eventId, system, matchBonus),
    Promise.all(clubs.map((c) => nominationsFor(eventId, stageId, c.id))),
    prisma.match.count({ where: { eventId, stageId } }),
    leaguePlayoffs(eventId, system, matchBonus),
  ]);

  return (
    <section style={{ marginTop: 28 }}>
      <div className="page-kicker">League</div>
      <h2 className="page-title" style={{ fontSize: 20, margin: "4px 0 0" }}>
        Clubs, pairs and meetings
      </h2>
      <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
        {LEAGUE_POINTS_LABEL[system]}
      </p>
      <LeagueSettings
        points={system}
        matchBonus={matchBonus}
        pairs={pairs}
        playoffs={event?.leaguePlayoffClubs ?? 0}
        canEdit={canEdit}
      />

      <h3 style={{ fontSize: 15, margin: "20px 0 10px" }}>
        This week&rsquo;s team sheets
      </h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {nominations
          .filter((n): n is NonNullable<typeof n> => n !== null)
          .map((club) => (
            <PairBuilder key={club.clubId} club={club} stageId={stageId} />
          ))}
      </div>
      <LeagueDraw stageId={stageId} drawn={drawn} />

      <h3 style={{ fontSize: 15, margin: "28px 0 10px" }}>
        This week&rsquo;s meetings
      </h3>
      <LeagueMeetings
        meetings={meetings}
        system={system}
        matchBonus={matchBonus}
      />

      <h3 style={{ fontSize: 15, margin: "28px 0 10px" }}>
        {playoffs ? "Season table" : "League table"}
      </h3>
      <LeagueTable rows={table} pointsLabel="Points" />

      {playoffs && (
        <>
          <h3 style={{ fontSize: 15, margin: "28px 0 10px" }}>Play-offs</h3>
          <LeaguePlayoffs playoffs={playoffs} />
        </>
      )}
    </section>
  );
}
