"use client";
import { toParText } from "@/lib/domain";

/**
 * A scorecard, the way a scorecard looks.
 *
 * Every hole, the reference rows a player checks against, and the totals — out,
 * in, and the whole round — with gross AND net side by side. There were two
 * grids in this app and neither had all of it: the organizer's showed yards,
 * par, stroke index and a gross total but never the shots a player receives or
 * the net they produce, and the player's card had no grid at all, only one
 * hole at a time. A player who wants to check their card against the paper one
 * could not.
 *
 * One component now, so the console and the phone print the same card. It
 * renders read-only by default and takes `onSet` to become editable, which is
 * the only real difference between the two uses.
 *
 * The shots row is the part worth having: dots on the holes where this player
 * gets a stroke, from the server's own allocation. A net figure with no
 * working shown is a number a player has to take on trust — and they will not.
 */

const sum = (arr: Array<number | null | undefined>, from: number, to: number): number => {
  let total = 0;
  for (let i = from; i < to; i += 1) {
    const v = arr[i];
    if (typeof v === "number" && Number.isFinite(v)) total += v;
  }
  return total;
};

export function ScorecardTable({
  holes,
  pars,
  yards = [],
  strokeIndex = [],
  strokes,
  shotsPerHole = [],
  playingHandicap,
  onSet,
  scoreLabel = "Score",
}: {
  holes: number;
  pars: number[];
  yards?: number[];
  strokeIndex?: number[];
  strokes: (number | null)[];
  /** Handicap strokes per hole, from the server's allocation. */
  shotsPerHole?: number[];
  /** Shown beside the net total, so the number can be checked. */
  playingHandicap?: number;
  /** Provided when the card is being filled in rather than read. */
  onSet?: (hole: number, value: number | null) => void;
  scoreLabel?: string;
}) {
  const isEighteen = holes > 9;
  const front = Array.from({ length: Math.min(9, holes) }, (_, i) => i);
  const back = isEighteen ? Array.from({ length: holes - 9 }, (_, i) => i + 9) : [];

  const played = strokes.slice(0, holes).filter((s) => typeof s === "number" && s > 0).length;
  const gross = sum(strokes, 0, holes);
  // Par and strokes received over the holes actually PLAYED, so both mean
  // something through nine as well as eighteen — the same rule the board
  // totals by. Typed as numbers explicitly: the array holds nulls, and an
  // accumulator that can be null is an accumulator that will be.
  let parThru = 0;
  let received = 0;
  for (let i = 0; i < holes; i += 1) {
    const s = strokes[i];
    if (typeof s !== "number" || s <= 0) continue;
    parThru += pars[i] ?? 0;
    received += shotsPerHole[i] ?? 0;
  }
  const net = gross - Math.round(received);
  const hasShots = shotsPerHole.some((n) => (n ?? 0) > 0);
  const hasYards = yards.some((y) => typeof y === "number" && y > 0);
  const hasSi = strokeIndex.some((n) => typeof n === "number" && n > 0);

  /**
   * The scorecard marks a golfer already reads: a ring for under par, a box
   * for over. Kept from the console's grid when the two were merged, because
   * a wrong number is caught by its shape long before anybody adds the column
   * up — a birdie ring on a hole you know you bogeyed is spotted instantly.
   */
  const markOf = (i: number): string => {
    const v = strokes[i];
    const par = pars[i];
    if (v == null || !par) return "";
    const d = v - par;
    if (d <= -2) return " is-eagle";
    if (d === -1) return " is-under";
    if (d === 1) return " is-over";
    if (d >= 2) return " is-double";
    return "";
  };

  const cell = (i: number) => {
    const value = strokes[i] ?? null;
    const par = pars[i];
    if (!onSet) {
      return (
        <td key={i} style={{ padding: 2 }}>
          <span
            className={`sc-score${markOf(i)}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: 30,
              minHeight: 30,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {value ?? "–"}
          </span>
        </td>
      );
    }
    return (
      <td key={i} style={{ padding: 2 }}>
        <input
          className={`input sc-score${markOf(i)}`}
          inputMode="numeric"
          aria-label={`Hole ${i + 1}${par ? `, par ${par}` : ""}`}
          value={value ?? ""}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            onSet(i, Number.isFinite(n) && n > 0 ? n : null);
          }}
        />
      </td>
    );
  };

  return (
    <div>
      <div className="sc-wrap">
        <table className="sc" style={{ minWidth: isEighteen ? 960 : 560 }}>
          <thead>
            <tr>
              <th>Hole</th>
              {front.map((i) => (<th key={i}>{i + 1}</th>))}
              {isEighteen && <th className="sc-tot">Out</th>}
              {back.map((i) => (<th key={i}>{i + 1}</th>))}
              {isEighteen && <th className="sc-tot">In</th>}
              <th className="sc-tot">Tot</th>
            </tr>
          </thead>
          <tbody>
            {hasYards && (
              <tr className="sc-ref">
                <td>Yards</td>
                {front.map((i) => (<td key={i}>{yards[i] ?? "-"}</td>))}
                {isEighteen && <td className="sc-tot">{sum(yards, 0, 9)}</td>}
                {back.map((i) => (<td key={i}>{yards[i] ?? "-"}</td>))}
                {isEighteen && <td className="sc-tot">{sum(yards, 9, holes)}</td>}
                <td className="sc-tot">{sum(yards, 0, holes)}</td>
              </tr>
            )}
            <tr className="sc-ref sc-par">
              <td>Par</td>
              {front.map((i) => (<td key={i}>{pars[i] ?? "-"}</td>))}
              {isEighteen && <td className="sc-tot">{sum(pars, 0, 9)}</td>}
              {back.map((i) => (<td key={i}>{pars[i] ?? "-"}</td>))}
              {isEighteen && <td className="sc-tot">{sum(pars, 9, holes)}</td>}
              <td className="sc-tot">{sum(pars, 0, holes)}</td>
            </tr>
            {hasSi && (
              <tr className="sc-ref">
                <td>S.I.</td>
                {front.map((i) => (<td key={i}>{strokeIndex[i] ?? "-"}</td>))}
                {isEighteen && <td className="sc-tot" />}
                {back.map((i) => (<td key={i}>{strokeIndex[i] ?? "-"}</td>))}
                {isEighteen && <td className="sc-tot" />}
                <td className="sc-tot" />
              </tr>
            )}
            {/* Where the shots fall. The working behind the net total, on the
                holes it actually happens. */}
            {hasShots && (
              <tr className="sc-ref">
                <td>Shots</td>
                {front.map((i) => (
                  <td key={i} style={{ color: "var(--color-accent-400)", fontWeight: 700 }}>
                    {shotsPerHole[i] ? "•".repeat(shotsPerHole[i]) : ""}
                  </td>
                ))}
                {isEighteen && <td className="sc-tot">{sum(shotsPerHole, 0, 9)}</td>}
                {back.map((i) => (
                  <td key={i} style={{ color: "var(--color-accent-400)", fontWeight: 700 }}>
                    {shotsPerHole[i] ? "•".repeat(shotsPerHole[i]) : ""}
                  </td>
                ))}
                {isEighteen && <td className="sc-tot">{sum(shotsPerHole, 9, holes)}</td>}
                <td className="sc-tot">{sum(shotsPerHole, 0, holes)}</td>
              </tr>
            )}
            <tr>
              <td>{scoreLabel}</td>
              {front.map((i) => cell(i))}
              {isEighteen && <td className="sc-tot">{sum(strokes, 0, 9) || "—"}</td>}
              {back.map((i) => cell(i))}
              {isEighteen && <td className="sc-tot">{sum(strokes, 9, holes) || "—"}</td>}
              <td className="sc-tot">{gross || "—"}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* The totals, spelled out. Gross and net together, because a card that
          shows one of them makes the player work the other out. */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 18,
          marginTop: 10,
          fontSize: 13,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <Total label="Holes in" value={`${played} of ${holes}`} />
        <Total label="Gross" value={gross ? String(gross) : "—"} />
        {pars.length > 0 && (
          <Total label="To par" value={played ? toParText(gross - parThru) : "—"} />
        )}
        {hasShots && (
          <Total
            label="Net"
            value={gross ? String(net) : "—"}
            hint={
              playingHandicap != null
                ? `${gross || 0} gross less ${Math.round(received)} of a ${playingHandicap} playing handicap`
                : undefined
            }
          />
        )}
      </div>
    </div>
  );
}

function Total({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <span title={hint}>
      <span className="text-muted" style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase" }}>
        {label}{" "}
      </span>
      <strong style={{ fontSize: 15 }}>{value}</strong>
    </span>
  );
}
