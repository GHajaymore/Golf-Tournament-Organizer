import { requireScreen } from "@/lib/page-helpers";
import { loadEventState } from "@/lib/services/tournament";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { RoundRobinClient } from "@/components/RoundRobinClient";
import { resolveMatch, type HoleResult } from "@/lib/domain";

function statusOf(holesJson: string): { status: string; tagClass: string } {
  let holes: HoleResult[];
  try {
    holes = JSON.parse(holesJson) as HoleResult[];
  } catch {
    holes = [];
  }
  const r = resolveMatch(holes);
  if (r.complete) return { status: "Final", tagClass: "tag-accent-2" };
  if (holes.some((h) => h !== null)) return { status: "Live", tagClass: "tag-accent" };
  return { status: "Pending", tagClass: "tag-neutral" };
}

export default async function RoundRobinPage() {
  await requireScreen("round-robin");
  const session = await getSession();
  if (!session) redirect("/");
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");

  const nameById = new Map(state.players.map((p) => [p.id, p.name]));

  const groups = state.groups.map((g) => {
    const gMatches = state.rrMatches.filter((m) => m.groupId === g.id).sort((a, b) => a.round - b.round);
    const roundNums = [...new Set(gMatches.map((m) => m.round))].sort((a, b) => a - b);
    return {
      id: g.id,
      name: g.name,
      rounds: roundNums.map((n) => ({
        n,
        matches: gMatches
          .filter((m) => m.round === n)
          .map((m) => {
            const st = statusOf(m.holes);
            return {
              a: nameById.get(m.playerAId) ?? "—",
              b: nameById.get(m.playerBId) ?? "—",
              status: st.status,
              tagClass: st.tagClass,
            };
          }),
      })),
    };
  });

  const roundsPerGroup = groups[0]?.rounds.length ?? 0;

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div className="page-kicker">Competition · Stage 1</div>
        <h2 style={{ fontSize: 27, margin: "5px 0 0" }}>Round robin setup</h2>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          Every player meets every other in their group. Schedule auto-generated.
        </p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 16, alignItems: "start" }}>
        <div className="card elev-sm" style={{ gap: 12 }}>
          <span className="card-title" style={{ fontSize: 15 }}>Configuration</span>
          <div className="field"><label>Rounds per group</label><input className="input" value={roundsPerGroup} readOnly /></div>
          <div className="field"><label>Match length</label><input className="input" value="18 holes · match play" readOnly /></div>
          <div className="field"><label>Meetings</label><input className="input" value="Single round robin" readOnly /></div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, paddingTop: 8, borderTop: "1px solid var(--color-divider)" }}>
            <span className="text-muted">Total matches</span>
            <span style={{ fontWeight: 600 }}>{state.rrMatches.length}</span>
          </div>
        </div>
        <RoundRobinClient groups={groups} />
      </div>
    </>
  );
}
