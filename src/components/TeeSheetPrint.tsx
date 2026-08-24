"use client";
import { useState } from "react";

export interface PrintGroup {
  name: string;
  startHole: number;
  half?: "A" | "B";
  time: string;
  /**
   * Each player with the tee they are playing from.
   *
   * `tee` is the name resolved by the round the card belongs to, so a
   * single-tee competition prints the same set beside every name and a mixed
   * field prints each player their own. Empty when the course has no rated
   * tees, in which case the card says nothing rather than inventing a set.
   */
  players: Array<{ name: string; handicap: number; tee?: string }>;
}

/**
 * Printed scorecards, one per foursome, straight from the saved sheet.
 *
 * This is the scorecard-printing merge: the sheet of record already knows
 * who plays together, from which tee, at what time — so the card each group
 * carries to the first tee is generated from it rather than assembled by
 * hand. Header carries club, course and date, because a card without its
 * provenance is a page of numbers; body carries par and stroke index so net
 * strokes can be marked where they fall.
 *
 * Print isolation is the classic visibility trick: on screen this renders a
 * button and nothing else; on paper, only the cards exist. Each card breaks
 * to its own page — a foursome shares one card, not half of someone else's.
 */
export function TeeSheetPrint({
  groups,
  clubName,
  clubLogoUrl = "",
  courseName,
  dates,
  roundLabel,
  pars,
  strokeIndex,
  holes,
}: {
  groups: PrintGroup[];
  clubName: string;
  /** The club's logo, printed beside its name. Empty for a club that has not
   *  set one, in which case the name alone heads the card — the same rule the
   *  on-screen card follows, and no TourneyHQ mark on a club's paper. */
  clubLogoUrl?: string;
  courseName: string;
  dates: string;
  roundLabel: string;
  pars: number[];
  strokeIndex: number[];
  holes: number;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const all = selected.size === 0;
  const printable = all ? groups : groups.filter((g) => selected.has(g.name));
  const nums = Array.from({ length: holes }, (_, i) => i);
  if (groups.length === 0) return null;

  return (
    <>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
        <button type="button" className="btn btn-secondary" onClick={() => window.print()}>
          <i className="ph ph-cards" /> Print scorecards
          {all ? " (all groups)" : ` (${selected.size} selected)`}
        </button>
        <span className="text-muted" style={{ fontSize: 12 }}>
          One card per group, from the saved sheet.
        </span>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {groups.map((g) => (
            <label key={g.name} style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 11.5 }}>
              <input
                type="checkbox"
                checked={selected.has(g.name)}
                onChange={() =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (next.has(g.name)) next.delete(g.name);
                    else next.add(g.name);
                    return next;
                  })
                }
              />
              {g.name}
            </label>
          ))}
        </div>
      </div>

      <style>{`
        #foursome-cards { display: none; }
        @media print {
          body * { visibility: hidden; }
          #foursome-cards, #foursome-cards * { visibility: visible; }
          #foursome-cards { display: block; position: absolute; left: 0; top: 0; width: 100%; }
          .foursome-card { page-break-after: always; padding: 24px; color: #000; }
          .foursome-card table { width: 100%; border-collapse: collapse; font-size: 11px; }
          .foursome-card th, .foursome-card td { border: 1px solid #333; padding: 4px 3px; text-align: center; }
          .foursome-card td:first-child, .foursome-card th:first-child { text-align: left; min-width: 110px; }
        }
      `}</style>

      <div id="foursome-cards">
        {printable.map((g) => (
          <div key={g.name} className="foursome-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                {/* The club's own badge on the card its members carry round.
                    An arbitrary external host, so a plain <img> — the same
                    reason and the same exemption the on-screen card carries. */}
                {clubLogoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={clubLogoUrl}
                    alt=""
                    style={{ height: 30, width: "auto", maxWidth: 110, objectFit: "contain" }}
                  />
                )}
                <strong style={{ fontSize: 16 }}>{clubName || courseName}</strong>
              </span>
              <span style={{ fontSize: 12 }}>{[courseName, dates].filter(Boolean).join(" · ")}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 10 }}>
              <span>
                {roundLabel} — {g.name}
              </span>
              <span>
                Hole {g.startHole}
                {g.half ?? ""} · {g.time}
              </span>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Hole</th>
                  {nums.map((i) => (
                    <th key={i}>{i + 1}</th>
                  ))}
                  <th>Tot</th>
                </tr>
                <tr>
                  <th>Par</th>
                  {nums.map((i) => (
                    <th key={i}>{pars[i] ?? ""}</th>
                  ))}
                  <th>{pars.slice(0, holes).reduce((s, n) => s + (n || 0), 0) || ""}</th>
                </tr>
                <tr>
                  <th>S.I.</th>
                  {nums.map((i) => (
                    <th key={i}>{strokeIndex[i] ?? ""}</th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {g.players.map((p) => (
                  <tr key={p.name} style={{ height: 30 }}>
                    <td>
                      {p.name} <span style={{ fontSize: 9 }}>({p.handicap})</span>
                      {p.tee ? (
                        <span style={{ fontSize: 8.5, marginLeft: 4, opacity: 0.75 }}>{p.tee}</span>
                      ) : null}
                    </td>
                    {nums.map((i) => (
                      <td key={i} />
                    ))}
                    <td />
                  </tr>
                ))}
                <tr style={{ height: 24 }}>
                  <td style={{ fontSize: 9 }}>Marker&rsquo;s signature</td>
                  {nums.map((i) => (
                    <td key={i} style={{ border: "none" }} />
                  ))}
                  <td style={{ border: "none" }} />
                </tr>
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </>
  );
}
