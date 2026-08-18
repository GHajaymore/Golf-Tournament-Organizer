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
  saved = [],
}: {
  eventCourse: string;
  eventCity: string;
  isStaff: boolean;
  /** Courses the club has already saved. Picking one is the fast path, and
   *  this screen used to ignore them entirely — asking an organizer to paste
   *  a card the app was already holding. */
  saved?: Array<{ id: string; name: string; city: string; pars: number[]; yards: number[]; strokeIndex: number[] }>;
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

  const applySaved = (c: (typeof saved)[number]) => {
    setName(c.name);
    setCity(c.city);
    setPars(c.pars.map(String));
    setYards(c.yards.map(String));
    setStrokeIndex(c.strokeIndex.map(String));
    setPasteProblems([]);
  };

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

      {saved.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", marginBottom: 6 }}>Your club&rsquo;s courses</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {saved.map((c) => (
              <button
                key={c.id}
                type="button"
                className="btn btn-secondary"
                onClick={() => applySaved(c)}
                style={{ fontSize: 12.5 }}
              >
                <i className="ph ph-flag-pennant" /> {c.name}
                {c.city && <span className="text-muted" style={{ marginLeft: 5 }}>{c.city}</span>}
              </button>
            ))}
          </div>
          <p className="text-muted" style={{ fontSize: 11.5, margin: "8px 0 0" }}>
            Pick one to fill the card below, or add a new course by pasting it.
          </p>
        </div>
      )}

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

      {/* Two rows of nine, the way a card is actually printed. One scrolling
          row of eighteen put 54 identical boxes behind a horizontal scrollbar,
          which is both unreadable and the least-used path on the screen. */}
      {/* Open on its own when a paste went wrong.
          The line above promises "the boxes below fill in as you paste", and
          they were folded away — so the one moment a reader needs to SEE what
          the paste produced, in order to correct it, was the one moment it was
          hidden. A problem is not something to make somebody go looking for
          the evidence of. `open` is uncontrolled after the first render, so a
          reader can still fold it away again. */}
      <details open={pasteProblems.length > 0}>
        <summary style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 600, marginBottom: 10 }}>
          {pasteProblems.length > 0 ? "Check the card below" : "Or type the card in by hand"}
        </summary>
        {/* Each nine gets its own scroller.
            `width: 100%` sounds like it bounds the table and does not: a table's
            intrinsic minimum is the sum of what its cells need, and ten columns
            of number inputs need about 418px. On a 375px phone the row simply
            ran past the edge — and because no ancestor scrolled, the last holes
            were not merely awkward to reach, they were unreachable. Nobody could
            type a score into the 8th or 9th.
            The overflow lives on a wrapper rather than the table so the header
            row scrolls with its own columns. */}
        {[0, 9].map((offset) => (
          <div key={offset} style={{ overflowX: "auto", marginBottom: 10 }}>
            <table className="sc" style={{ width: "100%", minWidth: 430 }}>
              <thead>
                <tr>
                  <th>{offset === 0 ? "Front" : "Back"}</th>
                  {Array.from({ length: 9 }, (_, i) => (
                    <th key={i}>{offset + i + 1}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ["Par", pars, setPars, "4"],
                    ["Yards", yards, setYards, "400"],
                    ["S.I.", strokeIndex, setStrokeIndex, String(offset + 1)],
                  ] as const
                ).map(([label, values, setter, hint]) => (
                  <tr key={label}>
                    <td>{label}</td>
                    {Array.from({ length: 9 }, (_, i) => {
                      const idx = offset + i;
                      return (
                        <td key={idx} style={{ padding: 2 }}>
                          <input
                            className="input sc-score"
                            inputMode="numeric"
                            value={values[idx] ?? ""}
                            placeholder={hint}
                            aria-label={`${label}, hole ${idx + 1}`}
                            onChange={(e) => setCell(values, setter, idx, e.target.value)}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </details>


      {error && (
        <p style={{ fontSize: 13, margin: "10px 0 0", color: "var(--color-danger)" }}>
          <i className="ph ph-warning-circle" /> {error}
        </p>
      )}
      <button type="button" className="btn btn-primary" disabled={pending} onClick={save} style={{ marginTop: 14 }}>
        <i className="ph ph-check" /> {pending ? "Saving…" : "Save course & start scoring"}
      </button>
    </div>
  );
}
