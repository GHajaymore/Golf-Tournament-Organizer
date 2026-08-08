import { requireScreen, isSetupLocked } from "@/lib/page-helpers";
import { settingsOf } from "@/lib/services/tournament";
import { loadEventState } from "@/lib/services/tournament";
import { redirect } from "next/navigation";
import { GroupingControls } from "@/components/GroupingControls";
import { SetupLockBanner } from "@/components/SetupLockBanner";
import { FlightBoard } from "@/components/FlightBoard";
import { unratedFlightWarning } from "@/lib/services/handicaps";
import type { FormationRule } from "@/lib/domain";

export default async function GroupingPage() {
  const session = await requireScreen("grouping");
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");
  const locked = isSetupLocked(state.event);
  const manual = state.event.formationRule === "manual";
  // A handicap-balanced draw is balanced on Course Handicaps, so unrated tees
  // make it quietly uneven. The scoring warning on Rounds & format is about a
  // different consequence of the same gap and fires on a different trigger.
  const drawWarning = await unratedFlightWarning(session.eventId, state.event.formationRule);

  const cards = state.groups.map((g, i) => {
    const players = state.confirmed.filter((p) => p.groupId === g.id).sort((a, b) => a.handicap - b.handicap);
    const avg =
      players.length === 0
        ? 0
        : Math.round((players.reduce((s, p) => s + p.handicap, 0) / players.length) * 10) / 10;
        // The club's own name when it has set one; the positional label only as
    // a fallback for flights nobody has renamed.
    const label = g.name?.trim() || `Flight ${i + 1}`;
    return { id: g.id, label, avg, players, captainId: g.captainId, viceCaptainId: g.viceCaptainId };
  });

  const mode = (["auto", "count", "perFlight"].includes(state.event.flightMode)
    ? state.event.flightMode
    : "auto") as "auto" | "count" | "perFlight";

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div className="page-kicker">Set up</div>
        <h2 style={{ fontSize: 27, margin: "5px 0 0" }}>Flights</h2>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          Divide the field into flights. Pick a formation rule, preview the result, then generate.
        </p>
      </div>

      <SetupLockBanner locked={locked} isAdmin={session.viewRole === "admin"} />

      {drawWarning && (
        <p
          style={{
            display: "flex", gap: 8, alignItems: "flex-start", margin: "0 0 14px",
            padding: "10px 12px", borderRadius: "var(--radius-md)", fontSize: 12.5, lineHeight: 1.5,
            background: "color-mix(in srgb, var(--color-accent) 10%, transparent)",
            boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--color-accent) 32%, transparent)",
          }}
        >
          <i className="ph ph-warning" style={{ fontSize: 15, marginTop: 1, flex: "none" }} />
          {drawWarning}
        </p>
      )}

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
      {cards.length === 0 ? (
        <div className="text-muted" style={{ fontSize: 13 }}>No flights yet — choose a rule and generate.</div>
      ) : manual ? (
        /* Manual is the one rule where the organizer's hand IS the policy, so
           it is the one place a player may be dragged between flights. Doing it
           under a seeded or handicap rule would leave a grouping that no longer
           matches the rule naming it, and the next regenerate would undo it. */
        <FlightBoard
          cards={cards}
          locked={locked}
          canEdit={session.viewRole !== "player"}
          confirmed={state.event.flightsConfirmed}
          leadership={settingsOf(state.event).attendanceMode !== "everyone"}
        />
      ) : (
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
        </div>
      )}
    </>
  );
}
