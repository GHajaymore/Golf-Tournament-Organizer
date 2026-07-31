import { requireScreen } from "@/lib/page-helpers";
import { loadEventState } from "@/lib/services/tournament";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { QualControl } from "@/components/QualControl";
import { pts, shortName } from "@/lib/format";

export default async function QualificationPage() {
  await requireScreen("qualification");
  const session = await getSession();
  if (!session) redirect("/");
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");

  const { event, groupStandings, advancingCount, overallCutoff, qualifiers } = state;
  const toWinners = Math.ceil(qualifiers.length / 2);
  const toConsolation = Math.floor(qualifiers.length / 2);

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div className="page-kicker">Qualification</div>
          <h2 style={{ fontSize: 27, margin: "5px 0 0" }}>Qualification</h2>
          <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
            Set the cutoff. Advancing players feed the brackets.
          </p>
        </div>
        <QualControl value={event.qualifyPerGroup} />
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        <div className="card elev-sm" style={{ flex: 1, gap: 2 }}>
          <span className="card-kicker">Advancing</span>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 24 }}>{advancingCount} / {state.confirmed.length}</div>
        </div>
        <div className="card elev-sm" style={{ flex: 1, gap: 2 }}>
          <span className="card-kicker">To Winners bracket</span>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 24 }}>{toWinners}</div>
        </div>
        <div className="card elev-sm" style={{ flex: 1, gap: 2 }}>
          <span className="card-kicker">To Consolation</span>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 24 }}>{toConsolation}</div>
        </div>
        <div className="card elev-sm" style={{ flex: 1, gap: 2 }}>
          <span className="card-kicker">Cutoff pts</span>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 24 }}>{overallCutoff === null ? "—" : pts(overallCutoff)}</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14 }}>
        {groupStandings.map((gs) => (
          <div key={gs.group.id} className="card elev-sm">
            <span style={{ fontWeight: 600, fontSize: 14 }}>Group {gs.group.name}</span>
            <table className="table" style={{ fontSize: 13 }}>
              <tbody>
                {gs.ranked.map((r) => {
                  const advancing = r.rank <= event.qualifyPerGroup;
                  return (
                    <tr key={r.player.id} style={advancing ? { background: "var(--color-accent-900)" } : undefined}>
                      <td style={{ width: 26, color: "var(--color-neutral-500)" }}>{r.rank}</td>
                      <td style={{ fontWeight: 500 }}>{shortName(r.player.name)}</td>
                      <td>
                        <span className={`tag ${advancing ? "tag-accent" : "tag-neutral"}`}>
                          {advancing ? "Advancing" : "Eliminated"}
                        </span>
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                        {pts(r.stats.totalPoints)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </>
  );
}
