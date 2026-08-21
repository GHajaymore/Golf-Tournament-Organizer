import { toParText } from "@/lib/domain";
import { tourPositions, thruText, parTone, cutLineAfter } from "@/lib/domain/tour-board";

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
  points: number;
  thru: number;
}

/** Renders the standings for either format. `compact` = the dashboard preview. */
export function LeaderboardTable({
  isStroke,
  isStableford = false,
  rows,
  compact = false,
  holes = 18,
}: {
  isStroke: boolean;
  isStableford?: boolean;
  rows: StandingRow[];
  compact?: boolean;
  /**
   * The round length, so "thru" can say F.
   *
   * Defaulted rather than required: every existing caller keeps working, and
   * 18 is wrong only for a nine-hole round, where the worst case is "9"
   * instead of "F" — a thinner board, not a false one.
   */
  holes?: number;
}) {
  const num = { fontVariantNumeric: "tabular-nums" as const };
  const rowStyle = (advancing: boolean) =>
    advancing && !compact ? { background: "var(--color-accent-900)" } : undefined;

  if (isStroke) {
    // Tour conventions, computed once for the whole column: whether a position
    // is SHARED is a fact about the field and cannot be decided from one row.
    // The board printed `r.rank` per row, so a three-way tie for second printed
    // "2" three times and then jumped to 5, with nothing saying they were tied.
    const positions = tourPositions(rows.map((r) => ({ rank: r.rank, hasScore: r.thru > 0 })));
    // No cut line on the dashboard preview: it is a few rows of a longer board,
    // so a line across it would claim a boundary that is not where it looks.
    const cutAt = compact ? -1 : cutLineAfter(rows);
    return (
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 44 }}>Pos</th>
              <th>Player</th>
              <th>Flight</th>
              {!compact && <th style={{ textAlign: "center" }}>Thru</th>}
              {!compact && <th style={{ textAlign: "right" }}>Gross</th>}
              {!isStableford && <th style={{ textAlign: "right" }}>Net</th>}
              <th style={{ textAlign: "right" }}>{isStableford ? "Pts" : "To par"}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={r.id}
                style={{
                  ...rowStyle(r.advancing),
                  // The cut, drawn where the app says it is rather than
                  // re-derived here. A board that works out its own line
                  // eventually draws it somewhere the app disagrees with.
                  ...(i === cutAt ? { borderBottom: "2px solid var(--color-accent)" } : undefined),
                }}
              >
                <td style={{ ...num, color: "var(--color-neutral-400)" }}>{positions[i]}</td>
                <td style={{ fontWeight: 500 }}>{r.name}</td>
                <td className="text-muted">{r.flight}</td>
                {!compact && <td style={{ textAlign: "center", ...num }}>{thruText(r.thru, holes)}</td>}
                {!compact && <td style={{ textAlign: "right", ...num }}>{r.thru > 0 ? r.gross : "—"}</td>}
                {!isStableford && <td style={{ textAlign: "right", ...num }}>{r.thru > 0 ? r.net : "—"}</td>}
                <td
                  style={{
                    textAlign: "right",
                    fontWeight: 600,
                    ...num,
                    // Under par in the club's second colour, the same one the
                    // money screen uses for money coming to you: both mean the
                    // good direction. Level par is neither and deliberately
                    // does not borrow it. Theme tokens rather than a literal
                    // red, because this board is read in direct sun and the
                    // ramps are what clear SUNLIGHT_RATIO on both grounds.
                    color:
                      isStableford || parTone(r.toPar) === "under"
                        ? "var(--color-accent-2-300)"
                        : parTone(r.toPar) === "over"
                          ? "var(--color-text)"
                          : "var(--color-neutral-400)",
                  }}
                >
                  {r.thru > 0 ? (isStableford ? r.points : toParText(r.toPar)) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {cutAt >= 0 && (
          // Said in words as well as drawn. A coloured rule is a convention
          // somebody has to already know, and a screen reader hears nothing
          // at all from a border.
          <p className="text-muted" style={{ fontSize: 11.5, margin: "6px 0 0" }}>
            The line is the cut &mdash; {cutAt + 1}{" "}
            {cutAt === 0 ? "player advances" : "players advance"}.
          </p>
        )}
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
