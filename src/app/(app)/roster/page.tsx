import Link from "next/link";
import { requireScreen } from "@/lib/page-helpers";
import { loadEventState } from "@/lib/services/tournament";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { pts, record } from "@/lib/format";

export default async function RosterPage() {
  await requireScreen("roster");
  const session = await getSession();
  if (!session) redirect("/");
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");

  const statsById = new Map(state.overall.map((r) => [r.player.id, r.stats]));
  const groupById = new Map(state.groups.map((g) => [g.id, g.name]));

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div className="page-kicker">Setup</div>
          <h2 style={{ fontSize: 27, margin: "5px 0 0" }}>Player roster</h2>
          <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
            {state.confirmed.length} players · seeded by ranking. Handicaps drive grouping.
          </p>
        </div>
        <Link className="btn btn-primary" href="/registration">
          <i className="ph ph-plus" /> Add player
        </Link>
      </div>
      <div className="card elev-sm">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 44 }}>Seed</th>
              <th>Player</th>
              <th style={{ textAlign: "right" }}>Handicap</th>
              <th>Group</th>
              <th>Record</th>
              <th style={{ textAlign: "right" }}>Pts</th>
            </tr>
          </thead>
          <tbody>
            {state.confirmed.map((p) => {
              const s = statsById.get(p.id);
              return (
                <tr key={p.id}>
                  <td style={{ fontVariantNumeric: "tabular-nums", color: "var(--color-neutral-400)" }}>{p.seed}</td>
                  <td style={{ fontWeight: 500 }}>{p.name}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{p.handicap}</td>
                  <td><span className="tag tag-neutral">{groupById.get(p.groupId ?? "") ?? "—"}</span></td>
                  <td className="text-muted" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {s ? record(s) : "0-0-0"}
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 600, color: "var(--color-accent-200)", fontVariantNumeric: "tabular-nums" }}>
                    {s ? pts(s.totalPoints) : "0"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
