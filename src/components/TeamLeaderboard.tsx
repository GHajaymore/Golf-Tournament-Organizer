import type { TeamStanding } from "@/lib/services/teams";
import { toParText } from "@/lib/domain";
import { placesByValue } from "@/lib/domain/flight-places";

/**
 * Standings for a team round.
 *
 * A server component: nothing here is interactive, and the alternative would
 * ship every side's members and scores to a client bundle for no reason.
 */
export function TeamLeaderboard({
  format,
  stableford,
  rows,
}: {
  format: string;
  stableford: boolean;
  rows: TeamStanding[];
}) {
  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div className="page-kicker">Overview</div>
        <h1 className="page-title">Live leaderboard</h1>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          {teamBoardNote(format, rows.length, stableford)}
        </p>
      </div>
      <TeamStandingsTable stableford={stableford} rows={rows} />
    </>
  );
}

/**
 * How a team round's board describes itself, in one place.
 *
 * The player's own board shows the same sides through `TeamStandingsTable`,
 * and two sentences written separately are two sentences that will disagree
 * about what the round is ranked on.
 */
export function teamBoardNote(format: string, sides: number, stableford: boolean): string {
  return `${format} · ${sides} ${sides === 1 ? "side" : "sides"}${
    stableford ? " · Stableford points (higher is better)." : " · lowest net wins."
  }`;
}

/**
 * The sides, ranked — WITHOUT a page heading.
 *
 * Split out on 2026-09-20 so the player's own board can show the same table.
 * It could not before: this component carried an `<h1>` and a page kicker, and
 * a screen that already has a heading would then have two — which
 * `e2e/layout.spec.ts` asserts against on every route, at every viewport.
 */
export function TeamStandingsTable({
  stableford,
  rows,
}: {
  stableford: boolean;
  rows: TeamStanding[];
}) {
  const started = rows.filter((r) => r.played > 0);
  /**
   * ON WHATEVER THIS ROUND IS RANKED BY, which the sort already knows and the
   * `#` column did not: points for a Stableford round, net strokes otherwise.
   *
   * Both branches of that sort end in `name.localeCompare`, so two sides level
   * on the score were printed 1st and 2nd in alphabetical order — on the
   * console, on Reports and on the public share link.
   */
  const places = placesByValue(
    rows,
    (r) => (stableford ? r.points : r.net),
    (r) => r.played > 0,
  );

  return (
    <>
      <div className="card elev-sm">
        {rows.length === 0 ? (
          <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
            No sides drawn for this round yet.
          </p>
        ) : (
          <div className="table-scroll">
            <table className="table" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ width: 40 }}>#</th>
                  <th>Side</th>
                  <th style={{ textAlign: "right" }}>H/cap</th>
                  <th style={{ textAlign: "right" }}>Holes</th>
                  <th style={{ textAlign: "right" }}>Gross</th>
                  {stableford ? (
                    <th style={{ textAlign: "right" }}>Points</th>
                  ) : (
                    <>
                      <th style={{ textAlign: "right" }}>Net</th>
                      <th style={{ textAlign: "right" }}>To par</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.teamId}>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>
                      {places[i] ?? "—"}
                    </td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{r.name}</div>
                      <div className="text-muted" style={{ fontSize: 11 }}>
                        {r.members.join(" · ") || "No players"}
                      </div>
                    </td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {r.playingHandicap}
                    </td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {r.played}
                    </td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {r.played > 0 ? r.gross : "—"}
                    </td>
                    {stableford ? (
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                        {r.played > 0 ? r.points : "—"}
                      </td>
                    ) : (
                      <>
                        <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                          {r.played > 0 ? r.net : "—"}
                        </td>
                        <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                          {r.played > 0 ? toParText(r.toPar) : "—"}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
          {stableford
            ? "Points are Stableford against the side's playing handicap."
            : "Net is the side's gross minus the handicap strokes it receives. "}
          Sides that haven&apos;t returned a card yet are unranked rather than shown level with the
          field.
          {started.length > 0 && started.length < rows.length
            ? ` ${started.length} of ${rows.length} sides have started.`
            : ""}
        </p>
      </div>
    </>
  );
}
