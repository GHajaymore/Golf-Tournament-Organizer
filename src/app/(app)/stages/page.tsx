import { requireScreen, isSetupLocked } from "@/lib/page-helpers";
import { loadEventState } from "@/lib/services/tournament";
import { redirect } from "next/navigation";
import { StagesClient } from "@/components/StagesClient";
import { SetupLockBanner } from "@/components/SetupLockBanner";

export default async function StagesPage() {
  const session = await requireScreen("stages");
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");
  const locked = isSetupLocked(state.event);

  const stages = state.stages.map((s) => ({
    id: s.id,
    position: s.position,
    type: s.type,
    description: s.description,
    format: s.format,
    holes: s.holes,
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
        <div className="page-kicker">Set up</div>
        <h2 style={{ fontSize: 27, margin: "5px 0 0" }}>Rounds &amp; format</h2>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          Sequence the tournament — add as many rounds as you need, each feeding the next.
        </p>
      </div>
      <SetupLockBanner locked={locked} isAdmin={session.viewRole === "admin"} />
      <StagesClient
        stages={stages}
        rrMatchesPerPlayer={rrMatchesPerPlayer}
        scoring={{
          winPts: state.scoring.winPts,
          tiePts: state.scoring.tiePts,
          lossPts: state.scoring.lossPts,
          holeRatioPts: state.scoring.holeRatioPts,
          bonusPts: state.scoring.bonusPts,
        }}
        tiebreakers={state.scoring.tiebreakers}
        qual={{
          mode: state.event.qualifyMode,
          perFlight: state.event.qualifyPerGroup,
          overall: state.event.qualifyOverall,
        }}
      />
    </>
  );
}
