"use client";
import { CardImport } from "./CardImport";
import { Fragment, useState, useTransition } from "react";
import { TeeEditor } from "./TeeEditor";
import {
  saveClubCourse,
  deleteClubCourse,
  setEventCourses,
  setHomeCourse,
  verifyCourseCard,
  unverifyCourseCard,
  checkCourseAgainstSource,
  applySourceCard,
} from "@/app/actions/courses";
import { CourseSearch } from "./CourseSearch";
import { parseCard } from "@/lib/domain/scorecard-parse";
import { isDirectorySource, type CardDifference } from "@/lib/domain/course-directory";
import type { ClubCourse } from "@/lib/services/courses";

/** The result of asking the directory whether a course has changed. */
interface SourceCheck {
  courseId: string;
  name: string;
  /** Whether somebody at the club has confirmed the stored card. */
  confirmed: boolean;
  differences: CardDifference[];
  /** Why there was nothing to compare, when the source's card is unusable. */
  sourceProblem: string;
}

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
  openCourseId = null,
}: {
  courses: ClubCourse[];
  /** The club's city, so a local course does not need retyping. */
  clubCity?: string;
  canEdit: boolean;
  /** The club's own course, if set — new tournaments start there. */
  homeCourse?: string | null;
  /** A course to open the card editor on, from `?course=<id>`. Score entry
   *  links here rather than growing a second card editor of its own. */
  openCourseId?: string | null;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(courses.filter((c) => c.inEvent).map((c) => c.id)),
  );
  /**
   * The course to open the editor on, from `?course=<id>`.
   *
   * Resolved as the initial state rather than in an effect, so the editor is
   * open in the first render — somebody who followed "correct this card" from
   * score entry arrives looking at the boxes, not at a table they have to
   * find their course in again.
   */
  const opened = openCourseId ? courses.find((c) => c.id === openCourseId) ?? null : null;
  /**
   * The card in the boxes, or empty boxes for a course that hasn't got one.
   *
   * `clubCourses` falls back to a placeholder card so a cardless row stays
   * visible and editable. Loading that placeholder INTO the editor would
   * present eighteen 4s and a 1–18 index as this course's card and invite
   * somebody to save them, which is how the invented data this app deleted
   * would come straight back.
   */
  const cardOf = (c: ClubCourse, values: number[]) => (c.hasCard ? values.map(String) : BLANK);

  const [homeCourseId, setHomeCourseId] = useState<string | null>(homeCourse);
  const [editing, setEditing] = useState<string | null>(opened?.id ?? null);
  const [adding, setAdding] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [searching, setSearching] = useState(false);
  const [name, setName] = useState(opened?.name ?? "");
  const [city, setCity] = useState(opened?.city ?? "");
  const [pars, setPars] = useState<string[]>(opened ? cardOf(opened, opened.pars) : BLANK);
  const [yards, setYards] = useState<string[]>(opened ? cardOf(opened, opened.yards) : BLANK);
  const [si, setSi] = useState<string[]>(opened ? cardOf(opened, opened.strokeIndex) : BLANK);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  /** The paste box inside the editor, and what the last paste made of it. */
  const [pasteCard, setPasteCard] = useState("");
  const [pasteNote, setPasteNote] = useState("");
  const [pasteProblems, setPasteProblems] = useState<string[]>([]);
  /** The open "check the source" report, if one has been asked for. */
  const [check, setCheck] = useState<SourceCheck | null>(null);
  const [pending, startTransition] = useTransition();

  const nums = (a: string[]) => a.map((v) => parseInt(v, 10)).map((n) => (Number.isFinite(n) ? n : 0));

  /**
   * Fill the boxes from three rows off the club's website.
   *
   * Rows in the order a card is read: par, stroke index, yardage. Totals and
   * labels are stripped by `parseCard`, so the row can be copied straight out
   * of the table without editing it first.
   *
   * A short or unreadable paste says so rather than half-filling in silence —
   * the failure mode here is someone pasting the par row alone and watching
   * nothing happen.
   */
  const applyPastedCard = (text: string) => {
    setPasteCard(text);
    setPasteNote("");
    setPasteProblems([]);
    const rows = text.split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
    if (rows.length === 0) return;
    if (rows.length < 2) {
      setPasteProblems(["Two rows at least — par on the first, stroke index on the second."]);
      return;
    }
    const card = parseCard({ pars: rows[0], strokeIndex: rows[1], yards: rows[2] ?? "" }, 18);
    if (!card.ok) {
      setPasteProblems(card.problems.map((p) => `${p.row}: ${p.message}`));
      return;
    }
    setPars(card.pars.map(String));
    setSi(card.strokeIndex.map(String));
    if (card.yards.length === 18) setYards(card.yards.map(String));
    setPasteNote(
      `Read 18 pars and 18 stroke indexes${card.yards.length === 18 ? " and 18 yardages" : ""}. Check the boxes below, then save.`,
    );
  };

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
    // Empty boxes for a course with no card, rather than the placeholder the
    // service falls back to — see `cardOf`.
    setPars(cardOf(c, c.pars));
    setYards(cardOf(c, c.yards));
    setSi(cardOf(c, c.strokeIndex));
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
                        // Where it came from is genuinely per-row, so it stays
                        // here rather than in the shared sentence below the
                        // table — but in the accessible name too, not only in a
                        // `title` a phone never shows.
                        aria-label={
                          c.sourceUrl
                            ? `${c.name}: unverified card, imported from ${c.sourceUrl}`
                            : `${c.name}: unverified card`
                        }
                      >
                        <i className="ph ph-seal-question" aria-hidden /> Unverified
                      </span>
                    )}
                    {c.verified && c.verifiedBy && (
                      // A seal with no accessible name at all: the icon is
                      // decorative markup and the only text — who checked it —
                      // was in a `title`, which a screen reader may never
                      // announce. Named now, and the icon marked as the
                      // decoration it is.
                      <span
                        className="text-muted"
                        style={{ fontSize: 11, marginLeft: 8 }}
                        title={`Checked by ${c.verifiedBy}`}
                        aria-label={`Card checked by ${c.verifiedBy}`}
                        role="img"
                      >
                        <i className="ph ph-seal-check" aria-hidden />
                      </span>
                    )}
                  </td>
                  {/* The course's par, or the fact that it hasn't got one.
                      A cardless venue used to print "72" here — the sum of the
                      placeholder the service falls back to so the row stays
                      editable — which is a par nobody has played, presented as
                      this course's. Importing a course whose card the directory
                      got wrong is exactly how a club ends up looking at it. */}
                  <td style={{ fontVariantNumeric: "tabular-nums" }}>
                    {c.hasCard ? (
                      c.pars.reduce((s, p) => s + p, 0)
                    ) : (
                      <span className="text-muted" style={{ fontSize: 11.5, fontVariantNumeric: "normal" }}>
                        No card yet
                      </span>
                    )}
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
                        {/* Only where there is something to check against.
                            Offered from `sourceUrl` rather than a stored flag,
                            so the button appears exactly when the server will
                            honour it. */}
                        {isDirectorySource(c.sourceUrl) && (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ fontSize: 12, padding: "3px 9px", marginRight: 6 }}
                            disabled={pending}
                            onClick={() =>
                              startTransition(async () => {
                                setCheck(null);
                                setError("");
                                const res = await checkCourseAgainstSource(c.id);
                                if (!res.ok) {
                                  setError(res.error ?? "Couldn't reach the course directory.");
                                  return;
                                }
                                setCheck({
                                  courseId: c.id,
                                  name: c.name,
                                  confirmed: !!res.confirmed,
                                  differences: res.differences ?? [],
                                  sourceProblem: res.sourceProblem ?? "",
                                });
                              })
                            }
                          >
                            Check source
                          </button>
                        )}
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

      {/* What "Unverified" costs, once for the table.
          The badge showed the STATE on the row — which the comment above it
          claims credit for — and left the stakes in a `title`. The stakes are
          the whole reason the badge exists, and they are not obvious: a wrong
          stroke index is invisible in play. It does not look wrong, it just
          sends handicap shots to the wrong holes, every round, for as long as
          the course is on the list.

          One sentence rather than one per row: it is the same sentence for
          every unverified card, and repeating it down a table is noise. */}
      {/* What the directory says now, and nothing more.
          Checking never writes. A confirmed card is a person at this club
          stating a fact about a real course; the source is a community
          database this app has already watched be wrong — pars sorted
          longest-to-shortest on a real course, with a valid stroke index and
          the right total, so every arithmetic check passed. So the source may
          report a difference and explain it, and it may not overrule anyone.
          Taking it is the separate, deliberate button below. */}
      {check && (
        <div
          className="card elev-sm"
          style={{ borderLeft: "3px solid var(--color-accent)", gap: 8, marginBottom: 4 }}
        >
          <span className="card-title" style={{ fontSize: 14 }}>
            {check.name} — what the directory says now
          </span>

          {check.sourceProblem ? (
            <p className="text-muted" style={{ fontSize: 12, margin: 0, lineHeight: 1.6 }}>
              Nothing to compare: {check.sourceProblem} Your card is unaffected.
            </p>
          ) : check.differences.length === 0 ? (
            <p className="text-muted" style={{ fontSize: 12, margin: 0, lineHeight: 1.6 }}>
              No change — the directory&rsquo;s card matches yours hole for hole.
            </p>
          ) : (
            <>
              <p className="text-muted" style={{ fontSize: 12, margin: 0, lineHeight: 1.6 }}>
                {check.differences.length}{" "}
                {check.differences.length === 1 ? "hole differs" : "holes differ"}.{" "}
                {check.confirmed
                  ? "Somebody here confirmed this card, so nothing changes unless you say so — clubs do re-index their holes, and community data is also just wrong sometimes."
                  : "Nobody has confirmed this card yet, so the directory is as good a guess as what is stored — but check it against your own card before taking it."}
              </p>
              <div style={{ overflowX: "auto" }}>
                <table className="table" style={{ fontSize: 12, minWidth: 320 }}>
                  <thead>
                    <tr>
                      <th>Hole</th>
                      <th>What</th>
                      <th>Yours</th>
                      <th>Directory</th>
                    </tr>
                  </thead>
                  <tbody>
                    {check.differences.map((d) => (
                      <tr key={`${d.hole}-${d.field}`}>
                        <td>{d.hole}</td>
                        <td>{d.field === "par" ? "Par" : "Stroke index"}</td>
                        <td style={{ fontVariantNumeric: "tabular-nums" }}>{d.ours}</td>
                        <td style={{ fontVariantNumeric: "tabular-nums" }}>{d.theirs}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {check.differences.length > 0 && (
              <button
                type="button"
                className="btn btn-secondary"
                style={{ fontSize: 12 }}
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const res = await applySourceCard(check.courseId);
                    if (!res.ok) {
                      setError(res.error ?? "Couldn't take the directory's card.");
                      return;
                    }
                    // Reading the differences hole by hole and accepting them
                    // IS checking the card, so it lands confirmed rather than
                    // going back to unverified.
                    setNotice(`${check.name} now matches the directory, and is marked as checked by you.`);
                    setCheck(null);
                  })
                }
              >
                <i className="ph ph-download-simple" /> Take the directory&rsquo;s card
              </button>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: 12 }}
              onClick={() => setCheck(null)}
            >
              {check.differences.length > 0 ? "Leave mine as it is" : "Close"}
            </button>
          </div>
        </div>
      )}

      {/* What "Check source" does, said once for the table rather than hidden
          in a tooltip on every row. The reassurance is the whole point of the
          button — an organizer will not press something that might quietly
          rewrite a card they confirmed. */}
      {canEdit && courses.some((c) => isDirectorySource(c.sourceUrl)) && (
        <p className="text-muted" style={{ fontSize: 11.5, margin: 0, lineHeight: 1.5 }}>
          <i className="ph ph-arrows-clockwise" /> <b>Check source</b> asks the directory whether an
          imported card has changed. It never writes: you see what differs and decide.
        </p>
      )}

      {courses.some((c) => !c.verified) && (
        <p className="text-muted" style={{ fontSize: 11.5, margin: 0, lineHeight: 1.5 }}>
          <i className="ph ph-seal-question" /> An <b>unverified</b> card was imported and nobody has
          checked it against the real one. The part that matters is the stroke index: it is invisible
          in play, so a wrong one quietly sends handicap shots to the wrong holes for as long as the
          course is on this list.
        </p>
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

      {canEdit && searching && (
        <div style={{ borderTop: "1px solid var(--color-divider)", paddingTop: 12 }}>
          <CourseSearch />
          <button type="button" className="btn btn-ghost" style={{ alignSelf: "flex-start" }} onClick={() => setSearching(false)}>
            Done
          </button>
        </div>
      )}

      {canEdit && pasting && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <CardImport defaultCity={clubCity} onDone={() => setPasting(false)} />
          <button type="button" className="btn btn-ghost" style={{ alignSelf: "flex-start" }} onClick={() => setPasting(false)}>
            Done
          </button>
        </div>
      )}

      {canEdit && !adding && !editing && !pasting && !searching && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {/* Fastest first. Looking a course up fills the card AND the rated
              tee sets, which is the part a club otherwise types twice — but it
              covers US courses only, so the two paths that always work stay
              right beside it rather than behind it. */}
          <button type="button" className="btn" onClick={() => { setCheck(null); setSearching(true); }}>
            <i className="ph ph-magnifying-glass" /> Look up a course
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => { resetForm(); setAdding(true); }}>
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

          {/* Paste, in the editor rather than beside it.
              "Paste a card" up there CREATES a course, so it was no use to
              anyone correcting one — and score entry now sends people here to
              enter a card for a venue that already exists. Handing them
              fifty-four boxes when a twenty-second paste exists a button away
              is a bad handoff.
              This fills the boxes and nothing else. Save still goes through
              `saveClubCourse`, so it is an input aid to the one editor, not a
              second writer of the same eighteen numbers. */}
          <div className="field" style={{ marginBottom: 10 }}>
            <label>Paste the card — par, stroke index, then yardage; one row each</label>
            <textarea
              className="input"
              rows={3}
              value={pasteCard}
              disabled={pending}
              onChange={(e) => applyPastedCard(e.target.value)}
              placeholder={"4 5 4 4 3 5 3 4 4 36 4 4 3 4 5 4 4 3 5 36 72\n6 10 12 16 14 2 18 4 8 3 9 17 7 1 13 11 15 5"}
              style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 12 }}
            />
            {pasteNote && (
              <p style={{ fontSize: 11.5, margin: "4px 0 0", color: "var(--color-accent-2-300)" }}>
                <i className="ph ph-check-circle" /> {pasteNote}
              </p>
            )}
            {pasteProblems.map((m, i) => (
              <p key={i} style={{ fontSize: 11.5, margin: "3px 0 0", color: "var(--color-danger)" }}>
                <i className="ph ph-warning-circle" /> {m}
              </p>
            ))}
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
