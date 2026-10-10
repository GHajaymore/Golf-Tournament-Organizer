import type { TeamStanding } from "@/lib/services/teams";
import { teamPlaceValue, valueOnBasis, type WeekBasis } from "@/lib/domain/week-basis";
import type { EventPairTotals } from "@/lib/services/pair-totals";
import { toParText } from "@/lib/domain";
import { placesByValue, placeTexts } from "@/lib/domain/flight-places";
import { MoreInfo } from "./MoreInfo";
import { namedAfterPlayers } from "@/lib/domain/side-name";

/**
 * Standings for a team round.
 *
 * A server component: nothing here is interactive, and the alternative would
 * ship every side's members and scores to a client bundle for no reason.
 */
export function TeamLeaderboard({
  format,
  basis,
  rows,
  roundClosed = false,
  totals = null,
}: {
  format: string;
  basis: WeekBasis;
  rows: TeamStanding[];
  /** See `TeamStandingsTable`. */
  roundClosed?: boolean;
  /** The pairs' total over every team round, when there is one (`eventPairTotals`). */
  totals?: EventPairTotals | null;
}) {
  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div className="page-kicker">Overview</div>
        <h1 className="page-title">Live leaderboard</h1>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          {teamBoardNote(format, rows.length, basis)}
        </p>
      </div>
      {totals && <PairTotalsTable totals={totals} />}
      {totals && (
        <h2 className="card-title" style={{ fontSize: 15, margin: "0 0 8px" }}>
          This round
        </h2>
      )}
      <TeamStandingsTable basis={basis} rows={rows} roundClosed={roundClosed} />
    </>
  );
}

/**
 * How a team round's board describes itself, in one place.
 *
 * The player's own board shows the same sides through `TeamStandingsTable`,
 * and two sentences written separately are two sentences that will disagree
 * about what the round is ranked on.
 *
 * It took a `stableford` boolean until 2026-09-20, so everything that was not
 * Stableford announced itself as "lowest net wins" — including a round set to
 * GROSS, which is a real thing a club runs and which the sides underneath were
 * not ordered by either. Same shape as the fault `week-basis.ts` was written
 * for, on the team side of the app.
 */
export function teamBoardNote(format: string, sides: number, basis: WeekBasis): string {
  const decided =
    basis === "stableford"
      ? "Stableford points (higher is better)."
      : basis === "gross"
        ? "lowest gross wins."
        : "lowest net wins.";
  return `${format} · ${sides} ${sides === 1 ? "side" : "sides"} · ${decided}`;
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
  basis,
  rows,
  roundClosed = false,
}: {
  basis: WeekBasis;
  rows: TeamStanding[];
  /**
   * The committee has closed this round (2026-10-08, grid cell T51). Then a
   * side with no holes did not play, and "1 of 2 sides have started" under
   * FINAL read as a round still going — it says who returned a card.
   */
  roundClosed?: boolean;
}) {
  const started = rows.filter((r) => r.played > 0);
  const stableford = basis === "stableford";
  /**
   * ON WHATEVER THIS ROUND IS RANKED BY, which the sort already knows and the
   * `#` column did not: points for a Stableford round, net strokes otherwise.
   *
   * Both branches of that sort end in `name.localeCompare`, so two sides level
   * on the score were printed 1st and 2nd in alphabetical order — on the
   * console, on Reports and on the public share link.
   *
   * And GROSS since 2026-09-20 — `valueOnBasis` reads the round's own basis,
   * where this had two branches and no third. The rows were in net order on a
   * gross round and the places numbered them 1, 2, 3 down that order, so the
   * `#` column agreed with the sort and both were wrong together.
   */
  // "T1" for a shared place, as every other board prints it — see `placeTexts`.
  const places = placeTexts(placesByValue(rows, (r) => teamPlaceValue(basis, r), (r) => r.played > 0));

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
                    {/* ROOM FOR THE NAME, AND THE NAME ONCE (2026-10-06). At
                        393px the number columns took the width and a side's
                        name wrapped a word to a line — "Ashbourne / 1 /
                        Ashbourne / 2" — then printed again underneath as its
                        members, 230px a row: a 72-side board was 17 phone
                        screens. The members line is kept where it says
                        something the name does not. */}
                    <td style={{ minWidth: "9.5em" }}>
                      <div style={{ fontWeight: 500 }}>{r.name}</div>
                      {!namedAfterPlayers(r.name, r.members) && (
                        <div className="text-muted" style={{ fontSize: 13 }}>
                          {r.members.join(" · ") || "No players"}
                        </div>
                      )}
                    </td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {r.playingHandicap}
                    </td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {r.played}
                    </td>
                    {/* The RANKED column is the bold one, and on a gross round
                        that is this one. It was always Net in bold, so a gross
                        round emphasised a number the order did not follow. */}
                    <td
                      style={{
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                        fontWeight: basis === "gross" ? 600 : 400,
                      }}
                    >
                      {r.played > 0 ? r.gross : "—"}
                    </td>
                    {stableford ? (
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                        {r.played > 0 ? r.points : "—"}
                      </td>
                    ) : (
                      <>
                        <td
                          style={{
                            textAlign: "right",
                            fontVariantNumeric: "tabular-nums",
                            fontWeight: basis === "net" ? 600 : 400,
                          }}
                        >
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
        {/* What decides the order, and how far the field has got, in one
            line; the why behind the ⓘ (36 words on a phone, 2026-10-06). */}
        <MoreInfo
          style={{ marginTop: 8 }}
          short={
            (stableford ? "Stableford points." : basis === "gross" ? "Decided on gross." : "Decided on net.") +
            (started.length > 0 && started.length < rows.length
              ? roundClosed
                ? ` ${started.length} of ${rows.length} sides returned a card.`
                : ` ${started.length} of ${rows.length} sides have started.`
              : "")
          }
        >
          {stableford
            ? "Points are Stableford against the side's playing handicap. "
            : basis === "gross"
              ? "This round is decided on gross: the handicap column is shown for reference and takes no part in the order. "
              : "Net is the side's gross minus the handicap strokes it receives. "}
          Sides that haven&apos;t returned a card yet are unranked rather than shown level with the
          field.
        </MoreInfo>
      </div>
    </>
  );
}

/**
 * THE PAIRS' TOTAL OVER EVERY TEAM ROUND (2026-10-10) — see `pairTotals`.
 *
 * A 36-hole pairs event is won on this table, so it leads the board and the
 * round's own table follows it. One column per round prints that round's
 * ranked figure, then the total and (for strokes) its to-par — the total is
 * what the `#` column places on.
 */
export function PairTotalsTable({ totals }: { totals: EventPairTotals }) {
  const { basis, labels, rows } = totals;
  const stableford = basis === "stableford";
  const places = placeTexts(placesByValue(rows, (r) => teamPlaceValue(basis, r), (r) => r.played > 0));
  const num = { textAlign: "right", fontVariantNumeric: "tabular-nums" } as const;
  return (
    <div className="card elev-sm" style={{ marginBottom: 16 }}>
      <h2 className="card-title" style={{ fontSize: 15, margin: "0 0 8px" }}>
        Total over {labels.length} rounds
      </h2>
      <div className="table-scroll">
        <table className="table" style={{ fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ width: 40 }}>#</th>
              <th>Side</th>
              {labels.map((l) => (
                <th key={l} style={num}>{l}</th>
              ))}
              <th style={num}>{stableford ? "Points" : "Total"}</th>
              {!stableford && <th style={num}>To par</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key}>
                <td style={{ fontVariantNumeric: "tabular-nums" }}>{places[i] ?? "—"}</td>
                <td style={{ minWidth: "9.5em" }}>
                  <div style={{ fontWeight: 500 }}>{r.name}</div>
                  {!namedAfterPlayers(r.name, r.members) && (
                    <div className="text-muted" style={{ fontSize: 13 }}>{r.members.join(" · ")}</div>
                  )}
                </td>
                {r.rounds.map((v, j) => (
                  <td key={labels[j]} style={num}>{v ?? "—"}</td>
                ))}
                <td style={{ ...num, fontWeight: stableford ? 600 : 400 }}>
                  {r.played > 0 ? valueOnBasis(basis, r) : "—"}
                </td>
                {!stableford && (
                  <td style={{ ...num, fontWeight: 600 }}>{r.played > 0 ? toParText(r.toPar) : "—"}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <MoreInfo
        style={{ marginTop: 8 }}
        short={stableford ? "Ranked on total points." : "Ranked on the total to par."}
      >
        The same pairs played every round, so their rounds are added together, as a 36-hole medal
        is. Each round&apos;s figure is the one on that round&apos;s own board.
      </MoreInfo>
    </div>
  );
}
