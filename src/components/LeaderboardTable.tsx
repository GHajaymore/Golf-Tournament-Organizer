import { toParText } from "@/lib/domain";

export interface StandingRow {
  id: string;
  rank: number;
  /**
   * Whether this row holds a position, as opposed to appearing without one.
   *
   * A card that stopped short — a match won 5&4, four holes conceded and never
   * played — is SHOWN with the holes actually played and is not ranked. Nothing
   * may invent a score for a hole nobody played (Rule 3.2b), and ranking a
   * fourteen-hole card against an eighteen-hole one presents two numbers as
   * comparable when they are not.
   *
   * `rank` is 0 wherever this is false.
   */
  ranked: boolean;
  name: string;
  flight: string;
  advancing: boolean;
  /**
   * Whether the cut line runs THROUGH this player's position.
   *
   * True for every player sharing a finishing position that has players on
   * both sides of qualification. `advancing` is still set, because a
   * tournament has to keep running — but it is a provisional pick made by the
   * sort's last fallback, which is seed, which is handicap order. The board
   * printed the two players level and then quietly advanced one of them.
   *
   * A tie for the last qualifying place is settled by a play-off or a
   * published countback, not by software. This is how a screen says so.
   */
  tiedAtCut?: boolean;
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
  /** Holes the counted cards cover, so "thru" can read "14 of 18". */
  holesOwed: number;
}

/**
 * Why a row on the sheet has no position, in the reader's words.
 *
 * Empty for a row that holds a position, and for a player who has returned
 * nothing at all — an empty row explains itself, and captioning every player
 * yet to tee off would bury the two or three this is for.
 */
function unrankedNote(r: StandingRow): string {
  if (r.ranked || r.thru <= 0) return "";
  return r.holesOwed > r.thru
    ? `Not ranked — ${r.thru} of ${r.holesOwed} holes played`
    : "Not ranked — card incomplete";
}

/**
 * The note under a player the cut line runs through.
 *
 * Same reason `unrankedNote` is on the page rather than in a tooltip: this
 * board is read on a phone, and the row it belongs to is lit as advancing
 * while the row below it is not, though the two are printed on the same
 * position. Without a word here the board simply looks wrong, and a reader
 * cannot tell whether the app broke the tie or made a mistake.
 */
function tieNote(r: StandingRow): string {
  return r.tiedAtCut ? "Tied for the last place — play-off to decide" : "";
}

/** Renders the standings for either format. `compact` = the dashboard preview. */
export function LeaderboardTable({
  isStroke,
  isStableford = false,
  rows,
  compact = false,
}: {
  isStroke: boolean;
  isStableford?: boolean;
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
              {!isStableford && <th style={{ textAlign: "right" }}>Net</th>}
              <th style={{ textAlign: "right" }}>{isStableford ? "Pts" : "To par"}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={rowStyle(r.advancing)}>
                {/* No position where none was earned — but the card beside it
                    is still shown. That is the whole of "show, do not rank". */}
                <td style={{ ...num, color: "var(--color-neutral-400)" }}>{r.ranked ? r.rank : "—"}</td>
                <td style={{ fontWeight: 500 }}>
                  {r.name}
                  {/* On the page, not in a tooltip. A reader who finds someone
                      unranked needs the reason where they are looking, and a
                      `title` is invisible on the phone this is read on. */}
                  {unrankedNote(r) && (
                    <div className="text-muted" style={{ fontWeight: 400, fontSize: "0.85em" }}>
                      {unrankedNote(r)}
                    </div>
                  )}
                  {tieNote(r) && (
                    <div className="text-muted" style={{ fontWeight: 400, fontSize: "0.85em" }}>
                      {tieNote(r)}
                    </div>
                  )}
                </td>
                <td className="text-muted">{r.flight}</td>
                {!compact && <td style={{ textAlign: "center", ...num }}>{r.thru > 0 ? r.thru : "—"}</td>}
                {!compact && <td style={{ textAlign: "right", ...num }}>{r.thru > 0 ? r.gross : "—"}</td>}
                {!isStableford && <td style={{ textAlign: "right", ...num }}>{r.thru > 0 ? r.net : "—"}</td>}
                <td style={{ textAlign: "right", fontWeight: 600, color: "var(--color-accent-200)", ...num }}>
                  {r.thru > 0 ? (isStableford ? r.points : toParText(r.toPar)) : "—"}
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
