import { requireScreen } from "@/lib/page-helpers";
import { loadEventState } from "@/lib/services/tournament";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { GroupingControls } from "@/components/GroupingControls";
import type { FormationRule } from "@/lib/domain";

export default async function GroupingPage() {
  await requireScreen("grouping");
  const session = await getSession();
  if (!session) redirect("/");
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");

  const playerById = new Map(state.confirmed.map((p) => [p.id, p]));
  const cards = state.groups.map((g) => {
    const players = state.confirmed.filter((p) => p.groupId === g.id).sort((a, b) => a.handicap - b.handicap);
    const avg =
      players.length === 0
        ? 0
        : Math.round((players.reduce((s, p) => s + p.handicap, 0) / players.length) * 10) / 10;
    return { id: g.id, name: g.name, avg, players };
  });

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div className="page-kicker">Setup</div>
        <h2 style={{ fontSize: 27, margin: "5px 0 0" }}>Grouping rules</h2>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          Auto-form groups by a rule, then regenerate whenever the roster changes.
        </p>
      </div>

      <GroupingControls
        currentRule={state.event.formationRule as FormationRule}
        groupCount={state.groups.length}
        playerCount={state.confirmed.length}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        {cards.map((g) => (
          <div key={g.id} className="card elev-sm" style={{ gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>Group {g.name}</span>
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
          <div className="text-muted" style={{ fontSize: 13 }}>No groups yet — choose a rule and generate.</div>
        )}
      </div>
    </>
  );
}
