import Link from "next/link";
import { requireState } from "@/lib/page-helpers";
import { prisma } from "@/lib/db";
import { StatCard } from "@/components/PageHeader";
import { LifecycleBar } from "@/components/LifecycleBar";
import { LeaderboardTable } from "@/components/LeaderboardTable";
import { settingsOf } from "@/lib/services/tournament";
import { canSeeLeaderboard, canEnterScores } from "@/lib/tournament-settings";
import { showBracket, bracketBadge, feederFraction } from "@/lib/bracket-visibility";
import { matchProgress, standingRows } from "@/lib/services/tournament";
import { pts, shortName } from "@/lib/format";
import { playingStages } from "@/lib/services/tournament";
import { resolveAttendance, effectiveStatus, playerMayChange, type AttendanceMode } from "@/lib/domain/attendance";
import { RoundAvailability, type AvailabilityRound, type CaptainFlight } from "@/components/RoundAvailability";

const QUICK_ACTIONS = [
  { label: "Players", href: "/registration", icon: "ph ph-user-plus", staff: true },
  { label: "Flights", href: "/grouping", icon: "ph ph-squares-four", staff: true },
  { label: "Rounds", href: "/stages", icon: "ph ph-stack", staff: true },
  { label: "Qualification", href: "/qualification", icon: "ph ph-flag-checkered", staff: true },
  { label: "Tee sheet", href: "/foursomes", icon: "ph ph-users-four", staff: true },
  { label: "Scorecards", href: "/scorecard", icon: "ph ph-cards", staff: true },
  { label: "Bracket", href: "/bracket", icon: "ph ph-tree-structure", staff: true },
  { label: "Announcements", href: "/announcements", icon: "ph ph-megaphone", staff: true },
  { label: "Prizes", href: "/prizes", icon: "ph ph-trophy", staff: true },
  { label: "Reports", href: "/reports", icon: "ph ph-export", staff: true },
];

export default async function DashboardPage() {
  const { session, state } = await requireState();
  const { event, groupStandings, advancingCount, overallCutoff, brackets } = state;
  const progress = matchProgress(state);
  const currentStage = state.activeStage ?? state.stages[0];
  const currentRoundLabel =
    state.rrStages.length > 1 && currentStage
      ? `Round ${state.rrStages.findIndex((s) => s.id === currentStage.id) + 1} · ${currentStage.type}`
      : currentStage?.type ?? "—";
  const currentRoundDesc =
    currentStage?.type === "Round Robin"
      ? "Every player meets everyone in their flight."
      : currentStage?.description ?? "";
  const isStaff = session.viewRole === "admin" || session.viewRole === "assistant";
  const isAdmin = session.viewRole === "admin";

  // The dashboard mirrors the leaderboard and links into score entry, so it
  // has to respect the same settings the dedicated screens do — otherwise a
  // blind event leaks its standings on the page every player lands on first.
  const settings = settingsOf(event);
  const showStandings = canSeeLeaderboard(settings, session.viewRole);
  const showEntry = canEnterScores(settings, session.viewRole);

  const isStroke = state.isStroke;
  const cardsIn = state.strokeStandings.filter((s) => s.thru > 0).length;

  // What decides the bracket differs by tournament: a round robin decides it
  // by matches, a stroke qualifier by cards returned, a straight knockout by
  // nothing at all. Measure whichever this tournament actually uses rather
  // than assuming one shape.
  const bracketIndex = state.stages.findIndex((s) => s.type === "Bracket Stage");
  const feeders = bracketIndex >= 0 ? state.stages.slice(0, bracketIndex) : [];
  const feederProgress =
    feeders.length === 0
      ? null // straight knockout — the draw is the tournament, known from entry
      : isStroke
        ? feederFraction(cardsIn, state.confirmed.length)
        : feederFraction(progress.done, progress.total);

  const bracketProgress = {
    hasBracketStage: bracketIndex >= 0,
    feederProgress,
    bracketStarted:
      !!brackets.winners.champion ||
      brackets.winners.rounds.some((r) => r.matches.some((m) => !!m.winnerId)),
    // A qualification stage resolves the field outright — that is its job.
    qualificationDecided:
      feeders.some((s) => s.type === "Qualification Stage") && advancingCount > 0,
  };
  const showBracketTile = showStandings && showBracket(bracketProgress);
  const bracketTileBadge = bracketBadge(bracketProgress);

  const quickActions = QUICK_ACTIONS.filter((a) => {
    if (a.staff && !isStaff) return false;
    if (a.href === "/leaderboard" && !showStandings) return false;
    if (a.href === "/entry" && !showEntry) return false;
    return true;
  });

  const rows = standingRows(state).slice(0, 8);
  const advancingIds = state.advancingIds;

  // ── Weekly sign-up ──────────────────────────────────────────────────────
  // Only when the league asks the question, and only for a session that maps
  // to a player. Captains additionally see their own flight's list — theirs,
  // and nobody else's; staff see everything on the Flights and Tee sheet
  // screens instead of here.
  const attendanceMode = settingsOf(state.event).attendanceMode as AttendanceMode;
  let availabilityRounds: AvailabilityRound[] = [];
  let captainFlights: CaptainFlight[] = [];
  let ownPlayerId = "";
  if (attendanceMode !== "everyone") {
    const own = await prisma.player.findMany({
      where: { eventId: session.eventId, email: { equals: session.email, mode: "insensitive" }, status: "confirmed" },
      select: { id: true, groupId: true },
    });
    ownPlayerId = own[0]?.id ?? "";
    if (ownPlayerId) {
      const leagueRounds = playingStages(state.stages);
      const explicit = await prisma.roundAttendance.findMany({
        where: { eventId: session.eventId, stageId: { in: leagueRounds.map((r) => r.id) } },
      });
      availabilityRounds = leagueRounds.map((r, i) => {
        const mine = explicit.find((e) => e.stageId === r.id && e.playerId === ownPlayerId);
        const chosen = mine && (mine.status === "in" || mine.status === "out") ? (mine.status as "in" | "out") : null;
        return {
          stageId: r.id,
          label: `Round ${i + 1}`,
          optDeadline: r.optDeadline,
          status: effectiveStatus(attendanceMode, chosen),
          explicit: chosen !== null,
          locked: !playerMayChange(r.optDeadline),
        };
      });

      // The flights this player captains, resolved for the current round.
      const captained = await prisma.group.findMany({
        where: { eventId: session.eventId, captainId: { in: own.map((o) => o.id) } },
        select: { id: true, name: true },
      });
      if (captained.length && state.activeStage) {
        const stageExplicit = explicit.filter((e) => e.stageId === state.activeStage!.id);
        const roundLabel = `Round ${Math.max(1, leagueRounds.findIndex((r) => r.id === state.activeStage!.id) + 1)}`;
        captainFlights = captained.map((g) => {
          const members = state.confirmed.filter((pl) => pl.groupId === g.id);
          const resolved = resolveAttendance(
            attendanceMode,
            members.map((m) => m.id),
            stageExplicit.map((e) => ({ playerId: e.playerId, status: e.status, decidedBy: e.decidedBy })),
          );
          return {
            flightName: g.name,
            roundLabel,
            rows: resolved.rows.map((row) => ({
              playerId: row.playerId,
              name: members.find((m) => m.id === row.playerId)?.name ?? "",
              status: row.status,
              explicit: row.explicit,
            })),
          };
        });
      }
    }
  }

  const announcements = await prisma.announcement.findMany({
    where: { eventId: session.eventId },
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
    take: 3,
  });

  return (
    <>
      {ownPlayerId && (availabilityRounds.length > 0 || captainFlights.length > 0) && (
        <div style={{ marginBottom: 16 }}>
          <RoundAvailability playerId={ownPlayerId} rounds={availabilityRounds} captainOf={captainFlights} />
        </div>
      )}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 20,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div className="page-kicker">{event.name}</div>
          <h2 style={{ fontSize: 27, margin: "5px 0 0" }}>Tournament dashboard</h2>
          <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
            {[event.dates, [event.course, event.city].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || "No dates or venue set yet"}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {showEntry && (
            <Link className="btn btn-secondary" href="/entry">
              <i className="ph ph-pencil-simple" /> Enter scores
            </Link>
          )}
          {showStandings && (
            <Link className="btn btn-primary" href="/leaderboard">
              <i className="ph ph-ranking" /> Leaderboard
            </Link>
          )}
        </div>
      </div>

      <LifecycleBar
        status={event.status}
        isAdmin={isAdmin}
        configUnlocked={event.configUnlocked}
        summary={{
          name: event.name,
          dates: event.dates,
          course: event.course,
          format: event.format,
          players: state.confirmed.length,
          flights: state.groups.length,
          rounds: state.stages.length,
        }}
      />

      {announcements.length > 0 && (
        <div style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          {announcements.map((a) => (
            <div
              key={a.id}
              className="card elev-sm"
              style={{ gap: 4, borderColor: a.pinned ? "var(--color-accent-700)" : undefined }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <i className="ph ph-megaphone" style={{ color: "var(--color-accent-300)" }} />
                {a.pinned && (
                  <span className="tag tag-accent"><i className="ph ph-push-pin" /> Pinned</span>
                )}
                <span style={{ fontWeight: 600, fontSize: 14 }}>{a.title}</span>
              </div>
              {a.body && (
                <p className="text-muted" style={{ fontSize: 13, margin: 0, whiteSpace: "pre-wrap" }}>{a.body}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {isStaff && (
        <div className="card elev-sm" style={{ marginBottom: 16 }}>
          <span className="card-kicker">Quick actions</span>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, marginTop: 6 }}>
            {quickActions.map((a) => (
              <Link
                key={a.href}
                href={a.href}
                className="link-reset"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 6,
                  padding: "12px 6px",
                  border: "1px solid var(--color-divider)",
                  borderRadius: "var(--radius-md)",
                  fontSize: 12,
                  textAlign: "center",
                }}
              >
                <i className={a.icon} style={{ fontSize: 20, color: "var(--color-accent)" }} />
                {a.label}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <StatCard label="Players" value={state.confirmed.length} sub={`${state.groups.length} flights`} icon="ph ph-users-three" />
        {isStroke ? (
          <StatCard label="Cards in" value={`${cardsIn}/${state.confirmed.length}`} sub={`${state.confirmed.length ? Math.round((cardsIn / state.confirmed.length) * 100) : 0}% submitted`} icon="ph ph-cards" />
        ) : (
          <StatCard label="Matches complete" value={`${progress.done}/${progress.total}`} sub={`${progress.pct}% of round robin`} icon="ph ph-check-circle" />
        )}
        {/* An organizer's review queue, not a player-facing number. */}
        {isStaff && (
          <StatCard label="Awaiting review" value={state.pendingConfirmations} sub={state.pendingConfirmations === 1 ? "score to confirm" : "scores to confirm"} icon="ph ph-seal-check" />
        )}
        {/* Who's advancing is derived from the standings, so it follows them. */}
        {showStandings && (
          <StatCard label="Advancing" value={advancingCount} sub={`of ${state.confirmed.length} players`} icon="ph ph-flag-checkered" />
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 16, alignItems: "start" }}>
        <div className="card elev-sm">
          {showStandings ? (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
                <span className="card-title">Live leaderboard</span>
                <span className="text-muted" style={{ fontSize: 12 }}>Overall · all flights</span>
              </div>
              <LeaderboardTable isStroke={isStroke} isStableford={state.activeStage?.scoringBasis === "stableford"} rows={rows} compact />
            </>
          ) : (
            <>
              <span className="card-title">Standings</span>
              <p className="text-muted" style={{ fontSize: 13, margin: "8px 0 0" }}>
                <i className="ph ph-eye-slash" /> The organizer is running this as a blind event — standings are
                published when the tournament finishes.
              </p>
            </>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card elev-sm">
            <span className="card-title">Current round</span>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 2 }}>
              <div
                style={{
                  width: 40, height: 40, borderRadius: 8,
                  background: "var(--color-accent-900)", display: "grid", placeItems: "center",
                  color: "var(--color-accent-200)",
                }}
              >
                <i className="ph ph-arrows-clockwise" style={{ fontSize: 20 }} />
              </div>
              <div>
                <div style={{ fontWeight: 500 }}>{currentRoundLabel}</div>
                <div className="text-muted" style={{ fontSize: 12 }}>{currentRoundDesc}</div>
              </div>
            </div>
            <div style={{ marginTop: 12, height: 8, borderRadius: 6, background: "var(--color-neutral-800)", overflow: "hidden" }}>
              <div style={{ height: "100%", background: "var(--color-accent)", width: `${isStroke ? (state.confirmed.length ? Math.round((cardsIn / state.confirmed.length) * 100) : 0) : progress.pct}%` }} />
            </div>
            <div className="text-muted" style={{ fontSize: 12, marginTop: 6 }}>
              {isStroke ? `${cardsIn}/${state.confirmed.length} scorecards in` : `${progress.done}/${progress.total} matches complete`}
            </div>
          </div>

          {showBracketTile && (
          <div className="card elev-sm">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span className="card-title">Bracket status</span>
              <span className="tag tag-neutral">{bracketTileBadge}</span>
            </div>
            <div className="text-muted" style={{ fontSize: 12, marginTop: -2 }}>Seeded from live group standings</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13 }}>
                <span><i className="ph ph-trophy" style={{ color: "var(--color-accent)", marginRight: 6 }} />Winners</span>
                <span className="text-muted">{brackets.winners.champion?.name ?? `${state.brackets.winners.rounds[0].matches.length} matches`}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13 }}>
                <span><i className="ph ph-medal" style={{ color: "var(--color-accent)", marginRight: 6 }} />Consolation</span>
                <span className="text-muted">{brackets.consolation.champion?.name ?? `${state.brackets.consolation.rounds[0].matches.length} matches`}</span>
              </div>
            </div>
            <Link className="btn btn-ghost" href="/bracket" style={{ alignSelf: "flex-start", marginTop: 6 }}>
              Open bracket manager <i className="ph ph-arrow-right" />
            </Link>
          </div>
          )}

          {/* The cutoff line is a live read on the standings — in a blind
              event it would give away exactly what the leaderboard hides. */}
          {showStandings && (
            <div className="card elev-sm">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span className="card-title">Qualification cutoff</span>
                <span className="tag tag-accent">Top {event.qualifyPerGroup}/flight</span>
              </div>
              <div style={{ fontFamily: "var(--font-heading)", fontSize: 22, marginTop: 2 }}>
                {advancingCount} <span className="text-muted" style={{ fontSize: 14 }}>of {state.confirmed.length} advancing</span>
              </div>
              <div className="text-muted" style={{ fontSize: 12 }}>
                Cutoff line ≈ {overallCutoff === null ? "—" : pts(overallCutoff)} pts · updates live with scores
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Flight standings are standings — same rule as the leaderboard card.
          Not rendered at all rather than hidden with CSS: display:none still
          ships every name and score in the HTML for anyone reading source. */}
      {showStandings && (
      <div className="card elev-sm" style={{ marginTop: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span className="card-title">Flight standings</span>
          <span className="text-muted" style={{ fontSize: 12 }}>Advancing rows highlighted</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginTop: 6 }}>
          {groupStandings.map((gs, gi) => (
            <div key={gs.group.id}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Flight {gi + 1}</div>
              {gs.ranked.map((r) => {
                const advancing = advancingIds.has(r.player.id);
                return (
                  <div
                    key={r.player.id}
                    className="mini-row"
                    style={{
                      background: advancing ? "var(--color-accent-900)" : "transparent",
                      borderRadius: 4,
                      padding: advancing ? "3px 6px" : "3px 0",
                    }}
                  >
                    <span style={{ width: 14, color: "var(--color-neutral-500)" }}>{r.rank}</span>
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {shortName(r.player.name)}
                    </span>
                    <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{pts(r.stats.totalPoints)}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      )}
    </>
  );
}
