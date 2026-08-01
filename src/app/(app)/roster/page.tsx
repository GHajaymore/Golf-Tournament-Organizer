import Link from "next/link";
import { requireScreen } from "@/lib/page-helpers";
import { loadEventState } from "@/lib/services/tournament";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { record } from "@/lib/format";

export default async function RosterPage() {
  await requireScreen("roster");
  const session = await getSession();
  if (!session) redirect("/");
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");

  const statsById = new Map(state.overall.map((r) => [r.player.id, r.stats]));
  const groupById = new Map(state.groups.map((g) => [g.id, g]));
  const rows = [...state.players].sort((a, b) => a.seed - b.seed);

  const statusTag = (status: string) =>
    status === "confirmed" ? "tag-accent" : "tag-neutral";

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="page-kicker">Setup</div>
          <h2 style={{ fontSize: 27, margin: "5px 0 0" }}>Player roster</h2>
          <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
            {state.confirmed.length} confirmed · seeded by ranking. Handicaps drive flighting.
          </p>
        </div>
        <Link className="btn btn-primary" href="/registration">
          <i className="ph ph-plus" /> Add player
        </Link>
      </div>
      <div className="card elev-sm">
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 44 }}>Seed</th>
                <th>Player</th>
                <th>Contact</th>
                <th style={{ textAlign: "right" }}>Handicap</th>
                <th>Flight</th>
                <th>Status</th>
                <th>Record</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const s = statsById.get(p.id);
                const g = groupById.get(p.groupId ?? "");
                return (
                  <tr key={p.id}>
                    <td style={{ fontVariantNumeric: "tabular-nums", color: "var(--color-neutral-400)" }}>{p.seed}</td>
                    <td style={{ fontWeight: 500 }}>{p.name}</td>
                    <td className="text-muted" style={{ fontSize: 12 }}>{p.email || p.phone || "—"}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{p.handicap}</td>
                    <td className="text-muted">{g ? `Flight ${g.position + 1}` : "—"}</td>
                    <td>
                      <span className={`tag ${statusTag(p.status)}`} style={{ textTransform: "capitalize" }}>
                        {p.status}
                      </span>
                    </td>
                    <td className="text-muted" style={{ fontVariantNumeric: "tabular-nums" }}>
                      {s ? record(s) : "0-0-0"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
