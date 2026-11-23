import Link from "next/link";
import { screenMetadata } from "@/lib/screen-metadata";
import { requireScreen } from "@/lib/page-helpers";
import { prisma } from "@/lib/db";
import { cupBoard, type CupBoard } from "@/lib/services/cup";
import { CupScoreboard } from "@/components/CupScoreboard";
import { CupLineup } from "@/components/CupLineup";
import { CupTeams, CreateCupTeams } from "@/components/CupTeams";
import { CupOtherPoints } from "@/components/CupOtherPoints";
import { ScopeLockBanner } from "@/components/ScopeLockBanner";
import { screenLocksFor } from "@/lib/services/tournament-status";
import type { ScopeLock } from "@/lib/domain/tournament-status";
import { headers } from "next/headers";
import { cupTeamsPropsFor } from "@/lib/services/cup-teams";
import { screensShownFor } from "@/lib/services/screens-shown";
import { PLAYER_TABS, cupTeamsHome, playerTabHref } from "@/lib/domain/players-tabs";

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
  /**
   * WHAT THE MACHINE LOCKS HERE (PR L): the teams are the `cup` scope (making them, a team's name, who is on it) and the
   * points to win and the holder are the `rounds` scope — the two `actions/cup.ts` asks. The lineup, the captain and the
   * points are the day's work and are never behind either.
   */
  const locks = isStaff ? await screenLocksFor(session.eventId, ["cup", "rounds"]) : { locks: [], correction: null };
  const teamsLocked = locks.locks.some((l) => l.scope === "cup");
  const settingsLocked = locks.locks.some((l) => l.scope === "rounds");
  // THE CUP'S TEAMS HAVE ONE HOME (R6): here, or on Players' Cup teams tab while Players is shown (`cupTeamsHome`).
  const playersShown = (await screensShownFor(session)).has("players");
  const teamsHere = cupTeamsHome(playersShown) === "cup";
  const teamsTabHref = playerTabHref(PLAYER_TABS.find((t) => t.key === "cup")!, (await headers()).get("x-search") ?? "");

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div className="page-kicker">Manage</div>
        <h1 className="page-title">Team cup</h1>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13, maxWidth: "62ch" }}>
          Two teams, sessions of matches, a point for every match and a half each for a halve.
        </p>
      </div>

      {isStaff && <ScopeLockBanner locks={locks.locks} correction={locks.correction} isAdmin={session.viewRole === "admin"} />}

      {!result.ok && result.reason === "teams" && isStaff && (await flightCount(session.eventId)) === 0 ? (
        // No flights at all: make the two teams right here, by name (on Players' Cup teams tab while that is shown).
        teamsHere ? (
          <CreateCupTeams locked={teamsLocked} />
        ) : (
          <div className="card elev-sm" style={{ maxWidth: "62ch" }}>
            <p style={{ margin: 0, lineHeight: 1.6 }}>
              The cup&rsquo;s two teams are made on <Link href={teamsTabHref}>Players &rarr; Cup teams</Link>.
            </p>
          </div>
        )
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
          <p style={{ margin: "12px 0 0" }}>
            <Link href="/cup/report" className="btn" style={{ minHeight: 44, display: "inline-flex", alignItems: "center" }}>
              {result.board.verdict.kind === "open" ? "The report so far" : "Final report"}
            </Link>
            {/* The Print kit with the cup's own sheets ticked: a card per match, both nines on it,
                and the cart signs. From the session with sides, which carries the singles on its card. */}
            {isStaff && result.board.sessions.length > 0 && (
              <Link
                href={`/print?round=${(result.board.sessions.find((s) => s.sideSize > 1) ?? result.board.sessions[0]).id}&docs=cup,slips,signs,spare`}
                className="btn btn-secondary"
                style={{ minHeight: 44, display: "inline-flex", alignItems: "center", marginLeft: 10 }}
              >
                Print…
              </Link>
            )}
          </p>
          {isStaff && <StaffLineup eventId={session.eventId} board={result.board} teamsHere={teamsHere} teamsTabHref={teamsTabHref} teamsLocked={teamsLocked} settingsLocked={settingsLocked} settingsLock={locks.locks.find((l) => l.scope === "rounds") ?? null} />}
        </>
      )}
    </>
  );
}

/** Every flight the event has — none means the cup's teams can be made here. */
async function flightCount(eventId: string): Promise<number> {
  return prisma.group.count({ where: { eventId, stageId: null, isCarrier: false } });
}

async function StaffLineup({
  eventId,
  board,
  teamsHere,
  teamsTabHref,
  teamsLocked,
  settingsLocked,
  settingsLock,
}: {
  eventId: string;
  board: CupBoard;
  teamsHere: boolean;
  teamsTabHref: string;
  teamsLocked: boolean;
  settingsLocked: boolean;
  settingsLock: ScopeLock | null;
}) {
  const [event, cupTeams] = await Promise.all([
    prisma.event.findUnique({ where: { id: eventId }, select: { cupPointsToWin: true, cupHolderGroupId: true } }),
    cupTeamsPropsFor(eventId, board.teams),
  ]);
  const teamPlayers = (i: 0 | 1) => cupTeams.teams[i].players.map((p) => ({ id: p.id, name: p.name }));
  return (
    <>
    {teamsHere ? (
      <CupTeams
        teams={cupTeams.teams}
        unplaced={cupTeams.unplaced}
        inLineup={board.sessions.flatMap((s) => s.matches.flatMap((m) => m.playerIds))}
        locked={teamsLocked}
      />
    ) : (
      <p className="text-muted" style={{ fontSize: 13, margin: "0 0 12px" }}>
        Who is on each team is kept on <Link href={teamsTabHref}>Players &rarr; Cup teams</Link>.
      </p>
    )}
    <section aria-labelledby="lineups" style={{ marginTop: 8 }}>
      <h2 id="lineups" className="card-title" style={{ fontSize: 18, margin: "0 0 10px" }}>
        Lineups
      </h2>
      <CupLineup
        teams={[
          { id: board.teams[0].id, name: board.teams[0].name, players: teamPlayers(0) },
          { id: board.teams[1].id, name: board.teams[1].name, players: teamPlayers(1) },
        ]}
        pointsToWin={event?.cupPointsToWin ?? 0}
        holder={event?.cupHolderGroupId ?? ""}
        locked={settingsLocked}
        lockWhy={settingsLock}
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
    <CupOtherPoints
      teams={[
        { id: board.teams[0].id, name: board.teams[0].name },
        { id: board.teams[1].id, name: board.teams[1].name },
      ]}
      points={board.outside}
    />
    </>
  );
}
