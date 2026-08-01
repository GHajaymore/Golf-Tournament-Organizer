import { requireScreen } from "@/lib/page-helpers";
import { loadEventState } from "@/lib/services/tournament";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { StagesClient } from "@/components/StagesClient";

export default async function StagesPage() {
  await requireScreen("stages");
  const session = await getSession();
  if (!session) redirect("/");
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");

  const stages = state.stages.map((s) => ({
    id: s.id,
    position: s.position,
    type: s.type,
    description: s.description,
    deadline: s.deadline,
    scoringBasis: s.scoringBasis,
    carryEnabled: s.carryForwardEnabled,
    carryPct: s.carryForwardPct,
  }));

  // Matches per player in a round robin = (largest flight size − 1).
  const flightSizes = state.groups.map(
    (g) => state.confirmed.filter((p) => p.groupId === g.id).length,
  );
  const rrMatchesPerPlayer = Math.max(0, (flightSizes.length ? Math.max(...flightSizes) : 0) - 1);

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div className="page-kicker">Competition</div>
        <h2 style={{ fontSize: 27, margin: "5px 0 0" }}>Round builder</h2>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          Sequence the tournament — add as many rounds as you need, each feeding the next.
        </p>
      </div>
      <StagesClient stages={stages} rrMatchesPerPlayer={rrMatchesPerPlayer} />
    </>
  );
}
