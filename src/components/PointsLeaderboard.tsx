import { indexLabel } from "@/lib/domain/handicap-label";
import type { SkinsBoard, NassauMatchRow, ModStablefordRow } from "@/lib/services/points-standings";
import { placesByValue, placeTexts } from "@/lib/domain/flight-places";

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
  "Nassau · three bets on one card: front nine, back nine, and the full eighteen.";

export function SkinsLeaderboard({ board, net }: { board: SkinsBoard; net: boolean }) {
  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div className="page-kicker">Overview</div>
        <h1 className="page-title">Live leaderboard</h1>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          {SKINS_NOTE(net)}
        </p>
      </div>
      <SkinsStandingsTable board={board} />
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
export function SkinsStandingsTable({ board }: { board: SkinsBoard }) {
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
          <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
            No holes decided yet. A hole needs at least two returned scores to be a contest.
          </p>
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
        <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
          {outcome.unclaimed > 0
            ? `${outcome.unclaimed} ${outcome.unclaimed === 1 ? "skin is" : "skins are"} still carrying — the last decided hole was tied.`
            : "Nothing carrying."}{" "}
          {played} {played === 1 ? "hole" : "holes"} decided so far.
        </p>
      </div>

      {outcome.holes.length > 0 && (
        <div className="card elev-sm">
          <span className="card-title" style={{ fontSize: 14, marginBottom: 6 }}>Hole by hole</span>
          <p className="text-muted" style={{ fontSize: 12, margin: "0 0 8px" }}>
            The carry is the whole game — a player who has won nothing all day can take the lot on the
            last.
          </p>
          <div className="table-scroll">
            <table className="table" style={{ fontSize: 12 }}>
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

export function NassauLeaderboard({ rows }: { rows: NassauMatchRow[] }) {
  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div className="page-kicker">Overview</div>
        <h1 className="page-title">Live leaderboard</h1>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          {NASSAU_NOTE}
        </p>
      </div>
      <NassauMatches rows={rows} />
    </>
  );
}

/** The Nassau matches WITHOUT a page heading — see `SkinsStandingsTable`. */
export function NassauMatches({ rows }: { rows: NassauMatchRow[] }) {
  return (
    <>
      {rows.length === 0 ? (
        <div className="card elev-sm">
          <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>No matches in this round yet.</p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {rows.map((r) => (
            <div key={r.matchId} className="card elev-sm" style={{ gap: 8 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <span className="card-title" style={{ fontSize: 14 }}>
                  {r.aName} v {r.bName}
                </span>
                <span className="text-muted" style={{ fontSize: 12, marginLeft: "auto" }}>
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
                      <div className="card-kicker" style={{ fontSize: 11 }}>{s.label}</div>
                      <div style={{ fontSize: 13, fontWeight: 500, marginTop: 2 }}>{label}</div>
                      {res && !res.complete && s.played > 0 && (
                        <div className="text-muted" style={{ fontSize: 11 }}>{s.played} played</div>
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

/** The points table WITHOUT a page heading — see `SkinsStandingsTable`. */
export function ModifiedStablefordTable({ rows }: { rows: ModStablefordRow[] }) {
  // Level on points is level. The sort falls back to gross and then to
  // `name.localeCompare`, so `i + 1` printed two players on 38 points as 1st
  // and 2nd alphabetically.
  const places = placeTexts(placesByValue(rows, (r) => r.points, (r) => r.played > 0));
  return (
    <>
      <div className="card elev-sm">
        {rows.length === 0 ? (
          <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>No cards returned yet.</p>
        ) : (
          <div className="table-scroll">
            <table className="table" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ width: 40 }}>#</th>
                  <th>Player</th>
                  <th style={{ textAlign: "right" }}>H/cap</th>
                  <th style={{ textAlign: "right" }}>Holes</th>
                  <th style={{ textAlign: "right" }}>Gross</th>
                  <th style={{ textAlign: "right" }}>Points</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.playerId}>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>{places[i] ?? "—"}</td>
                    <td style={{ fontWeight: 500 }}>{r.name}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{indexLabel(r)}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.played}</td>
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
        <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
          Points can go negative — the format is meant to punish a blow-up hole, not floor it at zero
          the way standard Stableford does. Players who haven&apos;t returned a card are unranked
          rather than shown level on nothing.
        </p>
      </div>
    </>
  );
}
