import Link from "next/link";
import { cutSettledOnCountback } from "@/lib/domain/cut";
import { screenName } from "@/lib/nav";
import { pts, shortName, distinctLabels } from "@/lib/format";
import { Icon } from "./Icon";

/**
 * How this draw was seeded — the qualification audit, under the bracket.
 *
 * It used to be its own screen, and the pairing of the two was never a
 * coincidence: `/bracket`'s own subtitle reads "Seeded from qualification", the
 * two nav items were gated on the same condition so they appeared and vanished
 * together, and they showed the same four people — one as "who goes through",
 * the other as "who they play". Two sidebar entries that are never separately
 * available are one screen.
 *
 * UNDER THE DRAW, NOT ABOVE IT. Qualification comes first in time, so reading
 * order argues for the top. The screen's job argues otherwise: `/bracket` is an
 * `on-course` route, tapped one-handed to advance a winner, and this is a
 * 33-player audit read sitting down. Putting the audit first would bury the
 * thing the screen exists for behind the explanation of it. So the draw leads,
 * and this answers "how did those four get there" for whoever asks.
 *
 * STAFF ONLY, which is what it always was: `roles.ts` grants `qualification` to
 * admin and assistant, and `bracket` to players as well. Merging the screens
 * must not hand a player the preview — including the per-flight "Eliminated"
 * tags beside their own name — that they could not reach before.
 */

export interface QualificationRow {
  id: string;
  name: string;
  points: number;
  advancing: boolean;
  /** 1-based flight number, or null when the field is unflighted. */
  flight: number | null;
}

export interface QualificationFlight {
  id: string;
  /** 1-based, for the heading. */
  number: number;
  rows: Array<{ id: string; rank: number; name: string; points: number; advancing: boolean }>;
}

export function QualificationPanel({
  rule,
  advancingCount,
  fieldSize,
  toWinners,
  secondLabel,
  toSecond,
  cutoff,
  qualifiers,
  flights,
}: {
  /** "Top 4 overall" / "Top 2/flight", as the tournament is configured. */
  rule: string;
  advancingCount: number;
  fieldSize: number;
  toWinners: number;
  /** Empty for "One bracket", which has no second draw to describe. */
  secondLabel: string;
  toSecond: number;
  /** Null when nothing has been played, so no line has formed. */
  cutoff: number | null;
  qualifiers: QualificationRow[];
  flights: QualificationFlight[];
}) {
  /**
   * Shortened names, across ALL the flights rather than within each one.
   *
   * `shortName` alone gives "Dave S." to both Dave Sherman and Dave Salt, and
   * this is the table that says who advances — two identical rows, one tagged
   * Advancing and one Eliminated, with nothing on screen to say which Dave
   * went through. The flights are columns on one screen, so a name repeated
   * in the next column is just as unreadable as one repeated in this column;
   * the scope is the panel.
   */
  const allRows = flights.flatMap((f) => f.rows);
  /**
   * Whether the qualifying line fell between two equal totals — see
   * `cutSettledOnCountback`. Computed over every player in the panel rather
   * than the qualifiers alone, because the question is about both sides of
   * the line.
   */
  const countback = cutSettledOnCountback(allRows);
  const flightLabels = new Map(
    distinctLabels(allRows.map((r) => r.name), shortName).map((label, i) => [allRows[i].id, label] as const),
  );

  return (
    <section style={{ marginTop: 24, paddingTop: 20, borderTop: "1px solid var(--color-divider)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 14,
        }}
      >
        <div>
          <div className="page-kicker">Qualification</div>
          <h2 style={{ fontSize: 20, margin: "5px 0 0", fontFamily: "var(--font-heading)", fontWeight: 500 }}>
            How this draw was seeded
          </h2>
          <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13, maxWidth: "62ch", lineHeight: 1.5 }}>
            The top players from each flight, or the top players overall — whichever this tournament
            is set to. Every player is shown, so you can see exactly who missed out and by how much.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span className="tag tag-accent">{rule}</span>
          {/* Where it is CHANGED, which is not here. This screen reports the
              line; the round builder draws it. */}
          <Link className="btn btn-secondary" href="/stages">
            <Icon name="sliders" /> Configure in {screenName("/stages")}
          </Link>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div className="card elev-sm" style={{ flex: 1, minWidth: 140, gap: 2 }}>
          <span className="card-kicker">Advancing</span>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 24 }}>
            {advancingCount} / {fieldSize}
          </div>
        </div>
        <div className="card elev-sm" style={{ flex: 1, minWidth: 140, gap: 2 }}>
          <span className="card-kicker">To Winners bracket</span>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 24 }}>{toWinners}</div>
        </div>
        {secondLabel && (
          <div className="card elev-sm" style={{ flex: 1, minWidth: 140, gap: 2 }}>
            <span className="card-kicker">To {secondLabel}</span>
            <div style={{ fontFamily: "var(--font-heading)", fontSize: 24 }}>{toSecond}</div>
          </div>
        )}
        <div className="card elev-sm" style={{ flex: 1, minWidth: 140, gap: 2 }}>
          <span className="card-kicker">Cutoff pts</span>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 24 }}>
            {cutoff === null ? "—" : pts(cutoff)}
          </div>
          {/**
           * THE NUMBER ALONE IS TRUE AND INCOMPLETE.
           *
           * `overallCutoff` is the lowest total that got through. On Demo Cup
           * that is 10.5 — and four players are on exactly 10.5, of whom two
           * advanced and two did not. A member on 10.5 reads a cutoff of 10.5
           * and concludes they qualified; the organizer has to explain why
           * they did not, from this screen.
           *
           * Nothing is wrong with the result: `rankPlayers` separated them on
           * the club's own chain, which is a published countback and a proper
           * way to decide a cut. What was missing is that it happened.
           *
           * Not `tiedAtCut`, which is the opposite case — the chain COULD NOT
           * separate them and a play-off is owed. Here nobody is owed
           * anything and the question still gets asked at the bar.
           */}
          {countback && (
            <span className="text-muted" style={{ fontSize: 11.5, lineHeight: 1.4 }}>
              Players finished level on this. The line was settled on countback.
            </span>
          )}
        </div>
      </div>

      <div className="card elev-sm" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <span className="card-title" style={{ fontSize: 15 }}>
            {qualifiers.length} {qualifiers.length === 1 ? "player qualifies" : "players qualify"} for the knockout round
          </span>
          <span className="tag tag-accent">{rule}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "0 24px", marginTop: 6 }}>
          {qualifiers.map((r, i) => (
            <div
              key={r.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
                padding: "5px 0",
                borderBottom: "1px solid var(--color-divider)",
              }}
            >
              <span style={{ width: 18, color: "var(--color-neutral-500)", fontVariantNumeric: "tabular-nums" }}>
                {i + 1}
              </span>
              <span style={{ flex: 1, minWidth: 0, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.name}
              </span>
              <span className="text-muted" style={{ fontSize: 12 }}>Flight {r.flight ?? "—"}</span>
              <span style={{ fontWeight: 600, color: "var(--color-accent-200)", fontVariantNumeric: "tabular-nums", width: 40, textAlign: "right" }}>
                {pts(r.points)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* `auto-fit` rather than a fixed two columns: this sat in a hard
          `repeat(2, 1fr)`, which on a phone gave eight flights two columns of
          about 160px and squeezed every name to an initial. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
        {flights.map((f) => (
          <div key={f.id} className="card elev-sm">
            <span style={{ fontWeight: 600, fontSize: 14 }}>Flight {f.number}</span>
            <table className="table" style={{ fontSize: 13 }}>
              <tbody>
                {f.rows.map((r) => (
                  <tr key={r.id} style={r.advancing ? { background: "var(--color-accent-900)" } : undefined}>
                    <td style={{ width: 26, color: "var(--color-neutral-500)" }}>{r.rank}</td>
                    <td style={{ fontWeight: 500 }}>{flightLabels.get(r.id) ?? shortName(r.name)}</td>
                    <td>
                      <span className={`tag ${r.advancing ? "tag-accent" : "tag-neutral"}`}>
                        {r.advancing ? "Advancing" : "Eliminated"}
                      </span>
                    </td>
                    <td style={{ textAlign: "right", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                      {pts(r.points)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </section>
  );
}
