"use client";
import { useState, useTransition } from "react";
import { saveEvent, applyManualCount } from "@/app/actions/tournament";
import { SIDE_STYLE_OPTIONS } from "@/lib/side-style";
import { parseDeadlineIso, formatDeadline } from "@/lib/deadline";
import FieldInfo from "@/components/FieldInfo";

interface EventForm {
  name: string;
  dates: string;
  format: string;
  course: string;
  courseMode: string;
  city: string;
  address: string;
  regDeadline: string;
  capacity: number;
  playerCountMode: string;
  manualPlayerCount: number;
  /** Routing only — see src/lib/side-style.ts. Never read while scoring. */
  sideStyle: string;
}

interface CourseOption {
  name: string;
  city: string;
  address: string;
}

const fmtDate = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

/** "May 14–16, 2026" (same month), "May 30 – Jun 2, 2026" (crosses month), "Dec 30, 2026 – Jan 2, 2027" (crosses year). */
const fmtRange = (startIso: string, endIso: string): string => {
  const start = new Date(`${startIso}T00:00:00`);
  const end = new Date(`${endIso}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "";
  if (startIso === endIso) return fmtDate(startIso);
  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();
  if (sameMonth) {
    const month = start.toLocaleDateString("en-US", { month: "short" });
    return `${month} ${start.getDate()}–${end.getDate()}, ${end.getFullYear()}`;
  }
  if (sameYear) {
    const startPart = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const endPart = end.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return `${startPart} – ${endPart}, ${end.getFullYear()}`;
  }
  return `${fmtDate(startIso)} – ${fmtDate(endIso)}`;
};

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
  /** Scored matches a resize would destroy, once the action refuses. */
  const [resizeScored, setResizeScored] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  // The button reflects real dirty state against the last-saved snapshot,
  // not a timed flash — it only reads "Save event" when something has
  // actually changed since the last save (or since load).
  const [savedSnapshot, setSavedSnapshot] = useState<EventForm>(initial);
  const isDirty = JSON.stringify(f) !== JSON.stringify(savedSnapshot);

  // Course selector: a preset name, "__other" (manual entry), "__open" (no
  // fixed course), or "" (none yet). The open mode is checked first because
  // it is the one case with no course name to recognise — reading the name
  // alone would show it as "no course selected yet" and quietly lose it.
  const presetNames = new Set(courses.map((c) => c.name));
  const initialSelect =
    initial.courseMode === "open"
      ? "__open"
      : initial.course === ""
        ? ""
        : presetNames.has(initial.course)
          ? initial.course
          : "__other";
  const [courseSelect, setCourseSelect] = useState(initialSelect);
  const [zip, setZip] = useState("");
  const [zipMsg, setZipMsg] = useState("Enter a US zip to fill in the city/state.");

  const set = <K extends keyof EventForm>(k: K, v: EventForm[K]) => setF((prev) => ({ ...prev, [k]: v }));

  // The calendar picker writes ISO here and derives the display string stored
  // in f.dates — an existing free-text value stays untouched until the
  // organizer actually sets a date, since "Spring meeting, first week" can't be
  // reverse-parsed and nothing depends on it being a date.
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  // The deadline is the exception: it is stored as the ISO date it is, so the
  // picker can be filled from it and — the reason any of this matters —
  // deadlinePassed can read it. Legacy free text parses to "" and leaves the
  // picker empty, exactly as before.
  const [deadlineDate, setDeadlineDate] = useState(() => parseDeadlineIso(initial.regDeadline));

  const onStartDate = (v: string) => {
    setStartDate(v);
    const end = endDate || v;
    if (!endDate) setEndDate(v);
    if (v) set("dates", fmtRange(v, end));
  };
  const onEndDate = (v: string) => {
    setEndDate(v);
    const start = startDate || v;
    if (!startDate) setStartDate(v);
    if (v) set("dates", fmtRange(start, v));
  };
  const onDeadlineDate = (v: string) => {
    setDeadlineDate(v);
    // Stored as ISO, NOT as the display string. Running the picker's value
    // through fmtDate here is the whole of D1: `deadlinePassed` requires ISO
    // and returns false for anything else, so every deadline set on this
    // screen was decorative — the public form stayed open indefinitely while
    // printing the date it was ignoring. The screen formats for display below;
    // the column keeps the date.
    if (v) set("regDeadline", v);
  };

  const onSelectCourse = (val: string) => {
    setCourseSelect(val);
    if (val === "") {
      setF((prev) => ({ ...prev, course: "", city: "", address: "", courseMode: "fixed" }));
    } else if (val === "__open") {
      // Deliberately clears the venue: an open tournament has no course until
      // a card is entered, and leaving a stale name here would score every
      // match against a venue nobody played.
      setF((prev) => ({ ...prev, course: "", city: "", address: "", courseMode: "open" }));
    } else if (val === "__other") {
      setF((prev) => ({ ...prev, course: "", courseMode: "fixed" }));
    } else {
      const c = courses.find((x) => x.name === val);
      if (c) setF((prev) => ({ ...prev, course: c.name, city: c.city, address: c.address, courseMode: "fixed" }));
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

  const [locating, setLocating] = useState(false);
  const useMyLocation = () => {
    if (!("geolocation" in navigator)) {
      setZipMsg("Location isn't available in this browser — enter a zip instead.");
      return;
    }
    setLocating(true);
    setZipMsg("Finding your location…");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const res = await fetch(
            `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`,
          );
          const data = (await res.json()) as { city?: string; locality?: string; principalSubdivisionCode?: string; postcode?: string };
          const city = data.city || data.locality || "";
          const state = (data.principalSubdivisionCode || "").split("-").pop() || "";
          if (city) {
            setF((prev) => ({
              ...prev,
              city,
              address: prev.address.trim() ? prev.address : `${city}, ${state}`.trim(),
            }));
            setZipMsg(`Found ${city}${state ? `, ${state}` : ""}. Add the street address if needed.`);
            if (data.postcode) setZip(data.postcode);
          } else {
            setZipMsg("Couldn't determine your city — enter it manually.");
          }
        } catch {
          setZipMsg("Location lookup failed — enter the city/address manually.");
        } finally {
          setLocating(false);
        }
      },
      () => {
        setZipMsg("Location access denied — enter a zip instead.");
        setLocating(false);
      },
      { timeout: 8000 },
    );
  };

  const summary = [
    { k: "Format", v: f.format === "stroke" ? "Stroke play" : "Match play" },
    { k: "Course", v: f.courseMode === "open" ? "Players choose" : f.course || "—" },
    { k: "Capacity", v: f.capacity > 0 ? `${f.capacity} players` : "Open / unlimited" },
    { k: "Confirmed", v: `${playersCount}` },
    { k: "Player count", v: f.playerCountMode === "manual" ? "Manual target" : "From registrations" },
  ];

  return (
    <div className="page-split" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
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
        <div className="pair-grid">
          <div className="field">
            <label>Tournament dates</label>
            {/* `minWidth: 0` on the inputs, not just `flex: 1`.
                A native date input's intrinsic minimum is its own chrome — the
                spinners and separators the browser draws — and a flex item
                will not shrink below that unless it is told it may. Two of
                them plus a dash could not fit a 320px screen, so the row ran
                off the edge even after the field above it learned to stack. */}
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input className="input" type="date" value={startDate} onChange={(e) => onStartDate(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
              <span className="text-muted">–</span>
              <input className="input" type="date" value={endDate} min={startDate || undefined} onChange={(e) => onEndDate(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
            </div>
            {f.dates && <p className="text-muted" style={{ fontSize: 12, margin: "4px 0 0" }}>{f.dates}</p>}
          </div>
          <div className="field">
            {/* "Scoring", not "Format". It used to say Format, and every round
                ALSO has a format — Four-Ball, Foursomes, Scramble. An organizer
                who answered this one reasonably believed they had answered the
                format question and never went looking for the other, which is
                where team golf actually lives. */}
            <label>
              Scoring
              <FieldInfo label="scoring">
                <p>
                  How a result is decided: <b>match play</b> counts holes won, <b>stroke play</b>
                  {" "}counts strokes.
                </p>
                <p>
                  Separate from what each round <i>plays</i> — four-ball, foursomes, a scramble.
                  That is set per round on Rounds &amp; formats, because it can differ from one
                  round to the next.
                </p>
              </FieldInfo>
            </label>
            <div className="seg">
              <label className="seg-opt"><input type="radio" name="fmt" checked={f.format === "match"} onChange={() => set("format", "match")} />Match play</label>
              <label className="seg-opt"><input type="radio" name="fmt" checked={f.format === "stroke"} onChange={() => set("format", "stroke")} />Stroke play</label>
            </div>
          </div>
        </div>

        {/* The question nothing used to ask. Answering it decides which format
            new rounds start on and puts Teams & pairs in the sidebar — it locks
            nothing, and every round can still be set to anything. */}
        <div className="field" style={{ marginTop: 4 }}>
          <label>
            How do people play?
            <FieldInfo label="how people play">
              <p>
                A starting point, not a rule. It picks what a new round opens on and brings up the
                Teams &amp; pairs screen — every round can still be set to anything you like.
              </p>
              <p>
                Team golf lives on the round, not the tournament, because it genuinely changes: a
                member-guest plays four-ball on Saturday and foursomes on Sunday.
              </p>
            </FieldInfo>
          </label>
          <div style={{ display: "grid", gap: 6 }}>
            {SIDE_STYLE_OPTIONS.map((o) => (
              <label
                key={o.key}
                className="seg-opt"
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 9,
                  padding: "9px 11px",
                  borderRadius: 9,
                  cursor: "pointer",
                  textAlign: "left",
                  border: "1px solid var(--color-divider)",
                  background:
                    f.sideStyle === o.key
                      ? "color-mix(in srgb, var(--color-accent) 12%, transparent)"
                      : "transparent",
                  borderColor:
                    f.sideStyle === o.key
                      ? "color-mix(in srgb, var(--color-accent) 45%, transparent)"
                      : "var(--color-divider)",
                }}
              >
                <input
                  type="radio"
                  name="sideStyle"
                  checked={f.sideStyle === o.key}
                  onChange={() => set("sideStyle", o.key)}
                  style={{ marginTop: 3, flex: "none" }}
                />
                <span style={{ minWidth: 0 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, display: "block" }}>{o.label}</span>
                  <span className="text-muted" style={{ fontSize: 12, lineHeight: 1.55 }}>{o.blurb}</span>
                </span>
              </label>
            ))}
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
            <option value="__open">No fixed course — players choose</option>
          </select>
          {courseSelect === "__open" && (
            <p className="text-muted" style={{ fontSize: 12, margin: "6px 0 0", lineHeight: 1.5 }}>
              For a league or society where each pairing arranges its own venue.
              Nothing is set here; whoever enters a card names the course they
              played, and it is saved to the club&rsquo;s list for next time.
            </p>
          )}
        </div>

        {courseSelect === "__other" && (
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
            <div className="field">
              <label>Course name</label>
              <input className="input" value={f.course} onChange={(e) => set("course", e.target.value)} placeholder="e.g. Maketewah Country Club" />
            </div>
            <div className="field">
              <label>Zip code</label>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  className="input"
                  value={zip}
                  onChange={(e) => setZip(e.target.value)}
                  onBlur={lookupZip}
                  placeholder="45202"
                  inputMode="numeric"
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-icon"
                  disabled={locating}
                  onClick={useMyLocation}
                  title="Use my current location"
                >
                  <i className={locating ? "ph ph-spinner-gap" : "ph ph-navigation-arrow"} />
                </button>
              </div>
            </div>
            <p className="text-muted" style={{ fontSize: 12, margin: "-6px 0 0", gridColumn: "1 / -1" }}>{zipMsg}</p>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
          <div className="field"><label>City</label><input className="input" value={f.city} onChange={(e) => set("city", e.target.value)} placeholder="City" /></div>
          <div className="field"><label>Address</label><input className="input" value={f.address} onChange={(e) => set("address", e.target.value)} placeholder="Street, city, state zip" /></div>
        </div>

        <span className="card-kicker" style={{ marginTop: 8, borderTop: "1px solid var(--color-divider)", paddingTop: 12 }}>Registration &amp; field</span>
        <div className="pair-grid">
          <div className="field">
            <label>Registration deadline</label>
            <input className="input" type="date" value={deadlineDate} max={startDate || undefined} onChange={(e) => onDeadlineDate(e.target.value)} />
            {f.regDeadline && (
              <p className="text-muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
                {formatDeadline(f.regDeadline)}
              </p>
            )}
          </div>
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
              <button
                type="button"
                className="btn btn-secondary"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const res = await applyManualCount(manualTarget);
                    if (res.needsConfirm) setResizeScored(res.scoredMatches ?? 0);
                  })
                }
              >
                Apply
              </button>
            </div>
            {resizeScored !== null && (
              <div
                style={{
                  padding: "12px 14px",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--color-danger)",
                  background: "color-mix(in srgb, var(--color-danger) 10%, transparent)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <div style={{ fontSize: 13 }}>
                  <b>
                    <i className="ph ph-warning" /> This will delete {resizeScored} scored match
                    {resizeScored === 1 ? "" : "es"}.
                  </b>
                  <div className="text-muted" style={{ marginTop: 4 }}>
                    Resizing the field rebuilds the round-robin schedule, discarding results already entered.
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        await applyManualCount(manualTarget, true);
                        setResizeScored(null);
                      })
                    }
                  >
                    Delete and resize
                  </button>
                  <button type="button" className="btn" disabled={pending} onClick={() => setResizeScored(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
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
            disabled={pending || !isDirty}
            onClick={() => {
              startTransition(() =>
                saveEvent({
                  name: f.name, dates: f.dates, format: f.format, course: f.course, city: f.city,
                  address: f.address, regDeadline: f.regDeadline, capacity: f.capacity, playerCountMode: f.playerCountMode,
                  courseMode: f.courseMode, sideStyle: f.sideStyle,
                }),
              );
              setSavedSnapshot(f);
            }}
          >
            <i className="ph ph-check" /> {isDirty ? "Save event" : "Saved"}
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
