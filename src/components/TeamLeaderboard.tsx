import type { TeamStanding } from "@/lib/services/teams";
import { toParText } from "@/lib/domain";

/**
 * Standings for a team round.
 *
 * A server component: nothing here is interactive, and the alternative would
 * ship every side's members and scores to a client bundle for no reason.
 */
export function TeamLeaderboard({
  format,
  stableford,
  rows,
}: {
  format: string;
  stableford: boolean;
  rows: TeamStanding[];
}) {
  const started = rows.filter((r) => r.played > 0);

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div className="page-kicker">Overview</div>
        <h2 style={{ fontSize: 27, margin: "5px 0 0" }}>Live leaderboard</h2>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          {format} · {rows.length} {rows.length === 1 ? "side" : "sides"}
          {stableford ? " · Stableford points (higher is better)." : " · lowest net wins."}
        </p>
      </div>

      <div className="card elev-sm">
        {rows.length === 0 ? (
          <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
            No sides drawn for this round yet.
          </p>
        ) : (
          <div className="table-scroll">
            <table className="table" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ width: 40 }}>#</th>
                  <th>Side</th>
                  <th style={{ textAlign: "right" }}>H/cap</th>
                  <th style={{ textAlign: "right" }}>Holes</th>
                  <th style={{ textAlign: "right" }}>Gross</th>
                  {stableford ? (
                    <th style={{ textAlign: "right" }}>Points</th>
                  ) : (
                    <>
                      <th style={{ textAlign: "right" }}>Net</th>
                      <th style={{ textAlign: "right" }}>To par</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.teamId}>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>
                      {r.played > 0 ? i + 1 : "—"}
                    </td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{r.name}</div>
                      <div className="text-muted" style={{ fontSize: 11 }}>
                        {r.members.join(" · ") || "No players"}
                      </div>
                    </td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {r.playingHandicap}
                    </td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {r.played}
                    </td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {r.played > 0 ? r.gross : "—"}
                    </td>
                    {stableford ? (
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                        {r.played > 0 ? r.points : "—"}
                      </td>
                    ) : (
                      <>
                        <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                          {r.played > 0 ? r.net : "—"}
                        </td>
                        <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                          {r.played > 0 ? toParText(r.toPar) : "—"}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
          {stableford
            ? "Points are Stableford against the side's playing handicap."
            : "Net is the side's gross minus the handicap strokes it receives. "}
          Sides that haven&apos;t returned a card yet are unranked rather than shown level with the
          field.
          {started.length > 0 && started.length < rows.length
            ? ` ${started.length} of ${rows.length} sides have started.`
            : ""}
        </p>
      </div>
    </>
  );
}
