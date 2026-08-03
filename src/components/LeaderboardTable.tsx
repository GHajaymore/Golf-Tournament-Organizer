import { toParText } from "@/lib/domain";

export interface StandingRow {
  id: string;
  rank: number;
  name: string;
  flight: string;
  advancing: boolean;
  // match-play
  record: string;
  diff: string;
  pts: string;
  played: number;
  wins: number;
  ties: number;
  losses: number;
  // stroke-play
  gross: number;
  net: number;
  toPar: number;
  thru: number;
}

/** Renders the standings for either format. `compact` = the dashboard preview. */
export function LeaderboardTable({
  isStroke,
  rows,
  compact = false,
}: {
  isStroke: boolean;
  rows: StandingRow[];
  compact?: boolean;
}) {
  const num = { fontVariantNumeric: "tabular-nums" as const };
  const rowStyle = (advancing: boolean) =>
    advancing && !compact ? { background: "var(--color-accent-900)" } : undefined;

  if (isStroke) {
    return (
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 40 }}>#</th>
              <th>Player</th>
              <th>Flight</th>
              {!compact && <th style={{ textAlign: "center" }}>Thru</th>}
              {!compact && <th style={{ textAlign: "right" }}>Gross</th>}
              <th style={{ textAlign: "right" }}>Net</th>
              <th style={{ textAlign: "right" }}>To&nbsp;par</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={rowStyle(r.advancing)}>
                <td style={{ ...num, color: "var(--color-neutral-400)" }}>{r.thru > 0 ? r.rank : "—"}</td>
                <td style={{ fontWeight: 500 }}>{r.name}</td>
                <td className="text-muted">{r.flight}</td>
                {!compact && <td style={{ textAlign: "center", ...num }}>{r.thru > 0 ? r.thru : "—"}</td>}
                {!compact && <td style={{ textAlign: "right", ...num }}>{r.thru > 0 ? r.gross : "—"}</td>}
                <td style={{ textAlign: "right", ...num }}>{r.thru > 0 ? r.net : "—"}</td>
                <td style={{ textAlign: "right", fontWeight: 600, color: "var(--color-accent-200)", ...num }}>
                  {r.thru > 0 ? toParText(r.toPar) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // Match play
  return (
    <div className="table-scroll">
      <table className="table">
        <thead>
          <tr>
            <th style={{ width: 40 }}>#</th>
            <th>Player</th>
            <th>{compact ? "Fl" : "Flight"}</th>
            {compact ? (
              <th>Rec</th>
            ) : (
              <>
                <th style={{ textAlign: "center" }}>P</th>
                <th style={{ textAlign: "center" }}>W</th>
                <th style={{ textAlign: "center" }}>½</th>
                <th style={{ textAlign: "center" }}>L</th>
              </>
            )}
            <th style={{ textAlign: "right" }}>Holes&nbsp;±</th>
            <th style={{ textAlign: "right" }}>Pts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={rowStyle(r.advancing)}>
              <td style={{ ...num, color: "var(--color-neutral-400)" }}>{r.rank}</td>
              <td style={{ fontWeight: 500 }}>{r.name}</td>
              <td className="text-muted">{r.flight}</td>
              {compact ? (
                <td className="text-muted" style={num}>{r.record}</td>
              ) : (
                <>
                  <td style={{ textAlign: "center", ...num }}>{r.played}</td>
                  <td style={{ textAlign: "center", ...num }}>{r.wins}</td>
                  <td style={{ textAlign: "center", ...num }}>{r.ties}</td>
                  <td style={{ textAlign: "center", ...num }}>{r.losses}</td>
                </>
              )}
              <td style={{ textAlign: "right", ...num }}>{r.diff}</td>
              <td style={{ textAlign: "right", fontWeight: 600, color: "var(--color-accent-200)", ...num }}>{r.pts}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
