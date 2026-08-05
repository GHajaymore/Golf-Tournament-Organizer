"use client";
import { useState, useTransition } from "react";
import { saveCustomCourse } from "@/app/actions/tournament";
import { COURSES } from "@/lib/courses";

const BLANK_18 = new Array(18).fill("");

export function CourseSetupPrompt({
  eventCourse,
  eventCity,
  isStaff,
}: {
  eventCourse: string;
  eventCity: string;
  isStaff: boolean;
}) {
  const [name, setName] = useState(eventCourse);
  const [city, setCity] = useState(eventCity);
  const [pars, setPars] = useState<string[]>(BLANK_18);
  const [yards, setYards] = useState<string[]>(BLANK_18);
  const [strokeIndex, setStrokeIndex] = useState<string[]>(BLANK_18);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const applyPreset = (presetName: string) => {
    const preset = COURSES.find((c) => c.name === presetName);
    if (!preset) return;
    setName(preset.name);
    setCity(preset.city);
    setPars(preset.pars.map(String));
    setYards(preset.yards.map(String));
    setStrokeIndex(preset.strokeIndex.map(String));
  };

  const setCell = (arr: string[], setArr: (v: string[]) => void, i: number, v: string) => {
    const next = [...arr];
    next[i] = v;
    setArr(next);
  };

  const save = () => {
    setError("");
    if (!name.trim()) return setError("Enter the course name.");
    const parNums = pars.map((v) => parseInt(v, 10));
    const yardNums = yards.map((v) => parseInt(v, 10));
    const siNums = strokeIndex.map((v) => parseInt(v, 10));
    if (parNums.some((n) => !Number.isFinite(n) || n < 3 || n > 6)) return setError("Every hole needs a par between 3 and 6.");
    if (yardNums.some((n) => !Number.isFinite(n) || n <= 0)) return setError("Every hole needs a yardage.");
    const siSet = new Set(siNums);
    if (siNums.some((n) => !Number.isFinite(n) || n < 1 || n > 18) || siSet.size !== 18) {
      return setError("Stroke index must use each number 1–18 exactly once.");
    }
    startTransition(() => void saveCustomCourse(name.trim(), city.trim(), parNums, yardNums, siNums));
  };

  if (!isStaff) {
    return (
      <div className="card elev-sm">
        <span className="card-title">Course not set up yet</span>
        <p className="text-muted" style={{ fontSize: 13 }}>
          An organizer needs to add this course's hole-by-hole details (par, yardage, handicap index) before scores can be entered.
        </p>
      </div>
    );
  }

  return (
    <div className="card elev-sm">
      <span className="card-title">Set up this course</span>
      <p className="text-muted" style={{ fontSize: 13, margin: "4px 0 14px" }}>
        {"“"}{eventCourse || "This event"}{"”"} isn't one of the built-in courses, so there's no real par, yardage, or handicap
        data for it yet — scoring (net, Stableford, tiebreakers) needs that before you can enter results.
        Fill in the card below, or start from a preset and adjust it.
      </p>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div className="field" style={{ minWidth: 220, flex: 1 }}>
          <label>Course name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pinehurst No. 2" />
        </div>
        <div className="field" style={{ minWidth: 180, flex: 1 }}>
          <label>City</label>
          <input className="input" value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Pinehurst, NC" />
        </div>
        <div className="field" style={{ minWidth: 200 }}>
          <label>Start from a preset</label>
          <select className="input" defaultValue="" onChange={(e) => e.target.value && applyPreset(e.target.value)}>
            <option value="">Blank card</option>
            {COURSES.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table className="table" style={{ fontSize: 11, minWidth: 920 }}>
          <thead>
            <tr>
              <th>Hole</th>
              {Array.from({ length: 18 }, (_, i) => (
                <th key={i} style={{ textAlign: "center" }}>{i + 1}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="text-muted">Par</td>
              {pars.map((v, i) => (
                <td key={i} style={{ padding: 2 }}>
                  <input
                    className="input"
                    inputMode="numeric"
                    value={v}
                    onChange={(e) => setCell(pars, setPars, i, e.target.value)}
                    style={{ width: 30, textAlign: "center", padding: "4px 2px", minHeight: 30 }}
                  />
                </td>
              ))}
            </tr>
            <tr>
              <td className="text-muted">Yards</td>
              {yards.map((v, i) => (
                <td key={i} style={{ padding: 2 }}>
                  <input
                    className="input"
                    inputMode="numeric"
                    value={v}
                    onChange={(e) => setCell(yards, setYards, i, e.target.value)}
                    style={{ width: 40, textAlign: "center", padding: "4px 2px", minHeight: 30 }}
                  />
                </td>
              ))}
            </tr>
            <tr>
              <td className="text-muted">S.I.</td>
              {strokeIndex.map((v, i) => (
                <td key={i} style={{ padding: 2 }}>
                  <input
                    className="input"
                    inputMode="numeric"
                    value={v}
                    onChange={(e) => setCell(strokeIndex, setStrokeIndex, i, e.target.value)}
                    style={{ width: 30, textAlign: "center", padding: "4px 2px", minHeight: 30 }}
                  />
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {error && (
        <p style={{ fontSize: 13, margin: "10px 0 0", color: "var(--color-danger, #e0665a)" }}>
          <i className="ph ph-warning-circle" /> {error}
        </p>
      )}
      <button type="button" className="btn btn-primary" disabled={pending} onClick={save} style={{ marginTop: 14 }}>
        <i className="ph ph-check" /> {pending ? "Saving…" : "Save course & start scoring"}
      </button>
    </div>
  );
}
