"use client";
import { useRouter } from "next/navigation";
import { LeaderboardTable, type StandingRow } from "./LeaderboardTable";
import { toParText } from "@/lib/domain";
import { toCsv } from "@/lib/domain/csv-export";

function download(filename: string, rows: string[][]) {
  // Player names on this export can come from the public registration form, so
  // the escaping has to survive a hostile one — see csv-export.ts.
  const csv = toCsv(rows);
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
  isStableford = false,
  eventName,
  brand,
  snapshotTitle = "Final standings snapshot",
  extraCsv = [],
  board,
  scored = true,
}: {
  rows: StandingRow[];
  isStroke: boolean;
  isStableford?: boolean;
  eventName: string;
  /** Owning club's branding, shown on the printable standings. */
  brand?: { name: string; logoUrl: string } | null;
  /** What the printable panel is called — a team round is not "standings". */
  snapshotTitle?: string;
  /**
   * Exports for a round the standard board does not cover, built on the server
   * from that round's own engine. Replaces the two player-standings CSVs when
   * present, because those would be an export of the wrong reading.
   */
  extraCsv?: { label: string; desc: string; filename: string; rows: string[][] }[];
  /** The board to print, when it isn't the ordinary player standings. */
  board?: React.ReactNode;
  /**
   * False for a format the app does not score. Everything that produces a
   * result is withheld — the CSVs and the printable snapshot — while the
   * things that still make sense for such a round, the tee sheet and the
   * printable blank scorecards, stay.
   */
  scored?: boolean;
}) {
  const router = useRouter();
  const status = (r: StandingRow) => (r.advancing ? "Advancing" : "Eliminated");

  const fullStandings = () => {
    const header = isStroke
      ? isStableford
        ? ["Rank", "Player", "Flight", "Thru", "Gross", "Points", "Status"]
        : ["Rank", "Player", "Flight", "Thru", "Gross", "Net", "To par", "Status"]
      : ["Rank", "Player", "Flight", "Played", "Wins", "Halved", "Losses", "Holes+/-", "Points", "Status"];
    const body = rows.map((r) =>
      isStroke
        ? isStableford
          ? [String(r.rank), r.name, r.flight, String(r.thru), String(r.gross), String(r.points), status(r)]
          : [String(r.rank), r.name, r.flight, String(r.thru), String(r.gross), String(r.net), toParText(r.toPar), status(r)]
        : [String(r.rank), r.name, r.flight, String(r.played), String(r.wins), String(r.ties), String(r.losses), r.diff, r.pts, status(r)],
    );
    download(`${eventName}-standings.csv`, [header, ...body]);
  };

  const groupResults = () => {
    const scoreCol = isStroke ? (isStableford ? "Points" : "Net") : "Points";
    const scoreVal = (r: StandingRow) => (isStroke ? String(isStableford ? r.points : r.net) : r.pts);
    download(`${eventName}-flight-results.csv`, [
      ["Flight", "Rank", "Player", scoreCol, "Status"],
      ...[...rows]
        .sort((a, b) => a.flight.localeCompare(b.flight) || a.rank - b.rank)
        .map((r) => [r.flight, String(r.rank), r.name, scoreVal(r), status(r)]),
    ]);
  };

  // The player-standings CSVs apply only when the ordinary board does. A team
  // round exports sides; a skins round exports skins; a manual round exports
  // no result at all, because the app does not know one.
  const standingsCsv =
    scored && extraCsv.length === 0
      ? [
          { label: "Full standings", desc: "Every player, ranked, with results and status.", icon: "ph ph-table", action: fullStandings, kind: "csv" },
          { label: "Flight results", desc: "Per-flight finishing order and advancing status.", icon: "ph ph-squares-four", action: groupResults, kind: "csv" },
        ]
      : [];

  const exports = [
    ...standingsCsv,
    ...(scored
      ? extraCsv.map((e) => ({
          label: e.label,
          desc: e.desc,
          icon: "ph ph-table",
          action: () => download(e.filename, e.rows),
          kind: "csv",
        }))
      : []),
    // These stay whatever the format is: a bracket and a blank scorecard are
    // not claims about who won.
    { label: "Bracket sheet", desc: "Open the bracket, then print to PDF.", icon: "ph ph-tree-structure", action: () => router.push("/bracket"), kind: "open" },
    { label: "Scorecards", desc: "Open printable scorecards for the field.", icon: "ph ph-cards", action: () => router.push("/scorecard"), kind: "open" },
  ];

  return (
    <div className="page-split" style={{ display: "grid", gridTemplateColumns: "360px minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
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
      {/* No snapshot at all for a format the app does not score. A printed
          table is read as a result whatever the caption says, and this is the
          page whose output gets pinned to a noticeboard. */}
      {!scored ? null : (
      <div className="card elev-sm print-card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            {/* Club identity on the printed standings — these get pinned to a
                noticeboard or handed out at prizegiving. */}
            {brand?.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={brand.logoUrl}
                alt=""
                style={{ height: 30, width: "auto", maxWidth: 110, objectFit: "contain", flex: "none" }}
              />
            )}
            <div style={{ minWidth: 0 }}>
              <span className="card-title" style={{ fontSize: 15 }}>{snapshotTitle}</span>
              <div className="text-muted" style={{ fontSize: 12 }}>
                {[brand?.name, eventName].filter(Boolean).join(" · ")}
              </div>
            </div>
          </div>
          <button type="button" className="btn btn-secondary" onClick={() => window.print()}>
            <i className="ph ph-printer" /> Print
          </button>
        </div>
        {board ?? <LeaderboardTable isStroke={isStroke} isStableford={isStableford} rows={rows} />}
      </div>
      )}
    </div>
  );
}
