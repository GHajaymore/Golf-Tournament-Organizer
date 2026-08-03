"use client";
import { useState, useTransition } from "react";
import { saveScoring, saveTiebreakers } from "@/app/actions/tournament";
import { pts } from "@/lib/format";
import { TIEBREAKER_LABELS, TIEBREAKER_KEYS, type TiebreakerKey } from "@/lib/domain";

interface Values {
  winPts: number;
  tiePts: number;
  lossPts: number;
  holeRatioPts: number;
  bonusPts: number;
}

const FIELDS: Array<{ key: keyof Values; label: string; hint: string; step: number }> = [
  { key: "winPts", label: "Win", hint: "Points for winning a match", step: 0.5 },
  { key: "tiePts", label: "Halve", hint: "Points for a halved match", step: 0.5 },
  { key: "lossPts", label: "Loss", hint: "Points for losing a match", step: 0.5 },
  { key: "holeRatioPts", label: "Hole-win ratio", hint: "Points per net hole won", step: 0.1 },
  { key: "bonusPts", label: "Bonus", hint: "Flat bonus per player", step: 0.5 },
];

export function ScoringClient({
  initial,
  tiebreakers,
}: {
  initial: Values;
  tiebreakers: TiebreakerKey[];
}) {
  const [values, setValues] = useState<Values>(initial);
  const [order, setOrder] = useState<TiebreakerKey[]>(tiebreakers);
  const [pending, startTransition] = useTransition();

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
    startTransition(() => saveTiebreakers(next));
  };

  const toggle = (key: TiebreakerKey, on: boolean) => {
    const next = on ? [...order, key] : order.filter((k) => k !== key);
    setOrder(next);
    startTransition(() => saveTiebreakers(next));
  };

  const available = TIEBREAKER_KEYS.filter((k) => !order.includes(k));

  const save = (next: Values) => {
    setValues(next);
    startTransition(() => saveScoring(next));
  };

  const onChange = (key: keyof Values, raw: string) => {
    const n = parseFloat(raw);
    save({ ...values, [key]: Number.isFinite(n) ? n : 0 });
  };

  // Worked example: 2 wins, 1 halve, 12 net holes won.
  const exampleW = 2, exampleT = 1, exampleH = 12;
  const total =
    exampleW * values.winPts + exampleT * values.tiePts + exampleH * values.holeRatioPts + values.bonusPts;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
      <div className="card elev-sm" style={{ gap: 14 }}>
        <span className="card-title" style={{ fontSize: 15 }}>Points {pending && <span className="text-muted" style={{ fontSize: 12 }}>· saving…</span>}</span>
        {FIELDS.map((f) => (
          <div key={f.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{f.label}</div>
              <div className="text-muted" style={{ fontSize: 12 }}>{f.hint}</div>
            </div>
            <input
              className="input"
              type="number"
              step={f.step}
              style={{ width: 90, textAlign: "right" }}
              value={values[f.key]}
              onChange={(e) => onChange(f.key, e.target.value)}
            />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="card elev-sm">
          <span className="card-title" style={{ fontSize: 15 }}>Tiebreakers</span>
          <p className="text-muted" style={{ fontSize: 12, margin: "-2px 0 4px" }}>
            Switch on the ones you want, applied in order when points are level. Reorder the active ones with the arrows.
          </p>
          {order.map((t, i) => (
            <div
              key={t}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                fontSize: 13,
                padding: "6px 10px",
                background: "var(--color-bg)",
                borderRadius: 6,
                marginBottom: 5,
              }}
            >
              <label style={{ display: "flex", alignItems: "center", cursor: "pointer" }}>
                <input type="checkbox" checked disabled={pending} onChange={() => toggle(t, false)} />
              </label>
              <span
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  background: "var(--color-accent-800)",
                  color: "var(--color-accent-100)",
                  display: "grid",
                  placeItems: "center",
                  fontSize: 11,
                  flex: "none",
                }}
              >
                {i + 1}
              </span>
              <span style={{ flex: 1 }}>{TIEBREAKER_LABELS[t]}</span>
              <button type="button" className="btn btn-icon" disabled={pending || i === 0} onClick={() => move(i, -1)} title="Move up" style={{ width: 28, height: 28 }}>
                <i className="ph ph-caret-up" />
              </button>
              <button type="button" className="btn btn-icon" disabled={pending || i === order.length - 1} onClick={() => move(i, 1)} title="Move down" style={{ width: 28, height: 28 }}>
                <i className="ph ph-caret-down" />
              </button>
            </div>
          ))}
          {order.length === 0 && (
            <p className="text-muted" style={{ fontSize: 12, margin: "4px 0" }}>
              None active — level standings fall back to seed order.
            </p>
          )}
          {available.length > 0 && (
            <>
              <div className="text-muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", margin: "8px 0 4px" }}>
                Available
              </div>
              {available.map((t) => (
                <label
                  key={t}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    fontSize: 13,
                    padding: "6px 10px",
                    borderRadius: 6,
                    marginBottom: 5,
                    cursor: "pointer",
                    color: "var(--color-neutral-400)",
                  }}
                >
                  <input type="checkbox" checked={false} disabled={pending} onChange={() => toggle(t, true)} />
                  {TIEBREAKER_LABELS[t]}
                </label>
              ))}
            </>
          )}
        </div>
        <div className="card elev-sm">
          <span className="card-kicker">Worked example</span>
          <p className="card-body" style={{ fontSize: 13 }}>
            A player with {exampleW} wins, {exampleT} halve and {exampleH} net holes won scores{" "}
            {exampleW}×{pts(values.winPts)} + {exampleT}×{pts(values.tiePts)} + {exampleH}×
            {pts(values.holeRatioPts)}
            {values.bonusPts ? ` + ${pts(values.bonusPts)} bonus` : ""} = <strong>{pts(total)} pts</strong>.
          </p>
        </div>
      </div>
    </div>
  );
}
