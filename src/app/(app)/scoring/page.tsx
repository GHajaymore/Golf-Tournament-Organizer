import { requireScreen } from "@/lib/page-helpers";
import { loadEventState } from "@/lib/services/tournament";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ScoringClient } from "@/components/ScoringClient";

export default async function ScoringPage() {
  await requireScreen("scoring");
  const session = await getSession();
  if (!session) redirect("/");
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div className="page-kicker">Setup</div>
        <h2 style={{ fontSize: 27, margin: "5px 0 0" }}>Scoring rules</h2>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          Points awarded in round-robin stages. Standings recalculate instantly.
        </p>
      </div>
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
