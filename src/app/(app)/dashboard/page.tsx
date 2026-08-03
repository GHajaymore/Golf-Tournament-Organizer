import Link from "next/link";
import { requireState } from "@/lib/page-helpers";
import { prisma } from "@/lib/db";
import { StatCard } from "@/components/PageHeader";
import { LifecycleBar } from "@/components/LifecycleBar";
import { LeaderboardTable } from "@/components/LeaderboardTable";
import { matchProgress, standingRows } from "@/lib/services/tournament";
import { pts, shortName } from "@/lib/format";

const QUICK_ACTIONS = [
  { label: "Players", href: "/registration", icon: "ph ph-user-plus", staff: true },
  { label: "Flights", href: "/grouping", icon: "ph ph-squares-four", staff: true },
  { label: "Rounds", href: "/stages", icon: "ph ph-stack", staff: true },
  { label: "Qualification", href: "/qualification", icon: "ph ph-flag-checkered", staff: true },
  { label: "Tee sheet", href: "/foursomes", icon: "ph ph-users-four", staff: true },
  { label: "Scorecards", href: "/scorecard", icon: "ph ph-cards", staff: true },
  { label: "Bracket", href: "/bracket", icon: "ph ph-tree-structure", staff: true },
  { label: "Reports", href: "/reports", icon: "ph ph-export", staff: true },
];

export default async function DashboardPage() {
  const { session, state } = await requireState();
  const { event, overall, groupStandings, advancingCount, overallCutoff, brackets } = state;
  const progress = matchProgress(state);
  const currentStage = state.stages[0];
  const currentRoundDesc =
    currentStage?.type === "Round Robin"
      ? "Every player meets everyone in their flight."
      : currentStage?.description ?? "";
  const isStaff = session.viewRole === "admin" || session.viewRole === "assistant";
  const isAdmin = session.viewRole === "admin";
  const quickActions = QUICK_ACTIONS.filter((a) => (isStaff ? true : !a.staff));

  const isStroke = state.isStroke;
  const rows = standingRows(state).slice(0, 8);
  const advancingIds = state.advancingIds;
  const cardsIn = state.strokeStandings.filter((s) => s.thru > 0).length;

  const announcements = await prisma.announcement.findMany({
    where: { eventId: session.eventId },
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
    take: 3,
  });

  return (
    <>
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
            {event.dates} · {event.course}, {event.city}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link className="btn btn-secondary" href="/entry">
            <i className="ph ph-pencil-simple" /> Enter scores
          </Link>
          <Link className="btn btn-primary" href="/leaderboard">
            <i className="ph ph-ranking" /> Leaderboard
          </Link>
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
        <StatCard label="Awaiting review" value={state.pendingConfirmations} sub={state.pendingConfirmations === 1 ? "score to confirm" : "scores to confirm"} icon="ph ph-seal-check" />
        <StatCard label="Advancing" value={advancingCount} sub={`of ${state.confirmed.length} players`} icon="ph ph-flag-checkered" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 16, alignItems: "start" }}>
        <div className="card elev-sm">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
            <span className="card-title">Live leaderboard</span>
            <span className="text-muted" style={{ fontSize: 12 }}>Overall · all flights</span>
          </div>
          <LeaderboardTable isStroke={isStroke} rows={rows} compact />
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
                <div style={{ fontWeight: 500 }}>{currentStage?.type ?? "—"}</div>
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

          <div className="card elev-sm">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span className="card-title">Bracket status</span>
              <span className="tag tag-neutral">Provisional</span>
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
        </div>
      </div>

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
    </>
  );
}
