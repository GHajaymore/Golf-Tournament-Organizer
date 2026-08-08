"use client";
import { CardImport } from "./CardImport";
import { Fragment, useState, useTransition } from "react";
import { TeeEditor } from "./TeeEditor";
import {
  saveClubCourse,
  deleteClubCourse,
  addPresetCourse,
  setEventCourses,
  setHomeCourse,
  verifyCourseCard,
  unverifyCourseCard,
} from "@/app/actions/courses";
import type { ClubCourse } from "@/lib/services/courses";

const BLANK = new Array(18).fill("");

/**
 * The club's courses, and which of them this tournament is played on.
 *
 * Selecting one is the ordinary case and turns every downstream picker off.
 * Selecting several is what a multi-day event rotating venues, or a league
 * with no fixed venue, needs — and only then does anyone get asked where a
 * round or a match was played.
 */
export function CourseLibrary({
  courses,
  canEdit,
  clubCity = "",
  homeCourse = null,
}: {
  courses: ClubCourse[];
  /** The club's city, so a local course does not need retyping. */
  clubCity?: string;
  canEdit: boolean;
  /** The club's own course, if set — new tournaments start there. */
  homeCourse?: string | null;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(courses.filter((c) => c.inEvent).map((c) => c.id)),
  );
  const [homeCourseId, setHomeCourseId] = useState<string | null>(homeCourse);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [pars, setPars] = useState<string[]>(BLANK);
  const [yards, setYards] = useState<string[]>(BLANK);
  const [si, setSi] = useState<string[]>(BLANK);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, startTransition] = useTransition();

  const nums = (a: string[]) => a.map((v) => parseInt(v, 10)).map((n) => (Number.isFinite(n) ? n : 0));

  const resetForm = () => {
    setName("");
    setCity("");
    setPars(BLANK);
    setYards(BLANK);
    setSi(BLANK);
    setEditing(null);
    setAdding(false);
    setError("");
  };

  const openEdit = (c: ClubCourse) => {
    setAdding(false);
    setEditing(c.id);
    setName(c.name);
    setCity(c.city);
    setPars(c.pars.map(String));
    setYards(c.yards.map(String));
    setSi(c.strokeIndex.map(String));
    setError("");
  };

  const save = () => {
    setError("");
    setNotice("");
    startTransition(async () => {
      const res = await saveClubCourse({
        id: editing ?? undefined,
        name,
        city,
        pars: nums(pars),
        yards: nums(yards),
        strokeIndex: nums(si),
      });
      if (!res.ok) {
        setError(res.error ?? "Couldn't save the course.");
        return;
      }
      setNotice(`${name.trim()} saved to the club library.`);
      resetForm();
    });
  };

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
    setError("");
    setNotice("");
    startTransition(async () => {
      const res = await setEventCourses([...next]);
      if (!res.ok) setError(res.error ?? "Couldn't update the tournament's venues.");
    });
  };

  const cell = (arr: string[], set: (v: string[]) => void, i: number) => (
    <input
      key={i}
      className="input"
      inputMode="numeric"
      value={arr[i] ?? ""}
      disabled={pending}
      onChange={(e) => {
        const next = [...arr];
        next[i] = e.target.value;
        set(next);
      }}
      style={{ width: 42, padding: "4px 2px", textAlign: "center", fontSize: 12 }}
    />
  );

  const selectedCount = selected.size;

  return (
    <div className="card elev-sm" style={{ gap: 12 }}>
      <div>
        <span className="card-title" style={{ fontSize: 15 }}>Courses</span>
        <p className="text-muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
          Which venues this tournament is played on. Pick one and nobody is asked again. Pick several — a
          multi-day event rotating courses, or a league where opponents choose their own — and you can set the
          venue per round, or per match where it can&rsquo;t be known in advance.
        </p>
      </div>

      {courses.length === 0 ? (
        <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
          No courses saved yet. Add one below, or start from a built-in.
        </p>
      ) : (
        <div className="table-scroll">
          <table className="table" style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ width: 34 }} />
                <th>Course</th>
                <th style={{ width: 90 }}>Par</th>
                <th style={{ width: 120 }} />
              </tr>
            </thead>
            <tbody>
              {courses.map((c) => (
              <Fragment key={c.id}>
                <tr>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      disabled={!canEdit || pending}
                      onChange={() => toggle(c.id)}
                      aria-label={`Use ${c.name}`}
                    />
                  </td>
                  <td style={{ fontWeight: 500 }}>
                    {c.name}
                    {c.city && (
                      <span className="text-muted" style={{ fontSize: 12 }}> · {c.city}</span>
                    )}
                    {/* An imported card is usable but unproven, and the thing
                        that can be wrong about it — the stroke index — is
                        invisible in play. It just sends handicap shots to the
                        wrong holes, for the life of the course. So the state
                        is shown on the row rather than buried. */}
                    {!c.verified && (
                      <span
                        className="tag tag-neutral"
                        style={{ fontSize: 10.5, marginLeft: 8, verticalAlign: "middle" }}
                        title={
                          c.sourceUrl
                            ? `Imported from ${c.sourceUrl} — nobody has checked it against the real card.`
                            : "Nobody has checked this card against the real one."
                        }
                      >
                        <i className="ph ph-seal-question" /> Unverified
                      </span>
                    )}
                    {c.verified && c.verifiedBy && (
                      <span className="text-muted" style={{ fontSize: 11, marginLeft: 8 }} title={`Checked by ${c.verifiedBy}`}>
                        <i className="ph ph-seal-check" />
                      </span>
                    )}
                  </td>
                  <td style={{ fontVariantNumeric: "tabular-nums" }}>
                    {c.pars.reduce((s, p) => s + p, 0)}
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {canEdit && (
                      <>
                        {/* The other half of importing a card. Without it the
                            library fills with permanently-unverified courses
                            and the badge stops meaning anything. */}
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ fontSize: 12, padding: "3px 9px", marginRight: 6 }}
                          disabled={pending}
                          title={
                            c.verified
                              ? "Mark this card as needing another check"
                              : "Confirm this card matches the real one — especially the stroke index"
                          }
                          onClick={() =>
                            startTransition(async () => {
                              const res = c.verified
                                ? await unverifyCourseCard(c.id)
                                : await verifyCourseCard(c.id);
                              if (!res.ok) setError(res.error ?? "Couldn't change the card's status.");
                            })
                          }
                        >
                          {c.verified ? "Unverify" : "Verify card"}
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ fontSize: 12, padding: "3px 9px" }}
                          disabled={pending}
                          onClick={() => openEdit(c)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ fontSize: 12, padding: "3px 9px", marginLeft: 6 }}
                          disabled={pending}
                          onClick={() =>
                            startTransition(async () => {
                              const res = await deleteClubCourse(c.id);
                              if (!res.ok) setError(res.error ?? "Couldn't remove the course.");
                            })
                          }
                          title="Rounds and matches played here keep their results"
                        >
                          Remove
                        </button>
                      </>
                    )}
                  </td>
                </tr>
                {/* Ratings live with the course rather than on a separate
                    screen: they are what make a handicap mean anything here,
                    and an organizer setting up a venue is exactly the person
                    holding the scorecard they are printed on. */}
                <tr key={`-tees`}>
                  <td colSpan={canEdit ? 7 : 6} style={{ paddingTop: 0 }}>
                    <TeeEditor courseId={c.id} tees={c.tees} canEdit={canEdit} />
                  </td>
                </tr>
              </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* A club plays at its own course. Setting it here means every new
          tournament starts there and nobody picks a venue they were never
          going to change. Societies leave it unset — several venues is their
          normal case, not an exception. */}
      {courses.length > 0 && canEdit && (
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, flexWrap: "wrap" }}>
          <span>Club&rsquo;s home course</span>
          <select
            className="input"
            style={{ width: "auto" }}
            value={homeCourseId ?? ""}
            disabled={pending}
            onChange={(e) => {
              const id = e.target.value || null;
              setHomeCourseId(id);
              setError("");
              startTransition(async () => {
                const res = await setHomeCourse(id);
                if (!res.ok) setError(res.error ?? "Couldn't set the home course.");
                else setNotice(id ? "New tournaments will start at this course." : "Home course cleared.");
              });
            }}
          >
            <option value="">None — choose per tournament</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <span className="text-muted" style={{ fontSize: 12 }}>
            applies to new tournaments; existing ones keep their venues
          </span>
        </label>
      )}

      {selectedCount > 1 && (
        <p
          style={{
            fontSize: 12,
            margin: 0,
            padding: "8px 11px",
            borderRadius: "var(--radius-md)",
            background: "color-mix(in srgb, var(--color-accent) 12%, transparent)",
          }}
        >
          <i className="ph ph-flag" /> {selectedCount} venues — set the course per round on Rounds &amp;
          format, and per match in Score entry where it varies.
        </p>
      )}

      {error && (
        <p style={{ fontSize: 13, margin: 0, color: "var(--color-danger)" }}>
          <i className="ph ph-warning-circle" /> {error}
        </p>
      )}
      {notice && (
        <p style={{ fontSize: 13, margin: 0, color: "var(--color-accent)" }}>
          <i className="ph ph-check-circle" /> {notice}
        </p>
      )}

      {canEdit && pasting && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <CardImport defaultCity={clubCity} onDone={() => setPasting(false)} />
          <button type="button" className="btn btn-ghost" style={{ alignSelf: "flex-start" }} onClick={() => setPasting(false)}>
            Done
          </button>
        </div>
      )}

      {canEdit && !adding && !editing && !pasting && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn" onClick={() => { resetForm(); setAdding(true); }}>
            <i className="ph ph-plus" /> Add a course
          </button>
          {/* The bundled "presets" that used to sit here were four invented
              courses with invented stroke indexes. Pasting the real card off
              the club website takes about the same number of clicks and is
              the actual course. */}
          <button type="button" className="btn btn-secondary" onClick={() => setPasting(true)}>
            <i className="ph ph-clipboard-text" /> Paste a card
          </button>
        </div>
      )}

      {(adding || editing) && (
        <div style={{ borderTop: "1px solid var(--color-divider)", paddingTop: 12 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
            <div className="field" style={{ minWidth: 220, flex: 1 }}>
              <label>Course name</label>
              <input className="input" value={name} disabled={pending} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field" style={{ minWidth: 180, flex: 1 }}>
              <label>City</label>
              <input className="input" value={city} disabled={pending} onChange={(e) => setCity(e.target.value)} />
            </div>
          </div>

          <p className="text-muted" style={{ fontSize: 12, margin: "0 0 8px" }}>
            Always the full 18, even for a nine-hole venue — which nine is chosen per round, so a half card
            would make &ldquo;back nine&rdquo; meaningless.
          </p>

          <div className="table-scroll">
            <table className="table" style={{ fontSize: 12 }}>
              <tbody>
                <tr>
                  <td style={{ fontWeight: 600 }}>Hole</td>
                  {Array.from({ length: 18 }, (_, i) => (
                    <td key={i} style={{ textAlign: "center", color: "var(--color-neutral-500)" }}>{i + 1}</td>
                  ))}
                </tr>
                <tr>
                  <td style={{ fontWeight: 600 }}>Par</td>
                  {Array.from({ length: 18 }, (_, i) => <td key={i}>{cell(pars, setPars, i)}</td>)}
                </tr>
                <tr>
                  <td style={{ fontWeight: 600 }}>Yards</td>
                  {Array.from({ length: 18 }, (_, i) => <td key={i}>{cell(yards, setYards, i)}</td>)}
                </tr>
                <tr>
                  <td style={{ fontWeight: 600 }}>S.I.</td>
                  {Array.from({ length: 18 }, (_, i) => <td key={i}>{cell(si, setSi, i)}</td>)}
                </tr>
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button type="button" className="btn btn-primary" disabled={pending || !name.trim()} onClick={save}>
              <i className="ph ph-check" /> {pending ? "Saving…" : editing ? "Save course" : "Add course"}
            </button>
            <button type="button" className="btn" disabled={pending} onClick={resetForm}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
