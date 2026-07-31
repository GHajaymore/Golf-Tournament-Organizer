import { requireState } from "@/lib/page-helpers";
import { pts, diff } from "@/lib/format";

export default async function LeaderboardPage() {
  const { state } = await requireState();
  const { overall, groups, groupStandings, event } = state;
  const advancingIds = new Set(
    groupStandings.flatMap((gs) => gs.ranked.slice(0, event.qualifyPerGroup).map((r) => r.player.id)),
  );
  const groupById = new Map(groups.map((g) => [g.id, g]));

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          marginBottom: 20,
        }}
      >
        <div>
          <div className="page-kicker">Live</div>
          <h2 style={{ fontSize: 27, margin: "5px 0 0" }}>Live leaderboard</h2>
          <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
            Overall standings across all groups · points breakdown.
          </p>
        </div>
        <span className="tag tag-accent">
          <i className="ph-fill ph-circle" style={{ fontSize: 8, marginRight: 5 }} /> Updating live
        </span>
      </div>

      <div className="card elev-sm">
        <div className="table-scroll">
        <table className="table lb-table">
          <thead>
            <tr>
              <th style={{ width: 40 }}>#</th>
              <th>Player</th>
              <th>Group</th>
              <th style={{ textAlign: "center" }}>P</th>
              <th style={{ textAlign: "center" }}>W</th>
              <th style={{ textAlign: "center" }}>½</th>
              <th style={{ textAlign: "center" }}>L</th>
              <th style={{ textAlign: "right" }}>Holes ±</th>
              <th style={{ textAlign: "right" }}>Pts</th>
            </tr>
          </thead>
          <tbody>
            {overall.map((r) => {
              const advancing = advancingIds.has(r.player.id);
              return (
                <tr
                  key={r.player.id}
                  style={advancing ? { background: "var(--color-accent-900)" } : undefined}
                >
                  <td style={{ fontVariantNumeric: "tabular-nums", color: "var(--color-neutral-400)" }}>
                    {r.rank}
                  </td>
                  <td style={{ fontWeight: 500 }}>
                    {r.player.name}
                    {advancing && (
                      <span className="tag tag-accent" style={{ marginLeft: 8, fontSize: 10 }}>
                        Advancing
                      </span>
                    )}
                  </td>
                  <td className="text-muted">{groupById.get(r.player.groupId ?? "")?.name ?? "—"}</td>
                  <td style={{ textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{r.stats.played}</td>
                  <td style={{ textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{r.stats.wins}</td>
                  <td style={{ textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{r.stats.ties}</td>
                  <td style={{ textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{r.stats.losses}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{diff(r.stats)}</td>
                  <td
                    style={{
                      textAlign: "right",
                      fontWeight: 600,
                      color: "var(--color-accent-200)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {pts(r.stats.totalPoints)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
          Columns: P played, W won, ½ halved, L lost. Advancing rows reflect the current Top{" "}
          {event.qualifyPerGroup}/group cutoff and update live as scores are entered.
        </p>
      </div>
    </>
  );
}
