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

interface CourseOption {
  name: string;
  city: string;
  address: string;
}

export function EventSetupClient({
  initial,
  playersCount,
  courses,
}: {
  initial: EventForm;
  playersCount: number;
  courses: CourseOption[];
}) {
  const [f, setF] = useState<EventForm>(initial);
  const [manualTarget, setManualTarget] = useState(initial.manualPlayerCount);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  // Course selector: a preset name, "__other" (manual entry), or "" (none yet).
  const presetNames = new Set(courses.map((c) => c.name));
  const initialSelect = initial.course === "" ? "" : presetNames.has(initial.course) ? initial.course : "__other";
  const [courseSelect, setCourseSelect] = useState(initialSelect);
  const [zip, setZip] = useState("");
  const [zipMsg, setZipMsg] = useState("Enter a US zip to fill in the city/state.");

  const set = <K extends keyof EventForm>(k: K, v: EventForm[K]) => setF((prev) => ({ ...prev, [k]: v }));

  const onSelectCourse = (val: string) => {
    setCourseSelect(val);
    if (val === "") {
      setF((prev) => ({ ...prev, course: "", city: "", address: "" }));
    } else if (val === "__other") {
      setF((prev) => ({ ...prev, course: "" }));
    } else {
      const c = courses.find((x) => x.name === val);
      if (c) setF((prev) => ({ ...prev, course: c.name, city: c.city, address: c.address }));
    }
  };

  const lookupZip = async () => {
    const z = zip.trim();
    if (!/^\d{5}$/.test(z)) {
      if (z) setZipMsg("Enter a 5-digit US zip code.");
      return;
    }
    setZipMsg("Looking up…");
    try {
      const res = await fetch(`https://api.zippopotam.us/us/${z}`);
      if (!res.ok) {
        setZipMsg("Zip not found — enter the city/address manually.");
        return;
      }
      const data = (await res.json()) as {
        places?: Array<{ "place name": string; "state abbreviation": string }>;
      };
      const place = data.places?.[0];
      if (place) {
        const city = place["place name"];
        const state = place["state abbreviation"];
        setF((prev) => ({
          ...prev,
          city,
          address: prev.address.trim() ? prev.address : `${city}, ${state} ${z}`,
        }));
        setZipMsg(`Found ${city}, ${state}. Add the street address if needed.`);
      }
    } catch {
      setZipMsg("Lookup unavailable — enter the city/address manually.");
    }
  };

  const summary = [
    { k: "Format", v: f.format === "stroke" ? "Stroke play" : "Match play" },
    { k: "Course", v: f.course || "—" },
    { k: "Capacity", v: f.capacity > 0 ? `${f.capacity} players` : "Open / unlimited" },
    { k: "Confirmed", v: `${playersCount}` },
    { k: "Player count", v: f.playerCountMode === "manual" ? "Manual target" : "From registrations" },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16, alignItems: "start" }}>
      <div className="card elev-sm" style={{ gap: 12 }}>
        <span className="card-kicker">Tournament identity</span>
        <div className="field">
          <label>
            Tournament name{" "}
            {!f.name.trim() && <span style={{ color: "var(--color-accent-300)" }}>· required to launch</span>}
          </label>
          <input
            className="input"
            value={f.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Name your tournament"
            style={!f.name.trim() ? { borderColor: "var(--color-accent)" } : undefined}
          />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="field"><label>Dates</label><input className="input" value={f.dates} onChange={(e) => set("dates", e.target.value)} placeholder="e.g. May 14–16, 2026" /></div>
          <div className="field">
            <label>Format</label>
            <div className="seg">
              <label className="seg-opt"><input type="radio" name="fmt" checked={f.format === "match"} onChange={() => set("format", "match")} />Match play</label>
              <label className="seg-opt"><input type="radio" name="fmt" checked={f.format === "stroke"} onChange={() => set("format", "stroke")} />Stroke play</label>
            </div>
          </div>
        </div>

        <span className="card-kicker" style={{ marginTop: 8, borderTop: "1px solid var(--color-divider)", paddingTop: 12 }}>Venue</span>
        <div className="field">
          <label>Golf course</label>
          <select className="input" value={courseSelect} onChange={(e) => onSelectCourse(e.target.value)}>
            <option value="">— Select a course —</option>
            {courses.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
            <option value="__other">Other (enter manually)</option>
          </select>
        </div>

        {courseSelect === "__other" && (
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
            <div className="field">
              <label>Course name</label>
              <input className="input" value={f.course} onChange={(e) => set("course", e.target.value)} placeholder="e.g. Maketewah Country Club" />
            </div>
            <div className="field">
              <label>Zip code</label>
              <input
                className="input"
                value={zip}
                onChange={(e) => setZip(e.target.value)}
                onBlur={lookupZip}
                placeholder="45202"
                inputMode="numeric"
              />
            </div>
            <p className="text-muted" style={{ fontSize: 12, margin: "-6px 0 0", gridColumn: "1 / -1" }}>{zipMsg}</p>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
          <div className="field"><label>City</label><input className="input" value={f.city} onChange={(e) => set("city", e.target.value)} placeholder="City" /></div>
          <div className="field"><label>Address</label><input className="input" value={f.address} onChange={(e) => set("address", e.target.value)} placeholder="Street, city, state zip" /></div>
        </div>

        <span className="card-kicker" style={{ marginTop: 8, borderTop: "1px solid var(--color-divider)", paddingTop: 12 }}>Registration &amp; field</span>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="field"><label>Registration deadline</label><input className="input" value={f.regDeadline} onChange={(e) => set("regDeadline", e.target.value)} placeholder="e.g. May 7, 2026" /></div>
          <div className="field">
            <label>Field capacity</label>
            <div style={{ display: "flex", gap: 8 }}>
              <div className="seg">
                <label className="seg-opt"><input type="radio" name="capmode" checked={f.capacity > 0} onChange={() => set("capacity", f.capacity > 0 ? f.capacity : 32)} />Fixed</label>
                <label className="seg-opt"><input type="radio" name="capmode" checked={f.capacity <= 0} onChange={() => set("capacity", 0)} />Open</label>
              </div>
              {f.capacity > 0 && (
                <input className="input" type="number" value={f.capacity} onChange={(e) => set("capacity", parseInt(e.target.value, 10) || 0)} style={{ width: 90 }} />
              )}
            </div>
          </div>
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
          <span className="card-kicker">Summary</span>
          {summary.map((s) => (
            <div key={s.k} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "5px 0", borderBottom: "1px solid var(--color-divider)" }}>
              <span className="text-muted">{s.k}</span>
              <span style={{ fontWeight: 500 }}>{s.v}</span>
            </div>
          ))}
        </div>
        <div className="card elev-sm">
          <span className="card-title" style={{ fontSize: 15 }}>Recommended flow</span>
          <ol style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 13, lineHeight: 1.9, color: "var(--color-text)" }}>
            <li>Registration &amp; field → Flights</li>
            <li>Rounds &amp; format (Match Points, Qualification)</li>
            <li>Launch → setup locks</li>
            <li>Tee sheet → run rounds &amp; enter scores</li>
            <li>Bracket → Prizes &amp; Reports</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
