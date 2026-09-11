"use client";
import { useState } from "react";
import Link from "next/link";
import { LeaderboardTable, type StandingRow } from "./LeaderboardTable";
import { placesWithin } from "@/lib/domain/flight-places";

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
}: {
  isStroke: boolean;
  isStableford?: boolean;
  rows: StandingRow[];
  isStaff?: boolean;
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
  // Renumbered from one, ties intact — see `placesWithin`. This list is the
  // players with no flight yet, and they are as entitled to a dead heat as
  // anybody in one.
  const ungrouped = placesWithin(rows.filter((r) => r.flight === "—"));

  return (
    <>
      {/**
       * ONLY WHERE THERE IS MORE THAN ONE FLIGHT.
       *
       * The toggle rendered always, and "By flight" then had nothing to offer
       * in the two cases that matter. With NO flights — nobody assigned one —
       * it switched to a view containing nothing at all. With ONE it reprinted
       * the overall table under a heading, which is the same table and a word.
       *
       * Both were read off a two-player round on 2026-09-11: `createMatch`
       * creates a single group called "A" and puts everyone in it, because a
       * player row needs a group, so a quick round is the one-flight case
       * rather than the none case and the obvious `> 0` would have missed it.
       *
       * Keyed on the DATA rather than the round's shape. A tournament before
       * its draw is the none case and a small society is the one case, and a
       * shape check would have left both exactly as they were.
       */}
      {flights.length > 1 && (
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
      )}

      {view === "overall" || flights.length < 2 ? (
        <LeaderboardTable isStroke={isStroke} isStableford={isStableford} rows={rows} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {flights.map((f) => {
            // 1..n within the flight, sharing a place wherever the overall
            // ranking shared one. `i + 1` printed two players nothing could
            // separate as 1 and 2, on the table a club pays a flight prize from.
            const fr = placesWithin(rows.filter((r) => r.flight === f));
            return (
              <div key={f}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>{f}</div>
                <LeaderboardTable isStroke={isStroke} isStableford={isStableford} rows={fr} />
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
                <LeaderboardTable isStroke={isStroke} isStableford={isStableford} rows={ungrouped} />
              </div>
            )
          )}
        </div>
      )}
    </>
  );
}
