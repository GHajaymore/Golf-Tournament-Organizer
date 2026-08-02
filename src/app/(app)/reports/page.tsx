import { requireScreen } from "@/lib/page-helpers";
import { loadEventState } from "@/lib/services/tournament";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ReportsClient, type SnapshotRow } from "@/components/ReportsClient";
import { matchProgress } from "@/lib/services/tournament";
import { pts } from "@/lib/format";
import { StatCard } from "@/components/PageHeader";

export default async function ReportsPage() {
  await requireScreen("reports");
  const session = await getSession();
  if (!session) redirect("/");
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");

  const groupById = new Map(state.groups.map((g, i) => [g.id, `Flight ${i + 1}`]));
  const advancingIds = state.advancingIds;
  const progress = matchProgress(state);

  const rows: SnapshotRow[] = state.overall.map((r) => ({
    rank: r.rank,
    name: r.player.name,
    group: groupById.get(r.player.groupId ?? "") ?? "—",
    played: r.stats.played,
    wins: r.stats.wins,
    ties: r.stats.ties,
    losses: r.stats.losses,
    diff: r.stats.holesWon - r.stats.holesLost,
    points: pts(r.stats.totalPoints),
    advancing: advancingIds.has(r.player.id),
  }));

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div className="page-kicker">Reports</div>
        <h2 style={{ fontSize: 27, margin: "5px 0 0" }}>Reports / export</h2>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          Download standings and results, or print a snapshot.
        </p>
      </div>
      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <StatCard label="Players" value={state.confirmed.length} icon="ph ph-users-three" />
        <StatCard label="Matches complete" value={`${progress.done}/${progress.total}`} icon="ph ph-check-circle" />
        <StatCard label="Flights" value={state.groups.length} icon="ph ph-squares-four" />
        <StatCard label="Advancing" value={state.advancingCount} icon="ph ph-flag-checkered" />
      </div>
      <ReportsClient rows={rows} eventName={state.event.name} />
    </>
  );
}
