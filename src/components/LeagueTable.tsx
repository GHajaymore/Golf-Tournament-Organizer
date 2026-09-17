import { placesByValue } from "@/lib/domain/flight-places";
import type { LeagueTableRow } from "@/lib/services/league";

/**
 * WHERE THE CLUBS STAND AFTER N WEEKS.
 *
 * The table an interclub league actually cares about, and the one a member
 * opens on a Friday morning: twelve clubs, one line each, most points first.
 *
 * PLACES COME FROM `placesByValue`, which is what puts a genuine tie on a
 * shared place and skips the one after it — T12, T12, 14. A league table full
 * of halves produces real ties constantly, and numbering them 12 and 13 would
 * separate two clubs that are level on the strength of nothing.
 *
 * A club with no meetings yet is still listed, on nothing. A league table with
 * a missing team reads as a bug on a clubhouse screen.
 */
export function LeagueTable({
  rows,
  pointsLabel,
}: {
  rows: LeagueTableRow[];
  /** What the column is counting, in the words the league chose. */
  pointsLabel: string;
}) {
  const places = placesByValue(
    rows,
    (r) => r.points,
    // Everybody is placed, including a club yet to play. A league table is the
    // whole league or it is not a league table.
    () => true,
  );

  if (rows.length === 0) {
    return (
      <div className="card elev-sm">
        <span className="card-title">No clubs yet</span>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          A league needs its clubs before it can have a table. Add them on the
          Teams screen — a club has no round of its own, it holds the roster
          that the weekly pairs are nominated from.
        </p>
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 340 }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", width: 54 }}>Pos.</th>
            <th style={{ textAlign: "left" }}>Team</th>
            <th style={{ textAlign: "right", width: 64 }}>Played</th>
            <th style={{ textAlign: "right", width: 92 }}>{pointsLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.clubId}>
              <td style={{ fontVariantNumeric: "tabular-nums" }}>{places[i] ?? "—"}</td>
              <td style={{ fontWeight: 500 }}>{r.name}</td>
              <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {r.played}
              </td>
              {/* Two decimals, because halves are the normal case: a halved
                  four-ball is worth half a point to each side, and a league
                  table reads 187.50 rather than 187 for that reason. */}
              <td
                style={{
                  textAlign: "right",
                  fontVariantNumeric: "tabular-nums",
                  fontWeight: 600,
                }}
              >
                {r.points.toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
