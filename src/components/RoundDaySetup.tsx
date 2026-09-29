"use client";
import { useState } from "react";
import { setPaceMinutes, setPinSheet } from "@/app/actions/round-day";
import { MAX_PACES_OFF, MAX_PACES_ON, type PinSheet, type PinSide } from "@/lib/domain/pin-sheet";
import { DEFAULT_PACE_MINUTES, hoursAndMinutes, minutesPerHole } from "@/lib/domain/pace";
import { useAction } from "./useAction";

/**
 * ROUND-DAY SET-UP on the tee sheet: where the holes are cut, and the time the
 * round is allowed. Both are what the committee settles on the morning, beside
 * the draw they print the cards from — so they live here, and the printed card
 * carries the pins.
 */

type Row = { on: string; side: PinSide; off: string };

const toRows = (sheet: PinSheet, holes: number): Row[] =>
  Array.from({ length: holes }, (_, i) => {
    const p = sheet[i];
    return p ? { on: String(p.on), side: p.side, off: p.side === "C" ? "" : String(p.off) } : { on: "", side: "C", off: "" };
  });

/** Time-allowed choices, 3h 30m to 5h 00m in quarter hours — a club's real range. */
const PACE_CHOICES = Array.from({ length: 7 }, (_, i) => 210 + i * 15);

export function RoundDaySetup({
  stageId,
  roundLabel,
  holes,
  pars,
  sheet,
  paceMinutes,
}: {
  stageId: string;
  roundLabel: string;
  holes: number;
  pars: number[];
  sheet: PinSheet;
  paceMinutes: number;
}) {
  const [rows, setRows] = useState<Row[]>(() => toRows(sheet, holes));
  const [pace, setPace] = useState(paceMinutes);
  const [saved, setSaved] = useState("");
  // Refreshed, so the printed cards below pick up the new pins.
  const pins = useAction({ refresh: true });
  const paceAction = useAction();

  const setRow = (i: number, patch: Partial<Row>) => {
    setSaved("");
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  };
  const payload = () =>
    rows.map((r) =>
      r.on.trim() === "" && r.off.trim() === ""
        ? null
        : { on: r.on.trim(), side: r.side, off: r.side === "C" ? 0 : r.off.trim() },
    );
  const placed = rows.filter((r) => r.on.trim() !== "").length;
  const target = pace || DEFAULT_PACE_MINUTES;

  return (
    <section className="card elev-sm" style={{ marginTop: 20, gap: 14 }} aria-labelledby={`${stageId}-roundday`}>
      <div>
        <h2 id={`${stageId}-roundday`} className="card-title" style={{ fontSize: 16, margin: 0 }}>
          Round day — {roundLabel || "this round"}
        </h2>
        <p className="text-muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
          Where the holes are cut, and the time the round is allowed. The pins print on every card and show on
          each hole of a player&rsquo;s phone.
        </p>
      </div>

      <div style={{ display: "grid", gap: 6 }}>
        <label htmlFor={`${stageId}-pace`} style={{ fontSize: 14, fontWeight: 600 }}>
          Time allowed
        </label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <select
            id={`${stageId}-pace`}
            className="input"
            style={{ width: "auto" }}
            value={pace}
            disabled={paceAction.pending}
            onChange={(e) => {
              const v = Number(e.target.value);
              setPace(v);
              paceAction.run(() => setPaceMinutes(stageId, v));
            }}
          >
            <option value={0}>Club default — {hoursAndMinutes(DEFAULT_PACE_MINUTES)}</option>
            {PACE_CHOICES.map((m) => (
              <option key={m} value={m}>
                {hoursAndMinutes(m)}
              </option>
            ))}
          </select>
          <span className="text-muted" style={{ fontSize: 12 }}>
            for 18 holes as a four-ball · three-ball {hoursAndMinutes(minutesPerHole(target, 3) * 18)} · two-ball{" "}
            {hoursAndMinutes(minutesPerHole(target, 2) * 18)}
          </span>
        </div>
        {paceAction.error && (
          <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--color-danger)" }}>
            {paceAction.error}
          </p>
        )}
      </div>

      <div style={{ display: "grid", gap: 6 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>Pin sheet</span>
        <p className="text-muted" style={{ margin: 0, fontSize: 12 }}>
          Paces on from the front of the green, then which side (L, C for the middle, R) and paces in from it —
          22 / 6R is twenty-two on, six from the right. Leave a hole blank if it isn&rsquo;t set.
        </p>
        <div style={{ overflowX: "auto" }}>
          <table className="table table-tight" style={{ minWidth: 0, fontSize: 13 }}>
            <thead>
              <tr>
                <th scope="col">Hole</th>
                <th scope="col">Par</th>
                <th scope="col">On</th>
                <th scope="col">Side</th>
                <th scope="col">Off side</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <th scope="row">{i + 1}</th>
                  <td className="text-muted">{pars[i] ?? ""}</td>
                  <td>
                    <input
                      className="input"
                      inputMode="numeric"
                      aria-label={`Hole ${i + 1}: paces on`}
                      style={{ width: "3.2em", padding: "4px 6px" }}
                      maxLength={2}
                      value={r.on}
                      onChange={(e) => setRow(i, { on: e.target.value.replace(/\D/g, "") })}
                    />
                  </td>
                  <td>
                    <select
                      className="input"
                      aria-label={`Hole ${i + 1}: side`}
                      // Room on the right for the chevron `select.input` draws there.
                      style={{ width: "4.2em", padding: "4px 24px 4px 8px" }}
                      value={r.side}
                      onChange={(e) => setRow(i, { side: e.target.value as PinSide })}
                    >
                      {/* The letters a pin sheet uses — "Centre" did not fit a
                          phone's column and truncated to "Cente". */}
                      <option value="L">L</option>
                      <option value="C">C</option>
                      <option value="R">R</option>
                    </select>
                  </td>
                  <td>
                    <input
                      className="input"
                      inputMode="numeric"
                      aria-label={`Hole ${i + 1}: paces from the ${r.side === "L" ? "left" : "right"} edge`}
                      style={{ width: "3.2em", padding: "4px 6px" }}
                      maxLength={2}
                      disabled={r.side === "C"}
                      value={r.side === "C" ? "" : r.off}
                      onChange={(e) => setRow(i, { off: e.target.value.replace(/\D/g, "") })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={pins.pending}
            onClick={() =>
              pins.run(
                () => setPinSheet(stageId, payload()),
                () => setSaved(placed ? `Saved — ${placed} of ${holes} holes set.` : "Pin sheet cleared."),
              )
            }
          >
            {pins.pending ? "Saving…" : "Save pin sheet"}
          </button>
          {saved && (
            <span role="status" className="text-muted" style={{ fontSize: 13 }}>
              {saved}
            </span>
          )}
          <span className="text-muted" style={{ fontSize: 12 }}>
            Up to {MAX_PACES_ON} paces on and {MAX_PACES_OFF} from an edge.
          </span>
        </div>
        {pins.error && (
          <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--color-danger)" }}>
            {pins.error}
          </p>
        )}
      </div>
    </section>
  );
}
