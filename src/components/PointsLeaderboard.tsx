import { indexLabel } from "@/lib/domain/handicap-label";
import type { SkinsBoard, NassauMatchRow, ModStablefordRow } from "@/lib/services/points-standings";
import { placesByValue, placeTexts } from "@/lib/domain/flight-places";
import { MoreInfo } from "./MoreInfo";

/**
 * Boards for the formats that read an ordinary card a different way.
 *
 * Server components — nothing here is interactive, and shipping every player's
 * scores to a client bundle to render a static table would be pure cost.
 */

/** What a skins round is decided on, said once. */
export const SKINS_NOTE = (net: boolean) =>
  `Skins · ${net ? "net, off stroke index" : "gross"} · a hole must be won outright.`;

/** What a Nassau is, said once. */
export const NASSAU_NOTE =
  "Nassau · front nine, back nine and the full eighteen.";

export function SkinsLeaderboard({ board, net, roundClosed = false }: { board: SkinsBoard; net: boolean; roundClosed?: boolean }) {
  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div className="page-kicker">Overview</div>
        <h1 className="page-title">Live leaderboard</h1>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          {SKINS_NOTE(net)}
        </p>
      </div>
      <SkinsStandingsTable board={board} roundClosed={roundClosed} />
    </>
  );
}

/**
 * The skins table WITHOUT a page heading.
 *
 * Split out on 2026-09-20 for the same reason `TeamStandingsTable` was the day
 * before: the league week sheet has its own `<h1>` and needs to show the same
 * board. Before it did, a skins night on that sheet was ranked as an ordinary
 * net medal — "1st on 57 net" — while `positionsExist` in `formats.ts` says in
 * its own words that "a skins round pays holes, not places".
 */
export function SkinsStandingsTable({
  board,
  roundClosed = false,
}: {
  board: SkinsBoard;
  /**
   * The committee has closed the round (2026-10-08, grid cell T53). Nothing
   * carries out of a closed round — skins tied through the last hole were not
   * won — so "15 skins are still carrying … decided so far" under FINAL
   * promised them to a hole that is not coming.
   */
  roundClosed?: boolean;
}) {
  const { outcome, nameById } = board;
  const played = outcome.holes.length;
  // Two players on the same number of skins are level — the sort's fallback is
  // `playerId.localeCompare`, so `i + 1` placed them in cuid order on a table
  // that decides money. Skins has no tiebreak; the pot divides by skins won.
  const places = placeTexts(placesByValue(outcome.standings, (s) => s.skins, (s) => s.skins > 0));

  return (
    <>
      <div className="card elev-sm" style={{ marginBottom: 16 }}>
        {outcome.standings.length === 0 ? (
          <MoreInfo short="No holes decided yet.">
            A hole needs at least two returned scores to be a contest.
          </MoreInfo>
        ) : (
          <div className="table-scroll">
            <table className="table" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ width: 40 }}>#</th>
                  <th>Player</th>
                  <th style={{ textAlign: "right" }}>Skins</th>
                  <th>Holes won</th>
                </tr>
              </thead>
              <tbody>
                {outcome.standings.map((s, i) => (
                  <tr key={s.playerId}>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>{places[i] ?? "—"}</td>
                    <td style={{ fontWeight: 500 }}>{nameById[s.playerId] ?? "—"}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                      {s.skins}
                    </td>
                    <td className="text-muted">{s.holesWon.join(", ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-muted" style={{ fontSize: 13, marginTop: 8 }}>
          {roundClosed
            ? `${outcome.unclaimed > 0 ? `${outcome.unclaimed} ${outcome.unclaimed === 1 ? "skin was" : "skins were"} never won — the round ended on a tie. ` : ""}${played} ${played === 1 ? "hole" : "holes"} decided.`
            : `${outcome.unclaimed > 0 ? `${outcome.unclaimed} ${outcome.unclaimed === 1 ? "skin is" : "skins are"} still carrying — the last decided hole was tied.` : "Nothing carrying."} ${played} ${played === 1 ? "hole" : "holes"} decided so far.`}
        </p>
      </div>

      {outcome.holes.length > 0 && (
        <div className="card elev-sm">
          <span className="card-title" style={{ fontSize: 14, marginBottom: 6 }}>Hole by hole</span>
          <MoreInfo short="A tied hole carries its skin to the next." style={{ marginBottom: 8 }}>
            The carry is the whole game — a player who has won nothing all day can take the lot on the
            last.
          </MoreInfo>
          <div className="table-scroll">
            <table className="table" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th>Hole</th>
                  <th>Best</th>
                  <th>Result</th>
                  <th style={{ textAlign: "right" }}>Worth</th>
                </tr>
              </thead>
              <tbody>
                {outcome.holes.map((h) => (
                  <tr key={h.hole}>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>{h.hole}</td>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>{h.score ?? "—"}</td>
                    <td className={h.carried ? "text-muted" : undefined}>
                      {h.carried ? "Tied — carried" : (nameById[h.playerId ?? ""] ?? "—")}
                    </td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{h.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

export function NassauLeaderboard({ rows, roundClosed = false }: { rows: NassauMatchRow[]; roundClosed?: boolean }) {
  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div className="page-kicker">Overview</div>
        <h1 className="page-title">Live leaderboard</h1>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          {NASSAU_NOTE}
        </p>
      </div>
      <NassauMatches rows={rows} roundClosed={roundClosed} />
    </>
  );
}

/** The Nassau matches WITHOUT a page heading — see `SkinsStandingsTable`. */
export function NassauMatches({
  rows,
  roundClosed = false,
}: {
  rows: NassauMatchRow[];
  /** Closed by the committee: no match is still to come (grid cell T54, 2026-10-08). */
  roundClosed?: boolean;
}) {
  return (
    <>
      {rows.length === 0 ? (
        <div className="card elev-sm">
          <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
            {roundClosed ? "No matches were played in this round." : "No matches in this round yet."}
          </p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {rows.map((r) => (
            <div key={r.matchId} className="card elev-sm" style={{ gap: 8 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <span className="card-title" style={{ fontSize: 14 }}>
                  {r.aName} v {r.bName}
                </span>
                <span className="text-muted" style={{ fontSize: 13, marginLeft: "auto" }}>
                  {r.outcome.decided} of {r.outcome.segments.length} settled
                  {r.outcome.balance !== 0 &&
                    ` · ${r.outcome.balance > 0 ? r.aName : r.bName} up ${Math.abs(r.outcome.balance)}`}
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
                {r.outcome.segments.map((s) => {
                  const res = s.result;
                  const label = !res
                    ? "Not started"
                    : res.complete
                      ? res.winner === "H"
                        ? "Halved"
                        : `${res.winner === "A" ? r.aName : r.bName} ${res.resultText}`
                      : res.lead === 0
                        ? "All square"
                        : `${res.lead > 0 ? r.aName : r.bName} ${Math.abs(res.lead)} up`;
                  return (
                    <div key={s.key} style={{ padding: "8px 10px", borderRadius: 8, background: "var(--color-surface-2)" }}>
                      <div className="card-kicker" style={{ fontSize: 13 }}>{s.label}</div>
                      <div style={{ fontSize: 13, fontWeight: 500, marginTop: 2 }}>{label}</div>
                      {res && !res.complete && s.played > 0 && (
                        <div className="text-muted" style={{ fontSize: 13 }}>{s.played} played</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/** What a Modified Stableford is worth, said once. */
export const MOD_STABLEFORD_NOTE =
  "Modified Stableford · highest points wins. Eagle 5, birdie 2, par 0, bogey −1, worse −3.";

export function ModifiedStablefordLeaderboard({ rows }: { rows: ModStablefordRow[] }) {
  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div className="page-kicker">Overview</div>
        <h1 className="page-title">Live leaderboard</h1>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          {MOD_STABLEFORD_NOTE}
        </p>
      </div>
      <ModifiedStablefordTable rows={rows} />
    </>
  );
}

/**
 * The points table WITHOUT a page heading — see `SkinsStandingsTable`.
 *
 * `bare` drops the card it sits in, for a screen that already has one — the
 * casual round's screen puts it inside its own "Where the round stands".
 *
 * `compact` keeps the figure the table is RANKED on in view at 393px. On the
 * casual round's first real walk (2026-10-06) Points was the sixth column and
 * sat past the edge of the phone, behind a sideways scroll, under a table
 * ordered by it. The holes are on the card above ("thru 18") and the
 * handicaps behind the screen's More, so those two columns go.
 */
export function ModifiedStablefordTable({
  rows,
  bare = false,
  compact = false,
}: {
  rows: ModStablefordRow[];
  bare?: boolean;
  compact?: boolean;
}) {
  // Level on points is level. The sort falls back to gross and then to
  // `name.localeCompare`, so `i + 1` printed two players on 38 points as 1st
  // and 2nd alphabetically.
  const places = placeTexts(placesByValue(rows, (r) => r.points, (r) => r.played > 0));
  return (
    <>
      <div className={bare ? undefined : "card elev-sm"}>
        {rows.length === 0 ? (
          <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>No cards returned yet.</p>
        ) : (
          <div className="table-scroll">
            <table className="table" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ width: 40 }}>#</th>
                  <th>Player</th>
                  {!compact && <th style={{ textAlign: "right" }}>H/cap</th>}
                  {!compact && <th style={{ textAlign: "right" }}>Holes</th>}
                  <th style={{ textAlign: "right" }}>Gross</th>
                  <th style={{ textAlign: "right" }}>Points</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.playerId}>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>{places[i] ?? "—"}</td>
                    <td style={{ fontWeight: 500 }}>{r.name}</td>
                    {!compact && <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{indexLabel(r)}</td>}
                    {!compact && <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.played}</td>}
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {r.played > 0 ? r.gross : "—"}
                    </td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                      {r.played > 0 ? r.points : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <MoreInfo short="Points can go negative." style={{ marginTop: 8 }}>
          Points can go negative — the format is meant to punish a blow-up hole, not floor it at zero
          the way standard Stableford does. Players who haven&apos;t returned a card are unranked
          rather than shown level on nothing.
        </MoreInfo>
      </div>
    </>
  );
}
