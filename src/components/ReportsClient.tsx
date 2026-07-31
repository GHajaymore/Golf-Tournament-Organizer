"use client";
import { useState } from "react";

export interface SnapshotRow {
  rank: number;
  name: string;
  group: string;
  played: number;
  wins: number;
  ties: number;
  losses: number;
  diff: number;
  points: string;
  advancing: boolean;
}

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

export function ReportsClient({ rows, eventName }: { rows: SnapshotRow[]; eventName: string }) {
  const [note, setNote] = useState("");

  const fullStandings = () => {
    download(`${eventName}-standings.csv`, [
      ["Rank", "Player", "Group", "Played", "Wins", "Halved", "Losses", "Holes+/-", "Points", "Status"],
      ...rows.map((r) => [
        String(r.rank), r.name, r.group, String(r.played), String(r.wins), String(r.ties),
        String(r.losses), String(r.diff), r.points, r.advancing ? "Advancing" : "Eliminated",
      ]),
    ]);
  };
  const groupResults = () => {
    download(`${eventName}-group-results.csv`, [
      ["Group", "Rank", "Player", "Points", "Status"],
      ...[...rows]
        .sort((a, b) => a.group.localeCompare(b.group) || a.rank - b.rank)
        .map((r) => [r.group, String(r.rank), r.name, r.points, r.advancing ? "Advancing" : "Eliminated"]),
    ]);
  };
  const pdfStub = (kind: string) => setNote(`${kind} PDF export is stubbed in this build — wire up a server-side PDF renderer to enable it.`);

  const exports = [
    { label: "Full standings", desc: "Every player, ranked, with record and points.", icon: "ph ph-table", action: fullStandings, kind: "csv" },
    { label: "Group results", desc: "Per-group finishing order and advancing status.", icon: "ph ph-squares-four", action: groupResults, kind: "csv" },
    { label: "Bracket sheet", desc: "Winners & Consolation bracket as a printable sheet.", icon: "ph ph-tree-structure", action: () => pdfStub("Bracket sheet"), kind: "pdf" },
    { label: "Scorecards", desc: "Match-play scorecards for the field.", icon: "ph ph-cards", action: () => pdfStub("Scorecards"), kind: "pdf" },
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
              {e.kind === "csv" ? "Export CSV" : "PDF"}
            </button>
          </div>
        ))}
        {note && <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>{note}</p>}
      </div>
      <div className="card elev-sm">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span className="card-title" style={{ fontSize: 15 }}>Final standings snapshot</span>
          <button type="button" className="btn btn-secondary" onClick={() => window.print()}>
            <i className="ph ph-printer" /> Print
          </button>
        </div>
        <table className="table" style={{ fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ width: 36 }}>#</th>
              <th>Player</th>
              <th>Grp</th>
              <th>Status</th>
              <th style={{ textAlign: "right" }}>Pts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.rank}-${r.name}`} style={r.advancing ? { background: "var(--color-accent-900)" } : undefined}>
                <td style={{ color: "var(--color-neutral-500)" }}>{r.rank}</td>
                <td style={{ fontWeight: 500 }}>{r.name}</td>
                <td className="text-muted">{r.group}</td>
                <td><span className={`tag ${r.advancing ? "tag-accent" : "tag-neutral"}`}>{r.advancing ? "Advancing" : "Eliminated"}</span></td>
                <td style={{ textAlign: "right", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{r.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
