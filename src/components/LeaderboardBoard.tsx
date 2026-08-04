"use client";
import { useState } from "react";
import { LeaderboardTable, type StandingRow } from "./LeaderboardTable";

/**
 * Leaderboard with an Overall / By-flight toggle. "By flight" splits the field
 * into per-flight boards (re-ranked within each flight) — the flight-based view
 * organizers want for stroke play, and handy for match play too.
 */
export function LeaderboardBoard({ isStroke, isStableford = false, rows }: { isStroke: boolean; isStableford?: boolean; rows: StandingRow[] }) {
  const [view, setView] = useState<"overall" | "flight">("overall");

  const flights = [...new Set(rows.map((r) => r.flight))].sort((a, b) => {
    const na = parseInt(a.replace(/\D/g, ""), 10) || 0;
    const nb = parseInt(b.replace(/\D/g, ""), 10) || 0;
    return na - nb;
  });

  return (
    <>
      <div className="seg" style={{ width: "fit-content", marginBottom: 12 }}>
        <label className="seg-opt">
          <input type="radio" name="lbview" checked={view === "overall"} onChange={() => setView("overall")} />
          Overall
        </label>
        <label className="seg-opt">
          <input type="radio" name="lbview" checked={view === "flight"} onChange={() => setView("flight")} />
          By flight
        </label>
      </div>

      {view === "overall" ? (
        <LeaderboardTable isStroke={isStroke} isStableford={isStableford} rows={rows} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {flights.map((f) => {
            const fr = rows.filter((r) => r.flight === f).map((r, i) => ({ ...r, rank: i + 1 }));
            return (
              <div key={f}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>{f}</div>
                <LeaderboardTable isStroke={isStroke} isStableford={isStableford} rows={fr} />
              </div>
            );
          })}
          {flights.length === 0 && (
            <span className="text-muted" style={{ fontSize: 13 }}>No flights yet.</span>
          )}
        </div>
      )}
    </>
  );
}
