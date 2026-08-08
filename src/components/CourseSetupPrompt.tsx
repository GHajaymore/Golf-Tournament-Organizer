"use client";
import { useState, useTransition } from "react";
import { saveCustomCourse } from "@/app/actions/tournament";
import { parseCard } from "@/lib/domain/scorecard-parse";

const BLANK_18 = new Array(18).fill("");

/**
 * The course card editor — par, yardage and stroke index, hole by hole.
 *
 * Two framings, one form. On Score entry it appears as a blocker when the
 * scoring genuinely can't proceed without the data. On Event setup it is just
 * an available section: a tournament may not *need* course data to score
 * (gross match play doesn't) and still want it, because printed scorecards
 * carry the course name, par, yardage and stroke index alongside the club's
 * logo. Setting a course is always allowed; it is only sometimes required.
 */
export function CourseSetupPrompt({
  eventCourse,
  eventCity,
  isStaff,
  blocking = true,
}: {
  eventCourse: string;
  eventCity: string;
  isStaff: boolean;
  /** True on Score entry, where scoring is waiting on this. False on Event
   *  setup, where it's an optional detail the organizer may fill in. */
  blocking?: boolean;
}) {
  const [name, setName] = useState(eventCourse);
  const [city, setCity] = useState(eventCity);
  const [pasteText, setPasteText] = useState("");
  const [pasteProblems, setPasteProblems] = useState<string[]>([]);
  const [pars, setPars] = useState<string[]>(BLANK_18);
  const [yards, setYards] = useState<string[]>(BLANK_18);
  const [strokeIndex, setStrokeIndex] = useState<string[]>(BLANK_18);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  /**
   * Fill the card from three rows pasted off the club's website.
   *
   * This replaced a preset dropdown of invented courses. Those were removed
   * for being fiction that scored real tournaments, which left this screen
   * offering a menu with nothing in it and 54 boxes to type by hand — the
   * reason score entry became unreachable for any event without a course.
   */
  const applyPaste = (text: string) => {
    const rows = text.split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
    if (rows.length < 2) return;
    const card = parseCard({ pars: rows[0], strokeIndex: rows[1], yards: rows[2] ?? "" });
    if (card.pars.length) setPars(card.pars.map(String));
    if (card.strokeIndex.length) setStrokeIndex(card.strokeIndex.map(String));
    if (card.yards.length) setYards(card.yards.map(String));
    setPasteProblems(card.problems.map((pr) => pr.message));
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

  const paste = (
    <div className="field" style={{ flexBasis: "100%" }}>
      <label>
        Paste the card <span className="text-muted">— par, stroke index, then yardage; one row each</span>
      </label>
      <textarea
        className="input"
        rows={3}
        value={pasteText}
        onChange={(e) => {
          setPasteText(e.target.value);
          applyPaste(e.target.value);
        }}
        placeholder={"4 5 3 4 4 4 3 4 5 36 4 4 3 4 5 4 3 4 4 35 71\n7 3 11 1 15 5 17 9 13 8 4 12 2 16 6 18 10 14"}
        style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 12.5, minHeight: 66 }}
      />
      <p className="text-muted" style={{ fontSize: 11.5, margin: "4px 0 0", lineHeight: 1.45 }}>
        Copy the rows straight off the club&rsquo;s website — totals and labels are stripped automatically, and
        the boxes below fill in as you paste.
      </p>
      {pasteProblems.map((m, i) => (
        <p key={i} style={{ fontSize: 11.5, margin: "3px 0 0", color: "var(--color-danger)" }}>
          <i className="ph ph-warning-circle" /> {m}
        </p>
      ))}
    </div>
  );

  return (
    <div className="card elev-sm">
      <span className="card-title">{blocking ? "Set up this course" : "Course card"}</span>
      <p className="text-muted" style={{ fontSize: 13, margin: "4px 0 14px" }}>
        {blocking ? (
          <>
            {"“"}{eventCourse || "This event"}{"”"} isn&rsquo;t one of the built-in courses, so there&rsquo;s no real par,
            yardage, or handicap data for it yet — scoring (net, Stableford, tiebreakers) needs that before you can
            enter results. Paste the card off the club&rsquo;s website, or fill it in by hand below.
          </>
        ) : (
          <>
            Par, yardage and stroke index for {"“"}{eventCourse || "this event"}{"”"}. Gross match play doesn&rsquo;t
            need this to score, but printed scorecards do — they carry the course details alongside your club&rsquo;s
            logo. Paste the card off the club&rsquo;s website, or fill it in by hand.
          </>
        )}
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
        {paste}
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
