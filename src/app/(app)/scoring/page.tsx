import { requireScreen, isSetupLocked } from "@/lib/page-helpers";
import { loadEventState } from "@/lib/services/tournament";
import { redirect } from "next/navigation";
import { ScoringClient } from "@/components/ScoringClient";
import { SetupLockBanner } from "@/components/SetupLockBanner";

export default async function ScoringPage() {
  const session = await requireScreen("scoring");
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");
  const locked = isSetupLocked(state.event);

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div className="page-kicker">Set up</div>
        <h2 style={{ fontSize: 27, margin: "5px 0 0" }}>Match Points &amp; Standings</h2>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          Points awarded in round-robin rounds, and the tiebreakers that settle level standings. Recalculates instantly.
        </p>
      </div>
      <SetupLockBanner locked={locked} isAdmin={session.viewRole === "admin"} />
      <ScoringClient
        initial={{
          winPts: state.scoring.winPts,
          tiePts: state.scoring.tiePts,
          lossPts: state.scoring.lossPts,
          holeRatioPts: state.scoring.holeRatioPts,
          bonusPts: state.scoring.bonusPts,
        }}
        tiebreakers={state.scoring.tiebreakers}
      />
    </>
  );
}
