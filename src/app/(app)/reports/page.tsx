import { requireScreen } from "@/lib/page-helpers";
import { loadEventState, matchProgress, standingRows } from "@/lib/services/tournament";
import { redirect } from "next/navigation";
import { ReportsClient } from "@/components/ReportsClient";
import { StatCard } from "@/components/PageHeader";

export default async function ReportsPage() {
  const session = await requireScreen("reports");
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");

  const progress = matchProgress(state);
  const rows = standingRows(state);
  const isStroke = state.isStroke;
  const cardsIn = state.strokeStandings.filter((s) => s.thru > 0).length;

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div className="page-kicker">Results</div>
        <h2 style={{ fontSize: 27, margin: "5px 0 0" }}>Reports &amp; export</h2>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          Download standings and results, or print a snapshot.
        </p>
      </div>
      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <StatCard label="Players" value={state.confirmed.length} icon="ph ph-users-three" />
        {isStroke ? (
          <StatCard label="Cards in" value={`${cardsIn}/${state.confirmed.length}`} icon="ph ph-check-circle" />
        ) : (
          <StatCard label="Matches complete" value={`${progress.done}/${progress.total}`} icon="ph ph-check-circle" />
        )}
        <StatCard label="Flights" value={state.groups.length} icon="ph ph-squares-four" />
        <StatCard label="Advancing" value={state.advancingCount} icon="ph ph-flag-checkered" />
      </div>
      <ReportsClient rows={rows} isStroke={isStroke} isStableford={state.activeStage?.scoringBasis === "stableford"} eventName={state.event.name} />
    </>
  );
}
