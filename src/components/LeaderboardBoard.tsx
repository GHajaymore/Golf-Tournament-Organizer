"use client";
import { useState } from "react";
import Link from "next/link";
import { LeaderboardTable, type StandingRow } from "./LeaderboardTable";

/**
 * Leaderboard with an Overall / By-flight toggle. "By flight" splits the field
 * into per-flight boards (re-ranked within each flight) — the flight-based view
 * organizers want for stroke play, and handy for match play too.
 */
export function LeaderboardBoard({
  isStroke,
  isStableford = false,
  rows,
  isStaff = false,
  holes = 18,
}: {
  isStroke: boolean;
  isStableford?: boolean;
  rows: StandingRow[];
  isStaff?: boolean;
  /** The round length, so a finished nine-hole card reads F rather than 9. */
  holes?: number;
}) {
  const [view, setView] = useState<"overall" | "flight">("overall");

  // "—" is the standings service's placeholder for a player with no flight
  // assignment yet — not a real flight, so it shouldn't render as one (a
  // group literally titled "—" is confusing, not helpful).
  const flights = [...new Set(rows.map((r) => r.flight))]
    .filter((f) => f !== "—")
    .sort((a, b) => {
      const na = parseInt(a.replace(/\D/g, ""), 10) || 0;
      const nb = parseInt(b.replace(/\D/g, ""), 10) || 0;
      return na - nb;
    });
  const ungrouped = rows.filter((r) => r.flight === "—").map((r, i) => ({ ...r, rank: i + 1 }));

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
        <LeaderboardTable isStroke={isStroke} isStableford={isStableford} rows={rows} holes={holes} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {flights.map((f) => {
            const fr = rows.filter((r) => r.flight === f).map((r, i) => ({ ...r, rank: i + 1 }));
            return (
              <div key={f}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>{f}</div>
                <LeaderboardTable isStroke={isStroke} isStableford={isStableford} rows={fr} holes={holes} />
              </div>
            );
          })}
          {flights.length === 0 ? (
            <span className="text-muted" style={{ fontSize: 13 }}>
              {isStaff ? (
                <>No flights yet — <Link href="/grouping">generate flights</Link> to see standings by group.</>
              ) : (
                "No flights yet."
              )}
            </span>
          ) : (
            ungrouped.length > 0 && (
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>Ungrouped</div>
                <LeaderboardTable isStroke={isStroke} isStableford={isStableford} rows={ungrouped} holes={holes} />
              </div>
            )
          )}
        </div>
      )}
    </>
  );
}
