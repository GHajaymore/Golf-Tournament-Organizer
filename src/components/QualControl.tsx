"use client";
import { figureOr, readWhole } from "@/lib/domain/decimal-text";
import { useId, useState, useTransition } from "react";
import { setQualifyPerGroup, setQualifyMode } from "@/app/actions/tournament";
import { SaveState, useSaveStatus } from "./SaveState";
import { leaveOnEnter } from "@/lib/leave-on-enter";

export function QualControl({
  mode,
  perFlight,
  overall,
  locked = false,
  flightCount = 2,
}: {
  mode: string;
  perFlight: number;
  overall: number;
  /**
   * Flights the field is in. With exactly one, "per flight" is the top N of
   * everybody — top 2 is a final — and the stroke cut beside it already says so
   * and disables the choice; this said nothing (2026-10-16). Zero is flights
   * not yet drawn, which is not the same. Defaults to two so a caller not yet
   * taught is unchanged.
   */
  flightCount?: number;
  /** Setup is locked, which both actions refuse by throwing. */
  locked?: boolean;
}) {
  // Radio names unique to this control: they were fixed ("qmode", "qpf"), and a
  // closed round card stays in the page, so two knockout rounds put their radios
  // in one group (the UI/UX designer on the review panel).
  const gid = useId();
  const [m, setM] = useState(mode === "overall" ? "overall" : "perFlight");
  const [pf, setPf] = useState(perFlight);
  const [ov, setOv] = useState(overall);
  const [saving, startTransition] = useTransition();
  // Every one of these saves itself, the number when its box is left — said
  // beside them, as other self-saving controls do (`SaveState`).
  const saveStatus = useSaveStatus(saving);
  // Every control below is disabled on this, so the lock rides along with it.
  const pending = saving || locked;

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
      <div className="seg" role="radiogroup" aria-label="Who qualifies for the knockout">
        <label className="seg-opt">
          <input type="radio" name={`${gid}-mode`} checked={m === "perFlight"} disabled={pending || (flightCount === 1 && m !== "perFlight")} onChange={() => switchMode("perFlight")} />
          Per flight
        </label>
        <label className="seg-opt">
          <input type="radio" name={`${gid}-mode`} checked={m === "overall"} disabled={pending} onChange={() => switchMode("overall")} />
          Overall
        </label>
      </div>
      {m === "perFlight" ? (
        <div className="seg" role="radiogroup" aria-label="Players from each flight">
          {[1, 2, 3].map((n) => (
            <label className="seg-opt" key={n}>
              <input
                type="radio"
                name={`${gid}-pf`}
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
            onChange={(e) => setOv(figureOr(readWhole(e.target.value), 1) || 1)}
            onKeyDown={leaveOnEnter}
            onBlur={() => startTransition(() => setQualifyMode("overall", ov))}
          />
          <span className="text-muted">overall</span>
        </label>
      )}
      <SaveState status={saveStatus} />
      {/* Said on the page, as the stroke cut says it — not in a tooltip. */}
      {/* ONE flight, drawn. None yet is not one: flights are usually drawn
          after the rounds are set, and a club planning groups then a knockout
          needs Per flight while there are none. */}
      {flightCount === 1 && (
        <span className="text-muted" style={{ fontSize: 13, flexBasis: "100%", lineHeight: 1.5 }}>
          {m === "perFlight"
            ? `The field is in one flight, so this takes the top ${pf} of everybody${pf === 2 ? " — a final" : ""}. Choose Overall to set how many play the knockout.`
            : "The field is in one flight, so a per-flight cut would be the same cut."}
        </span>
      )}
    </div>
  );
}
