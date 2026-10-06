import Link from "next/link";
import { screenMetadata } from "@/lib/screen-metadata";
import { requireScreen } from "@/lib/page-helpers";
import { prisma } from "@/lib/db";
import { cupBoard, type CupBoard } from "@/lib/services/cup";
import { CupScoreboard } from "@/components/CupScoreboard";
import { CupLineup } from "@/components/CupLineup";
import { CupTeams, CreateCupTeams } from "@/components/CupTeams";

export const metadata = screenMetadata("/cup");

/**
 * THE TEAM CUP (2026-09-28): the score everybody is watching, and — for staff —
 * the lineup of every session.
 *
 * The two teams are the tournament's two flights; each session is a round of
 * type "Team session". Both are set up where they always are (Flights, Rounds &
 * formats), and this screen says so when either is missing rather than
 * inventing a second place to do it.
 */
export default async function CupPage() {
  const session = await requireScreen("cup");
  const isStaff = session.viewRole === "admin" || session.viewRole === "assistant";
  // Staff see the draft lineups they are building; everyone else the cup as
  // announced — the same board the players and the public link read.
  const result = await cupBoard(session.eventId, { staff: isStaff });

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div className="page-kicker">Manage</div>
        <h1 className="page-title">Team cup</h1>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13, maxWidth: "62ch" }}>
          Two teams, sessions of matches, a point for every match and a half each for a halve.
        </p>
      </div>

      {!result.ok && result.reason === "teams" && isStaff && (await flightCount(session.eventId)) === 0 ? (
        // No flights at all: make the two teams right here, by name.
        <CreateCupTeams />
      ) : !result.ok ? (
        <div className="card elev-sm" style={{ maxWidth: "62ch" }}>
          {result.reason === "teams" ? (
            <p style={{ margin: 0, lineHeight: 1.6 }}>
              A cup is played between <strong>two teams</strong>, and the teams are this tournament&rsquo;s flights.
              {isStaff ? (
                <>
                  {" "}This one has a different number of flights, so they can&rsquo;t be the two teams. Make it
                  exactly two on <Link href="/grouping">Flights</Link> and name each after its team.
                </>
              ) : (
                " The organizer hasn't set the two teams up yet."
              )}
            </p>
          ) : (
            <p style={{ margin: 0, lineHeight: 1.6 }}>
              No sessions yet.
              {isStaff ? (
                <>
                  {" "}Add a round of type <strong>Team session</strong> on{" "}
                  <Link href="/stages">Rounds &amp; formats</Link> for each session — Four-Ball, Foursomes, or Match Play
                  for the singles.
                </>
              ) : (
                " The organizer hasn't added any sessions yet."
              )}
            </p>
          )}
        </div>
      ) : (
        <>
          <CupScoreboard board={result.board} />
          {isStaff && <StaffLineup eventId={session.eventId} board={result.board} />}
        </>
      )}
    </>
  );
}

/** Every flight the event has — none means the cup's teams can be made here. */
async function flightCount(eventId: string): Promise<number> {
  return prisma.group.count({ where: { eventId, stageId: null, isCarrier: false } });
}

async function StaffLineup({ eventId, board }: { eventId: string; board: CupBoard }) {
  const [event, players, unplaced, captains] = await Promise.all([
    prisma.event.findUnique({ where: { id: eventId }, select: { cupPointsToWin: true, cupHolderGroupId: true } }),
    prisma.player.findMany({
      where: { eventId, status: "confirmed", groupId: { in: board.teams.map((t) => t.id) } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, groupId: true, handicap: true, handicapSource: true, handicapType: true },
    }),
    prisma.player.findMany({
      where: { eventId, status: "confirmed", groupId: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, handicap: true, handicapSource: true, handicapType: true },
    }),
    prisma.group.findMany({
      where: { id: { in: board.teams.map((t) => t.id) }, eventId, isCarrier: false },
      select: { id: true, captainId: true },
    }),
  ]);
  const teamPlayers = (id: string) => players.filter((p) => p.groupId === id).map((p) => ({ id: p.id, name: p.name }));
  const captainOf = (id: string) => captains.find((c) => c.id === id)?.captainId ?? "";
  const roster = (id: string) =>
    players
      .filter((p) => p.groupId === id)
      .map((p) => ({ id: p.id, name: p.name, handicap: p.handicap, handicapSource: p.handicapSource, handicapType: p.handicapType }));
  return (
    <>
    <CupTeams
      teams={[
        { id: board.teams[0].id, name: board.teams[0].name, captainId: captainOf(board.teams[0].id), players: roster(board.teams[0].id) },
        { id: board.teams[1].id, name: board.teams[1].name, captainId: captainOf(board.teams[1].id), players: roster(board.teams[1].id) },
      ]}
      unplaced={unplaced}
      inLineup={board.sessions.flatMap((s) => s.matches.flatMap((m) => m.playerIds))}
    />
    <section aria-labelledby="lineups" style={{ marginTop: 8 }}>
      <h2 id="lineups" className="card-title" style={{ fontSize: 18, margin: "0 0 10px" }}>
        Lineups
      </h2>
      <CupLineup
        teams={[
          { id: board.teams[0].id, name: board.teams[0].name, players: teamPlayers(board.teams[0].id) },
          { id: board.teams[1].id, name: board.teams[1].name, players: teamPlayers(board.teams[1].id) },
        ]}
        pointsToWin={event?.cupPointsToWin ?? 0}
        holder={event?.cupHolderGroupId ?? ""}
        sessions={board.sessions.map((s) => ({
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
        }))}
      />
    </section>
    </>
  );
}
