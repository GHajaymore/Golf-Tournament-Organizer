import Link from "next/link";
import { requireState } from "@/lib/page-helpers";
import { StatCard } from "@/components/PageHeader";
import { matchProgress } from "@/lib/services/tournament";
import { pts, record, diff, shortName } from "@/lib/format";

export default async function DashboardPage() {
  const { state } = await requireState();
  const { event, overall, groupStandings, advancingCount, overallCutoff, brackets } = state;
  const progress = matchProgress(state);
  const currentStage = state.stages[0];

  const top = overall.slice(0, 8);
  const advancingIds = new Set(
    groupStandings.flatMap((gs) => gs.ranked.slice(0, event.qualifyPerGroup).map((r) => r.player.id)),
  );

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

      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <StatCard label="Players" value={state.confirmed.length} sub={`${state.groups.length} flights`} icon="ph ph-users-three" />
        <StatCard label="Matches complete" value={`${progress.done}/${progress.total}`} sub={`${progress.pct}% of round robin`} icon="ph ph-check-circle" />
        <StatCard label="Current round" value={currentStage?.type ?? "—"} sub={currentStage?.deadline ?? ""} icon="ph ph-arrows-clockwise" />
        <StatCard label="Advancing" value={advancingCount} sub={`of ${state.confirmed.length} players`} icon="ph ph-flag-checkered" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 16, alignItems: "start" }}>
        <div className="card elev-sm">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
            <span className="card-title">Live leaderboard</span>
            <span className="text-muted" style={{ fontSize: 12 }}>Overall · all groups</span>
          </div>
          <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 36 }}>#</th>
                <th>Player</th>
                <th>Fl</th>
                <th>Rec</th>
                <th style={{ textAlign: "right" }}>Holes ±</th>
                <th style={{ textAlign: "right" }}>Pts</th>
              </tr>
            </thead>
            <tbody>
              {top.map((r) => {
                const g = state.groups.find((x) => x.id === r.player.groupId);
                const isTop = r.rank <= 3;
                return (
                  <tr key={r.player.id}>
                    <td>
                      <span
                        className="rank-badge"
                        style={{
                          background: isTop ? "var(--color-accent-800)" : "transparent",
                          color: isTop ? "var(--color-accent-100)" : "var(--color-neutral-400)",
                        }}
                      >
                        {r.rank}
                      </span>
                    </td>
                    <td style={{ fontWeight: 500 }}>{r.player.name}</td>
                    <td className="text-muted">{g ? g.position + 1 : "—"}</td>
                    <td className="text-muted" style={{ fontVariantNumeric: "tabular-nums" }}>{record(r.stats)}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{diff(r.stats)}</td>
                    <td style={{ textAlign: "right", fontWeight: 600, color: "var(--color-accent-200)", fontVariantNumeric: "tabular-nums" }}>
                      {pts(r.stats.totalPoints)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
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
                <div className="text-muted" style={{ fontSize: 12 }}>{currentStage?.description}</div>
              </div>
            </div>
            <div style={{ marginTop: 12, height: 8, borderRadius: 6, background: "var(--color-neutral-800)", overflow: "hidden" }}>
              <div style={{ height: "100%", background: "var(--color-accent)", width: `${progress.pct}%` }} />
            </div>
            <div className="text-muted" style={{ fontSize: 12, marginTop: 6 }}>
              {progress.done}/{progress.total} matches complete
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
