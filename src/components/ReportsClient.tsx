"use client";
import { useRouter } from "next/navigation";
import { LeaderboardTable, type StandingRow } from "./LeaderboardTable";
import { toParText } from "@/lib/domain";

function download(filename: string, rows: string[][]) {
  const csv = rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ReportsClient({
  rows,
  isStroke,
  eventName,
}: {
  rows: StandingRow[];
  isStroke: boolean;
  eventName: string;
}) {
  const router = useRouter();
  const status = (r: StandingRow) => (r.advancing ? "Advancing" : "Eliminated");

  const fullStandings = () => {
    const header = isStroke
      ? ["Rank", "Player", "Flight", "Thru", "Gross", "Net", "To par", "Status"]
      : ["Rank", "Player", "Flight", "Played", "Wins", "Halved", "Losses", "Holes+/-", "Points", "Status"];
    const body = rows.map((r) =>
      isStroke
        ? [String(r.rank), r.name, r.flight, String(r.thru), String(r.gross), String(r.net), toParText(r.toPar), status(r)]
        : [String(r.rank), r.name, r.flight, String(r.played), String(r.wins), String(r.ties), String(r.losses), r.diff, r.pts, status(r)],
    );
    download(`${eventName}-standings.csv`, [header, ...body]);
  };

  const groupResults = () => {
    const scoreCol = isStroke ? "Net" : "Points";
    const scoreVal = (r: StandingRow) => (isStroke ? String(r.net) : r.pts);
    download(`${eventName}-flight-results.csv`, [
      ["Flight", "Rank", "Player", scoreCol, "Status"],
      ...[...rows]
        .sort((a, b) => a.flight.localeCompare(b.flight) || a.rank - b.rank)
        .map((r) => [r.flight, String(r.rank), r.name, scoreVal(r), status(r)]),
    ]);
  };

  const exports = [
    { label: "Full standings", desc: "Every player, ranked, with results and status.", icon: "ph ph-table", action: fullStandings, kind: "csv" },
    { label: "Flight results", desc: "Per-flight finishing order and advancing status.", icon: "ph ph-squares-four", action: groupResults, kind: "csv" },
    { label: "Bracket sheet", desc: "Open the bracket, then print to PDF.", icon: "ph ph-tree-structure", action: () => router.push("/bracket"), kind: "open" },
    { label: "Scorecards", desc: "Open printable scorecards for the field.", icon: "ph ph-cards", action: () => router.push("/scorecard"), kind: "open" },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 16, alignItems: "start" }}>
      <div className="card elev-sm" style={{ gap: 10 }}>
        <span className="card-title" style={{ fontSize: 15 }}>Exports</span>
        {exports.map((e) => (
          <div key={e.label} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: "1px solid var(--color-divider)" }}>
            <i className={e.icon} style={{ color: "var(--color-accent)", fontSize: 20, width: 22 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{e.label}</div>
              <div className="text-muted" style={{ fontSize: 12 }}>{e.desc}</div>
            </div>
            <button type="button" className={`btn ${e.kind === "csv" ? "btn-primary" : "btn-secondary"}`} onClick={e.action}>
              {e.kind === "csv" ? "Export CSV" : "Open"}
            </button>
          </div>
        ))}
        <p className="text-muted" style={{ fontSize: 12, margin: "2px 0 0" }}>
          Use your browser&rsquo;s Print → &ldquo;Save as PDF&rdquo; on any printable view (chrome is hidden in print).
        </p>
      </div>
      <div className="card elev-sm">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <span className="card-title" style={{ fontSize: 15 }}>Final standings snapshot</span>
          <button type="button" className="btn btn-secondary" onClick={() => window.print()}>
            <i className="ph ph-printer" /> Print
          </button>
        </div>
        <LeaderboardTable isStroke={isStroke} rows={rows} />
      </div>
    </div>
  );
}
