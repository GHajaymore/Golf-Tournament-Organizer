"use client";
import { useState, useTransition } from "react";
import { saveEvent, applyManualCount } from "@/app/actions/tournament";

interface EventForm {
  name: string;
  dates: string;
  format: string;
  course: string;
  city: string;
  address: string;
  regDeadline: string;
  capacity: number;
  playerCountMode: string;
  manualPlayerCount: number;
}

export function EventSetupClient({ initial, playersCount }: { initial: EventForm; playersCount: number }) {
  const [f, setF] = useState<EventForm>(initial);
  const [manualTarget, setManualTarget] = useState(initial.manualPlayerCount);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  const set = <K extends keyof EventForm>(k: K, v: EventForm[K]) => setF((prev) => ({ ...prev, [k]: v }));

  const summary = [
    { k: "Format", v: f.format === "stroke" ? "Stroke play" : "Match play" },
    { k: "Capacity", v: `${f.capacity} players` },
    { k: "Confirmed", v: `${playersCount}` },
    { k: "Player count", v: f.playerCountMode === "manual" ? "Manual target" : "From registrations" },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16, alignItems: "start" }}>
      <div className="card elev-sm" style={{ gap: 14 }}>
        <div className="field"><label>Event name</label><input className="input" value={f.name} onChange={(e) => set("name", e.target.value)} /></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="field"><label>Dates</label><input className="input" value={f.dates} onChange={(e) => set("dates", e.target.value)} /></div>
          <div className="field">
            <label>Format</label>
            <div className="seg">
              <label className="seg-opt"><input type="radio" name="fmt" checked={f.format === "match"} onChange={() => set("format", "match")} />Match play</label>
              <label className="seg-opt"><input type="radio" name="fmt" checked={f.format === "stroke"} onChange={() => set("format", "stroke")} />Stroke play</label>
            </div>
          </div>
        </div>
        <div className="field"><label>Golf course</label><input className="input" value={f.course} onChange={(e) => set("course", e.target.value)} /></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
          <div className="field"><label>City</label><input className="input" value={f.city} onChange={(e) => set("city", e.target.value)} /></div>
          <div className="field"><label>Address</label><input className="input" value={f.address} onChange={(e) => set("address", e.target.value)} /></div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="field"><label>Registration deadline</label><input className="input" value={f.regDeadline} onChange={(e) => set("regDeadline", e.target.value)} /></div>
          <div className="field"><label>Field capacity</label><input className="input" type="number" value={f.capacity} onChange={(e) => set("capacity", parseInt(e.target.value, 10) || 0)} /></div>
        </div>
        <div className="field">
          <label>Player count</label>
          <div className="seg">
            <label className="seg-opt"><input type="radio" name="pcmode" checked={f.playerCountMode === "registration"} onChange={() => set("playerCountMode", "registration")} />From registrations</label>
            <label className="seg-opt"><input type="radio" name="pcmode" checked={f.playerCountMode === "manual"} onChange={() => set("playerCountMode", "manual")} />Manual</label>
          </div>
        </div>
        {f.playerCountMode === "manual" ? (
          <>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <div className="field" style={{ flex: 1 }}>
                <label>Target player count</label>
                <input className="input" type="number" value={manualTarget} onChange={(e) => setManualTarget(parseInt(e.target.value, 10) || 0)} />
              </div>
              <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => startTransition(() => applyManualCount(manualTarget))}>
                Apply
              </button>
            </div>
            <p className="text-muted" style={{ fontSize: 12, margin: "-6px 0 0" }}>
              Pads with waitlist/placeholder entries or trims the roster to this exact count, then regroups.
            </p>
          </>
        ) : (
          <p className="text-muted" style={{ fontSize: 12, margin: "-6px 0 0" }}>
            Player count tracks confirmed registrations live — currently {playersCount}.
          </p>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={pending}
            onClick={() => {
              startTransition(() =>
                saveEvent({
                  name: f.name, dates: f.dates, format: f.format, course: f.course, city: f.city,
                  address: f.address, regDeadline: f.regDeadline, capacity: f.capacity, playerCountMode: f.playerCountMode,
                }),
              );
              setSaved(true);
              setTimeout(() => setSaved(false), 1600);
            }}
          >
            <i className="ph ph-check" /> {saved ? "Saved" : "Save event"}
          </button>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="card elev-sm">
          <span className="card-kicker">Pilot summary</span>
          {summary.map((s) => (
            <div key={s.k} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "5px 0", borderBottom: "1px solid var(--color-divider)" }}>
              <span className="text-muted">{s.k}</span>
              <span style={{ fontWeight: 500 }}>{s.v}</span>
            </div>
          ))}
        </div>
        <div className="card elev-sm">
          <span className="card-title" style={{ fontSize: 15 }}>Recommended flow</span>
          <p className="card-body">
            Roster → Grouping → Stage builder → Scoring rules → run stages → Qualification → Brackets → Reports.
          </p>
        </div>
      </div>
    </div>
  );
}
