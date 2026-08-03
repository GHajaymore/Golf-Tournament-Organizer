"use client";
import { useState, useTransition } from "react";
import { setStageCut } from "@/app/actions/tournament";

export function CutControl({
  stageId,
  enabled,
  mode,
  count,
  percent,
  confirmedCount,
}: {
  stageId: string;
  enabled: boolean;
  mode: string;
  count: number;
  percent: number;
  confirmedCount: number;
}) {
  const [on, setOn] = useState(enabled);
  const [m, setM] = useState(mode === "percent" ? "percent" : "count");
  const [n, setN] = useState(count);
  const [pct, setPct] = useState(percent);
  const [pending, startTransition] = useTransition();

  const commit = (nextOn: boolean, nextMode: string, nextN: number, nextPct: number) => {
    setOn(nextOn);
    setM(nextMode);
    setN(nextN);
    setPct(nextPct);
    startTransition(() => setStageCut(stageId, nextOn, nextMode, nextN, nextPct));
  };

  const survivors =
    m === "percent"
      ? Math.max(1, Math.ceil((confirmedCount * pct) / 100))
      : Math.max(1, Math.min(n, confirmedCount || n));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
        <input type="checkbox" checked={on} disabled={pending} onChange={(e) => commit(e.target.checked, m, n, pct)} />
        Cut the field entering this round
      </label>
      {on && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div className="seg">
            <label className="seg-opt">
              <input
                type="radio"
                name={`cutmode-${stageId}`}
                checked={m === "count"}
                disabled={pending}
                onChange={() => commit(on, "count", n, pct)}
              />
              Top N
            </label>
            <label className="seg-opt">
              <input
                type="radio"
                name={`cutmode-${stageId}`}
                checked={m === "percent"}
                disabled={pending}
                onChange={() => commit(on, "percent", n, pct)}
              />
              Top N%
            </label>
          </div>
          {m === "count" ? (
            <input
              className="input"
              type="number"
              min={1}
              style={{ width: 90 }}
              value={n}
              disabled={pending}
              onChange={(e) => setN(parseInt(e.target.value, 10) || 1)}
              onBlur={() => commit(on, m, n, pct)}
            />
          ) : (
            <input
              className="input"
              type="number"
              min={1}
              max={100}
              style={{ width: 90 }}
              value={pct}
              disabled={pending}
              onChange={(e) => setPct(parseInt(e.target.value, 10) || 1)}
              onBlur={() => commit(on, m, n, pct)}
            />
          )}
          <span className="text-muted" style={{ fontSize: 12 }}>
            {survivors} of {confirmedCount} advance into this round.
          </span>
        </div>
      )}
    </div>
  );
}
