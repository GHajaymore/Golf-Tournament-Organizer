"use client";
import { useState, useTransition } from "react";
import { setStageCut, setStageCutScope } from "@/app/actions/tournament";
import { cutAdvancesEveryone } from "@/lib/domain/cut";

export function CutControl({
  formId,
  getStageId,
  roundLabel,
  enabled,
  mode,
  count,
  percent,
  scope,
  confirmedCount,
  flightCount = 1,
}: {
  /** Stable id for radio/name grouping — doesn't need to be a real stage id yet. */
  formId: string;
  /** Resolves the stage to write to, creating it first if it doesn't exist yet. */
  getStageId: () => Promise<string>;
  /** e.g. "Round 2" once it exists, or "the next round" before it's created. */
  roundLabel: string;
  enabled: boolean;
  mode: string;
  count: number;
  percent: number;
  /** overall = one cut across the field; perFlight = the same cut inside each
   *  flight, which is how a flighted club event actually runs. */
  scope: string;
  confirmedCount: number;
  /** How many flights the field is divided into — decides what "top N" means. */
  flightCount?: number;
}) {
  const [on, setOn] = useState(enabled);
  const [m, setM] = useState(mode === "percent" ? "percent" : "count");
  const [n, setN] = useState(count);
  const [pct, setPct] = useState(percent);
  const [sc, setSc] = useState(scope === "perFlight" ? "perFlight" : "overall");
  const [pending, startTransition] = useTransition();

  const commitScope = (next: string) => {
    setSc(next);
    startTransition(async () => {
      const stageId = await getStageId();
      await setStageCutScope(stageId, next);
    });
  };

  const commit = (nextOn: boolean, nextMode: string, nextN: number, nextPct: number) => {
    setOn(nextOn);
    setM(nextMode);
    setN(nextN);
    setPct(nextPct);
    startTransition(async () => {
      const stageId = await getStageId();
      await setStageCut(stageId, nextOn, nextMode, nextN, nextPct);
    });
  };

  // Per flight, the cut is applied inside each flight — so "top 4" across
  // eight flights advances thirty-two players, not four. Showing the overall
  // number here would understate the next round's field by a factor of the
  // flight count.
  const flights = Math.max(1, flightCount);
  const perFlight = sc === "perFlight";
  const fieldPerBucket = perFlight ? Math.ceil(confirmedCount / flights) : confirmedCount;
  const bucketSurvivors =
    m === "percent"
      ? Math.max(1, Math.ceil((fieldPerBucket * pct) / 100))
      : Math.max(1, Math.min(n, fieldPerBucket || n));
  const survivors = perFlight
    ? Math.min(confirmedCount || bucketSurvivors * flights, bucketSurvivors * flights)
    : bucketSurvivors;

  // A cut whose number is as large as the field it filters passes everyone —
  // the organizer sees "16 of 16 advance" and has drawn a cut line that cuts
  // nobody. The default count is a fixed 16, so this is easy to hit on a small
  // field without noticing. For a per-flight cut the relevant size is the
  // largest flight, which an even split makes `fieldPerBucket`.
  const noOp =
    on &&
    cutAdvancesEveryone(
      { scope: perFlight ? "perFlight" : "overall", mode: m === "percent" ? "percent" : "count", count: n, percent: pct },
      confirmedCount,
      perFlight ? [fieldPerBucket] : undefined,
    );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
        <input type="checkbox" checked={on} disabled={pending} onChange={(e) => commit(e.target.checked, m, n, pct)} />
        Cut the field for {roundLabel}
      </label>
      {on && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div className="seg">
            <label className="seg-opt">
              <input
                type="radio"
                name={`cutmode-${formId}`}
                checked={m === "count"}
                disabled={pending}
                onChange={() => commit(on, "count", n, pct)}
              />
              Top N
            </label>
            <label className="seg-opt">
              <input
                type="radio"
                name={`cutmode-${formId}`}
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
          <div className="seg">
            <label className="seg-opt">
              <input
                type="radio"
                name={`cutscope-${formId}`}
                checked={!perFlight}
                disabled={pending}
                onChange={() => commitScope("overall")}
              />
              Overall
            </label>
            <label className="seg-opt" title={flights < 2 ? "Only one flight — same as overall." : undefined}>
              <input
                type="radio"
                name={`cutscope-${formId}`}
                checked={perFlight}
                disabled={pending || flights < 2}
                onChange={() => commitScope("perFlight")}
              />
              Per flight
            </label>
          </div>
          <span className="text-muted" style={{ fontSize: 12 }}>
            {perFlight
              ? `${bucketSurvivors} from each of ${flights} flights — ${survivors} of ${confirmedCount} advance into ${roundLabel}.`
              : `${survivors} of ${confirmedCount} advance into ${roundLabel}.`}
          </span>
        </div>
      )}
      {noOp && (
        // The cut is on but advances the whole field, so it does nothing. Said
        // plainly here rather than left for the organizer to infer from an
        // "N of N advance" line that reads like a working cut.
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 6,
            fontSize: 12,
            padding: "8px 10px",
            borderRadius: 8,
            background: "color-mix(in srgb, var(--color-accent) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--color-accent) 35%, transparent)",
          }}
        >
          <i className="ph ph-warning" style={{ marginTop: 1 }} />
          <span>
            This cut advances the whole {perFlight ? "flight" : "field"} — everyone gets through, so{" "}
            {roundLabel} plays the same field with or without it. Lower the {m === "percent" ? "percentage" : "number"} to
            cut anyone.
          </span>
        </div>
      )}
    </div>
  );
}
