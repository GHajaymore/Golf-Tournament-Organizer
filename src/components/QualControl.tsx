"use client";
import { useState, useTransition } from "react";
import { setQualifyPerGroup, setQualifyMode } from "@/app/actions/tournament";

export function QualControl({
  mode,
  perFlight,
  overall,
}: {
  mode: string;
  perFlight: number;
  overall: number;
}) {
  const [m, setM] = useState(mode === "overall" ? "overall" : "perFlight");
  const [pf, setPf] = useState(perFlight);
  const [ov, setOv] = useState(overall);
  const [pending, startTransition] = useTransition();

  const switchMode = (next: "perFlight" | "overall") => {
    setM(next);
    startTransition(() => setQualifyMode(next, ov));
  };

  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      {/* No info button here on purpose. The "Qualification cut" heading
          immediately above this control already carries CUT_SCOPE_HELP, which
          explains per-flight versus overall in the same words. A second icon
          an inch away, saying the same thing, teaches people the icons are
          noise. */}
      <div className="seg">
        <label className="seg-opt">
          <input type="radio" name="qmode" checked={m === "perFlight"} disabled={pending} onChange={() => switchMode("perFlight")} />
          Per flight
        </label>
        <label className="seg-opt">
          <input type="radio" name="qmode" checked={m === "overall"} disabled={pending} onChange={() => switchMode("overall")} />
          Overall
        </label>
      </div>
      {m === "perFlight" ? (
        <div className="seg">
          {[1, 2, 3].map((n) => (
            <label className="seg-opt" key={n}>
              <input
                type="radio"
                name="qpf"
                checked={pf === n}
                disabled={pending}
                onChange={() => {
                  setPf(n);
                  startTransition(() => setQualifyPerGroup(n));
                }}
              />
              Top {n}
            </label>
          ))}
        </div>
      ) : (
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          <span className="text-muted">Top</span>
          <input
            className="input"
            type="number"
            min={1}
            style={{ width: 80 }}
            value={ov}
            disabled={pending}
            onChange={(e) => setOv(parseInt(e.target.value, 10) || 1)}
            onBlur={() => startTransition(() => setQualifyMode("overall", ov))}
          />
          <span className="text-muted">overall</span>
        </label>
      )}
    </div>
  );
}
