"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { CoursePreset } from "@/lib/courses";

export interface CardFlight {
  label: string;
  players: Array<{ name: string; handicap: number }>;
}

export function ScorecardClient({
  courses,
  flights,
  eventName,
  eventDates,
  defaultCourse,
  isStroke,
}: {
  courses: CoursePreset[];
  flights: CardFlight[];
  eventName: string;
  eventDates: string;
  defaultCourse: string;
  isStroke: boolean;
}) {
  const [courseName, setCourseName] = useState(
    courses.find((c) => c.name === defaultCourse)?.name ?? courses[0]?.name ?? "",
  );
  const course = courses.find((c) => c.name === courseName) ?? courses[0];
  const [holes, setHoles] = useState<18 | 9>(18);
  const [nine, setNine] = useState<"front" | "back">("front");
  const [scope, setScope] = useState<"flight" | "field">("flight");

  const holeCells = useMemo(() => {
    if (!course) return [] as { num: number; par: number; yards: number }[];
    let idxs: number[];
    if (holes === 18) idxs = Array.from({ length: 18 }, (_, i) => i);
    else if (nine === "front") idxs = Array.from({ length: 9 }, (_, i) => i);
    else idxs = Array.from({ length: 9 }, (_, i) => i + 9);
    return idxs.map((i) => ({ num: i + 1, par: course.pars[i], yards: course.yards[i] }));
  }, [course, holes, nine]);

  const totalPar = holeCells.reduce((s, c) => s + c.par, 0);
  const lengthLabel = holes === 18 ? "18 holes" : nine === "front" ? "Front nine" : "Back nine";

  // One card per flight, or a single card for the whole field.
  const cards: CardFlight[] =
    scope === "field"
      ? [{ label: "Full field", players: flights.flatMap((f) => f.players) }]
      : flights;

  const scoreLabel = isStroke ? "Strokes" : "Result";

  return (
    <>
      <div className="card elev-sm no-print" style={{ marginBottom: 16, gap: 14 }}>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="field" style={{ width: 240 }}>
            <label>Course</label>
            <select className="input" value={courseName} onChange={(e) => setCourseName(e.target.value)}>
              {courses.map((c) => (
                <option key={c.name} value={c.name}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ width: 200 }}>
            <label>Length</label>
            <div className="seg" style={{ width: "100%" }}>
              <label className="seg-opt" style={{ flex: 1, justifyContent: "center" }}>
                <input type="radio" name="hlen" checked={holes === 18} onChange={() => setHoles(18)} />18
              </label>
              <label className="seg-opt" style={{ flex: 1, justifyContent: "center" }}>
                <input type="radio" name="hlen" checked={holes === 9} onChange={() => setHoles(9)} />9
              </label>
            </div>
          </div>
          {holes === 9 && (
            <div className="field" style={{ width: 200 }}>
              <label>Nine</label>
              <div className="seg" style={{ width: "100%" }}>
                <label className="seg-opt" style={{ flex: 1, justifyContent: "center" }}>
                  <input type="radio" name="nine" checked={nine === "front"} onChange={() => setNine("front")} />Front
                </label>
                <label className="seg-opt" style={{ flex: 1, justifyContent: "center" }}>
                  <input type="radio" name="nine" checked={nine === "back"} onChange={() => setNine("back")} />Back
                </label>
              </div>
            </div>
          )}
          <div className="field" style={{ width: 220 }}>
            <label>One card per</label>
            <div className="seg" style={{ width: "100%" }}>
              <label className="seg-opt" style={{ flex: 1, justifyContent: "center" }}>
                <input type="radio" name="scope" checked={scope === "flight"} onChange={() => setScope("flight")} />Flight
              </label>
              <label className="seg-opt" style={{ flex: 1, justifyContent: "center" }}>
                <input type="radio" name="scope" checked={scope === "field"} onChange={() => setScope("field")} />Field
              </label>
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <button type="button" className="btn btn-primary" onClick={() => window.print()}>
            <i className="ph ph-printer" /> Print {cards.length} card{cards.length === 1 ? "" : "s"}
          </button>
        </div>
        <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
          {isStroke ? "Stroke-play" : "Match-play"} scorecards for the current field on {course?.name}. Each card
          prints on its own page.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {cards.map((card) => (
          <div key={card.label} className="card elev-sm print-card">
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <div>
                <div style={{ fontFamily: "var(--font-heading)", fontWeight: 500, fontSize: 17 }}>
                  {eventName} — {card.label}
                </div>
                <div className="text-muted" style={{ fontSize: 12 }}>
                  {course?.name}{eventDates ? ` · ${eventDates}` : ""}
                </div>
              </div>
              <span className="tag tag-outline">{lengthLabel} · par {totalPar}</span>
            </div>
            <div style={{ overflowX: "auto", marginTop: 12 }}>
              <table className="table" style={{ fontSize: 12, minWidth: 560 }}>
                <thead>
                  <tr>
                    <th style={{ minWidth: 130 }}>Hole</th>
                    {holeCells.map((h) => (
                      <th key={h.num} style={{ textAlign: "center" }}>{h.num}</th>
                    ))}
                    <th style={{ textAlign: "center" }}>Tot</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="text-muted">Par</td>
                    {holeCells.map((h) => (
                      <td key={h.num} style={{ textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{h.par}</td>
                    ))}
                    <td style={{ textAlign: "center", fontWeight: 600 }}>{totalPar}</td>
                  </tr>
                  <tr>
                    <td className="text-muted">Yards</td>
                    {holeCells.map((h) => (
                      <td key={h.num} style={{ textAlign: "center", color: "var(--color-neutral-400)" }}>{h.yards}</td>
                    ))}
                    <td style={{ textAlign: "center", color: "var(--color-neutral-400)" }}>
                      {holeCells.reduce((s, c) => s + c.yards, 0)}
                    </td>
                  </tr>
                  {card.players.map((p) => (
                    <tr key={p.name}>
                      <td style={{ fontWeight: 500 }}>
                        {p.name} <span className="text-muted" style={{ fontSize: 11 }}>(hcp {p.handicap})</span>
                      </td>
                      {holeCells.map((h) => (
                        <td key={h.num} style={{ textAlign: "center", color: "var(--color-neutral-600)" }}>·</td>
                      ))}
                      <td />
                    </tr>
                  ))}
                  {card.players.length === 0 && (
                    <tr>
                      <td colSpan={holeCells.length + 2} className="text-muted" style={{ padding: 10 }}>
                        No players in this flight yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
              {scoreLabel} column filled during play; enter results in Score entry.
            </p>
          </div>
        ))}
        {cards.length === 0 && (
          <div className="card elev-sm">
            <span className="text-muted" style={{ fontSize: 13 }}>
              No flights yet — <Link href="/grouping">generate flights</Link> first, then print scorecards.
            </span>
          </div>
        )}
      </div>
    </>
  );
}
