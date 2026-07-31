"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { CoursePreset } from "@/lib/courses";

export function ScorecardClient({ courses }: { courses: CoursePreset[] }) {
  const router = useRouter();
  const [courseName, setCourseName] = useState(courses[0]?.name ?? "");
  const course = courses.find((c) => c.name === courseName) ?? courses[0];
  const [city, setCity] = useState(course?.city ?? "");
  const [address, setAddress] = useState(course?.address ?? "");
  const [holes, setHoles] = useState<18 | 9>(18);
  const [nine, setNine] = useState<"front" | "back">("front");

  const applyPreset = (name: string) => {
    const c = courses.find((x) => x.name === name);
    setCourseName(name);
    if (c) {
      setCity(c.city);
      setAddress(c.address);
    }
  };

  const preview = useMemo(() => {
    if (!course) return { cells: [] as { num: number; par: number; yards: number }[], par: 0, yards: 0, label: "" };
    let idxs: number[];
    let label: string;
    if (holes === 18) {
      idxs = Array.from({ length: 18 }, (_, i) => i);
      label = "18 holes";
    } else if (nine === "front") {
      idxs = Array.from({ length: 9 }, (_, i) => i);
      label = "Front nine";
    } else {
      idxs = Array.from({ length: 9 }, (_, i) => i + 9);
      label = "Back nine";
    }
    const cells = idxs.map((i) => ({ num: i + 1, par: course.pars[i], yards: course.yards[i] }));
    return {
      cells,
      par: cells.reduce((s, c) => s + c.par, 0),
      yards: cells.reduce((s, c) => s + c.yards, 0),
      label,
    };
  }, [course, holes, nine]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16, alignItems: "start" }}>
      <div className="card elev-sm" style={{ gap: 14 }}>
        <div className="field">
          <label>Course</label>
          <select className="input" value={courseName} onChange={(e) => applyPreset(e.target.value)}>
            {courses.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="field"><label>City</label><input className="input" value={city} onChange={(e) => setCity(e.target.value)} /></div>
        <div className="field">
          <label>Address <span className="text-muted">· auto-populated</span></label>
          <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <div className="field">
          <label>Match length</label>
          <div className="seg">
            <label className="seg-opt"><input type="radio" name="hlen" checked={holes === 18} onChange={() => setHoles(18)} />18 holes</label>
            <label className="seg-opt"><input type="radio" name="hlen" checked={holes === 9} onChange={() => setHoles(9)} />9 holes</label>
          </div>
        </div>
        {holes === 9 && (
          <div className="field">
            <label>Nine</label>
            <div className="seg">
              <label className="seg-opt"><input type="radio" name="nine" checked={nine === "front"} onChange={() => setNine("front")} />Front nine</label>
              <label className="seg-opt"><input type="radio" name="nine" checked={nine === "back"} onChange={() => setNine("back")} />Back nine</label>
            </div>
          </div>
        )}
        <button type="button" className="btn btn-primary btn-block" onClick={() => router.push("/entry")}>
          <i className="ph ph-cards" /> Generate &amp; open score entry
        </button>
      </div>
      <div className="card elev-sm">
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontFamily: "var(--font-heading)", fontWeight: 500, fontSize: 17 }}>{course?.name}</div>
            <div className="text-muted" style={{ fontSize: 12 }}>{address}</div>
          </div>
          <span className="tag tag-outline">{preview.label}</span>
        </div>
        <div style={{ overflowX: "auto", marginTop: 12 }}>
          <table className="table" style={{ fontSize: 12, minWidth: 520 }}>
            <thead>
              <tr>
                <th>Hole</th>
                {preview.cells.map((h) => (
                  <th key={h.num} style={{ textAlign: "center" }}>{h.num}</th>
                ))}
                <th style={{ textAlign: "center" }}>Tot</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="text-muted">Par</td>
                {preview.cells.map((h) => (
                  <td key={h.num} style={{ textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{h.par}</td>
                ))}
                <td style={{ textAlign: "center", fontWeight: 600 }}>{preview.par}</td>
              </tr>
              <tr>
                <td className="text-muted">Yards</td>
                {preview.cells.map((h) => (
                  <td key={h.num} style={{ textAlign: "center", fontVariantNumeric: "tabular-nums", color: "var(--color-neutral-400)" }}>{h.yards}</td>
                ))}
                <td style={{ textAlign: "center", color: "var(--color-neutral-400)" }}>{preview.yards}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 500 }}>Result</td>
                {preview.cells.map((h) => (
                  <td key={h.num} style={{ textAlign: "center", color: "var(--color-neutral-600)" }}>·</td>
                ))}
                <td />
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
          Match-play scorecard — each hole is scored win / halve / loss during entry.
        </p>
      </div>
    </div>
  );
}
