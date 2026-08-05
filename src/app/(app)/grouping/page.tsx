import { requireScreen, isSetupLocked } from "@/lib/page-helpers";
import { loadEventState } from "@/lib/services/tournament";
import { redirect } from "next/navigation";
import { GroupingControls } from "@/components/GroupingControls";
import { SetupLockBanner } from "@/components/SetupLockBanner";
import type { FormationRule } from "@/lib/domain";

export default async function GroupingPage() {
  const session = await requireScreen("grouping");
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");
  const locked = isSetupLocked(state.event);

  const cards = state.groups.map((g, i) => {
    const players = state.confirmed.filter((p) => p.groupId === g.id).sort((a, b) => a.handicap - b.handicap);
    const avg =
      players.length === 0
        ? 0
        : Math.round((players.reduce((s, p) => s + p.handicap, 0) / players.length) * 10) / 10;
    return { id: g.id, label: `Flight ${i + 1}`, avg, players };
  });

  const mode = (["auto", "count", "perFlight"].includes(state.event.flightMode)
    ? state.event.flightMode
    : "auto") as "auto" | "count" | "perFlight";

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div className="page-kicker">Set up</div>
        <h2 style={{ fontSize: 27, margin: "5px 0 0" }}>Flights &amp; divisions</h2>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          Divide the field into flights. Pick a formation rule, preview the result, then generate.
        </p>
      </div>

      <SetupLockBanner locked={locked} isAdmin={session.viewRole === "admin"} />

      <GroupingControls
        players={state.confirmed.map((p) => ({ id: p.id, name: p.name, handicap: p.handicap, seed: p.seed }))}
        currentRule={state.event.formationRule as FormationRule}
        currentMode={mode}
        currentValue={state.event.flightValue}
        locked={locked}
      />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span className="card-title" style={{ fontSize: 15 }}>Current flights</span>
        <span className="text-muted" style={{ fontSize: 12 }}>Active in the tournament</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        {cards.map((g) => (
          <div key={g.id} className="card elev-sm" style={{ gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{g.label}</span>
              <span className="text-muted" style={{ fontSize: 11 }}>avg hcp {g.avg}</span>
            </div>
            {g.players.map((pl) => (
              <div
                key={pl.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  fontSize: 13,
                  padding: "4px 0",
                  borderBottom: "1px solid var(--color-divider)",
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pl.name}</span>
                <span className="text-muted" style={{ fontVariantNumeric: "tabular-nums" }}>{pl.handicap}</span>
              </div>
            ))}
            {g.players.length === 0 && (
              <span className="text-muted" style={{ fontSize: 12 }}>No players assigned.</span>
            )}
          </div>
        ))}
        {cards.length === 0 && (
          <div className="text-muted" style={{ fontSize: 13 }}>No flights yet — choose a rule and generate.</div>
        )}
      </div>
    </>
  );
}
