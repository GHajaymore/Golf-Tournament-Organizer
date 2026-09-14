"use client";
import { useState, useTransition } from "react";
import { saveTee, deleteTee } from "@/app/actions/courses";
import { courseHandicap, STANDARD_SLOPE } from "@/lib/domain/handicap";
import { ConfirmButton } from "./ConfirmButton";
import { Icon } from "./Icon";

export interface TeeRow {
  id: string;
  name: string;
  gender: string;
  courseRating: number;
  slopeRating: number;
  par: number;
  rated: boolean;
}

/**
 * The tees a course is played from, and their ratings.
 *
 * This is where a Handicap Index becomes the strokes a player actually
 * receives. Without a Course Rating and Slope the app scores everyone off
 * their raw index, which understates strokes on a hard course and overstates
 * them on an easy one — and makes a member-guest with mixed tees impossible to
 * settle fairly.
 *
 * The worked example under the form is deliberate. Slope and rating are
 * abstract numbers off the back of a scorecard, and an organizer typing them
 * has no way to tell a right answer from a transposed one. Showing what a
 * 14.0 index becomes turns a guess into something checkable.
 */
export function TeeEditor({
  courseId,
  tees,
  canEdit,
  defaultOpen = false,
}: {
  courseId: string;
  tees: TeeRow[];
  canEdit: boolean;
  /**
   * Start unfolded.
   *
   * For the course somebody deep-linked to from score entry — arriving at a
   * card you were sent to correct, to find it folded away, is the disclosure
   * working against the link.
   */
  defaultOpen?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    name: "",
    gender: "any",
    courseRating: "",
    slopeRating: "",
    par: "72",
  });

  const open = (t?: TeeRow) => {
    setError("");
    if (t) {
      setDraft({
        name: t.name,
        gender: t.gender,
        courseRating: t.courseRating ? String(t.courseRating) : "",
        slopeRating: t.slopeRating ? String(t.slopeRating) : "",
        par: String(t.par),
      });
      setEditing(t.id);
    } else {
      setDraft({ name: "", gender: "any", courseRating: "", slopeRating: "", par: "72" });
      setEditing("new");
    }
  };

  const save = () => {
    setError("");
    startTransition(async () => {
      const res = await saveTee(
        courseId,
        {
          name: draft.name,
          gender: draft.gender,
          courseRating: parseFloat(draft.courseRating) || 0,
          slopeRating: parseInt(draft.slopeRating, 10) || 0,
          par: parseInt(draft.par, 10) || 72,
        },
        editing && editing !== "new" ? editing : undefined,
      );
      if (!res.ok) setError(res.error ?? "Couldn't save that.");
      else setEditing(null);
    });
  };

  const remove = (id: string) => {
    setError("");
    startTransition(async () => {
      const res = await deleteTee(id);
      if (!res.ok) setError(res.error ?? "Couldn't save that.");
    });
  };

  // What the numbers currently entered would do to a mid-handicapper.
  const previewSlope = parseInt(draft.slopeRating, 10) || 0;
  const previewRating = parseFloat(draft.courseRating) || 0;
  const previewPar = parseInt(draft.par, 10) || 72;
  const preview =
    previewSlope > 0
      ? courseHandicap(14, { slopeRating: previewSlope, courseRating: previewRating, par: previewPar })
      : null;

  const unrated = tees.filter((t) => !t.rated);

  /**
   * FOLDED AWAY BY DEFAULT, because on this screen it is the majority of the
   * page and almost never the reason anybody came.
   *
   * Measured on /event with the demo club's three courses: the page is
   * 7,630px — 9.4 phone screens — and the three tee tables are 2,175px of it,
   * 28%, all of it between "Courses" and "Players & scoring". A club with ten
   * courses on file would push the settings below it off the end of a very
   * long scroll. Ratings are set once when a venue is added and then read
   * perhaps twice a year; the settings underneath are what an organizer
   * actually comes back for.
   *
   * The SUMMARY still says what is in there — how many sets and their names —
   * so folding it removes the table, not the fact. A course with no sets at
   * all stays open, because then the disclosure would hide the only thing
   * worth doing here, and so does the course somebody has just deep-linked to
   * from score entry.
   */
  /**
   * NAMES, DE-DUPLICATED, because a set is named per gender.
   *
   * A club rates the same tees twice — "White men 69.1/126" and "White women
   * 74.6/135" are one set of markers with two ratings, which is how golf
   * works and how this table stores it. Listing them raw read "Black, Gold,
   * White, White, Green, Green", which looks like a data error to anybody who
   * does not already know that. The COUNT still says six; the names say which
   * markers.
   */
  const names = [...new Set(tees.map((t) => t.name))].join(", ");
  const summary =
    tees.length === 0
      ? "No tees yet"
      : `${tees.length} ${tees.length === 1 ? "set" : "sets"} — ${names}${
          unrated.length ? ` · ${unrated.length} unrated` : ""
        }`;

  return (
    <details
      open={defaultOpen || tees.length === 0}
      style={{ marginTop: 10 }}
      // A `summary` element is a real disclosure: keyboard-operable and
      // announced as one, which a div with an onClick is not.
    >
      <summary
        style={{
          cursor: "pointer",
          fontSize: 12,
          color: "var(--color-neutral-400)",
          padding: "4px 0",
          /* NO inline min-height. A first draft set 32 here under a comment
             claiming 44, which is the kind of wrong that survives because the
             number and the sentence are both right next to each other and
             neither is checked. The 44 belongs on a coarse pointer only — a
             mouse does not need a 44px row of text — and `globals.css` is
             where this app keeps that rule, for every disclosure rather than
             just this one. An inline value here would also beat it. */
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span className="card-kicker" style={{ margin: 0 }}>Tees &amp; ratings</span>
        <span style={{ fontWeight: 400 }}>{summary}</span>
      </summary>
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {canEdit && (
          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: "2px 10px", fontSize: 12, marginLeft: "auto" }}
            disabled={pending}
            onClick={() => open()}
          >
            <Icon name="plus" /> Add tees
          </button>
        )}
      </div>

      {tees.length === 0 ? (
        <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
          No tees yet. Without a Course Rating and Slope, net scores use each player&apos;s raw
          handicap index — which is a few strokes out on most courses, and further out the harder
          the course plays.
        </p>
      ) : (
        <div className="table-scroll">
          <table className="table" style={{ fontSize: 12 }}>
            <thead>
              <tr>
                <th>Tees</th>
                <th>For</th>
                <th style={{ textAlign: "right" }}>Rating</th>
                <th style={{ textAlign: "right" }}>Slope</th>
                <th style={{ textAlign: "right" }}>Par</th>
                {/* The one column whose heading does not explain itself, and
                    the explanation was in a `title`. Said under the table
                    instead — a column header has no room for a sentence, and
                    a tooltip has no reader on a phone. */}
                <th style={{ textAlign: "right" }}>14.0 plays</th>
                {canEdit && <th style={{ width: 70 }} />}
              </tr>
            </thead>
            <tbody>
              {tees.map((t) => (
                <tr key={t.id}>
                  <td style={{ fontWeight: 500 }}>{t.name}</td>
                  <td className="text-muted">{t.gender === "any" ? "—" : t.gender}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {t.courseRating || "—"}
                  </td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {t.slopeRating || "—"}
                  </td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{t.par}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                    {t.rated
                      ? courseHandicap(14, {
                          slopeRating: t.slopeRating,
                          courseRating: t.courseRating,
                          par: t.par,
                        })
                      : "14"}
                  </td>
                  {canEdit && (
                    <td style={{ textAlign: "right" }}>
                      <button
                        type="button"
                        className="btn btn-icon"
                        title="Edit these tees"
                        disabled={pending}
                        onClick={() => open(t)}
                      >
                        <Icon name="pencil-simple" />
                      </button>
                      {/* Beside Edit, as two unlabelled icons. A tee set holds
                          the course rating and slope, which is what every
                          course handicap on it is calculated from.

                          The note says what `deleteTee` ACTUALLY does — the
                          foreign key nulls each player's teeId rather than
                          removing anyone. It deliberately does not promise
                          their course handicaps are unchanged: those are
                          derived from the rating and slope this row carries
                          away, and a reassurance nobody checked is worse than
                          none. */}
                      <ConfirmButton
                        title="Remove these tees"
                        confirmLabel="Remove them"
                        note="Nobody who played off them is removed — their tee reference is cleared."
                        disabled={pending}
                        onConfirm={() => remove(t.id)}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {unrated.length > 0 && (
        <p className="text-muted" style={{ fontSize: 11, margin: 0 }}>
          {unrated.map((t) => t.name).join(", ")} {unrated.length === 1 ? "has" : "have"} no rating
          yet, so anyone playing off {unrated.length === 1 ? "it" : "them"} is scored on their raw
          index.
        </p>
      )}

      {error && <p className="form-error">{error}</p>}

      {editing && canEdit && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: 12,
            borderRadius: 10,
            border: "1px solid var(--color-divider)",
            background: "var(--color-bg)",
          }}
        >
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <div className="field" style={{ minWidth: 130 }}>
              <label>Name</label>
              <input
                className="input"
                value={draft.name}
                placeholder="Blue"
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>
            <div className="field" style={{ width: 110 }}>
              <label>Rated for</label>
              <select
                className="input"
                value={draft.gender}
                onChange={(e) => setDraft({ ...draft, gender: e.target.value })}
              >
                <option value="any">Anyone</option>
                <option value="men">Men</option>
                <option value="women">Women</option>
              </select>
            </div>
            <div className="field" style={{ width: 110 }}>
              <label>Course Rating</label>
              <input
                className="input"
                inputMode="decimal"
                value={draft.courseRating}
                placeholder="71.5"
                onChange={(e) => setDraft({ ...draft, courseRating: e.target.value })}
              />
            </div>
            <div className="field" style={{ width: 100 }}>
              <label>Slope</label>
              <input
                className="input"
                inputMode="numeric"
                value={draft.slopeRating}
                placeholder={String(STANDARD_SLOPE)}
                onChange={(e) => setDraft({ ...draft, slopeRating: e.target.value })}
              />
            </div>
            <div className="field" style={{ width: 80 }}>
              <label>Par</label>
              <input
                className="input"
                inputMode="numeric"
                value={draft.par}
                onChange={(e) => setDraft({ ...draft, par: e.target.value })}
              />
            </div>
          </div>

          {/* Slope and rating are abstract numbers off the back of a card. This
              turns them into something an organizer can sanity-check. */}
          <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
            {preview !== null ? (
              <>
                A <b style={{ color: "var(--color-text)" }}>14.0</b> index plays off{" "}
                <b style={{ color: "var(--color-text)" }}>{preview}</b> from these tees
                {preview !== 14 && ` — ${Math.abs(preview - 14)} ${preview > 14 ? "more" : "fewer"} than their index`}.
                Both numbers are on the back of the scorecard.
              </>
            ) : (
              "Leave the rating and slope blank if you don't have them — players will be scored on their raw index until you add them."
            )}
          </p>

          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn btn-primary" disabled={pending} onClick={save}>
              {pending ? "Saving…" : "Save tees"}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
    </details>
  );
}

/**
 * WHAT THE "14.0 plays" COLUMN IS — said once, by whoever lists the courses.
 *
 * It used to sit under each course's own tee table. That reads correctly for
 * one course and badly for a club with several: `CourseLibrary` renders a
 * `TeeEditor` per course, so the demo club's three venues printed this same
 * paragraph three times down one screen, and a club with a dozen would print
 * a dozen. Measured on `/event`, 2026-09-13.
 *
 * The column heading is identical on every one of those tables, so one
 * explanation covers all of them — and the place that knows how many tables
 * there are is the list, not the table.
 *
 * Exported as a component rather than a string so the wording and its styling
 * travel together; a caller that renders the tables is the caller that should
 * render this, and there is exactly one.
 */
export function PlaysExplainer() {
  return (
    <p className="text-muted" style={{ fontSize: 11, margin: "10px 0 0", lineHeight: 1.5 }}>
      <b>14.0 plays</b> is the course handicap a 14.0 index gets off each set — worked out from
      that set&rsquo;s rating, slope and par. It is what the difference between two sets of tees
      actually costs a player.
    </p>
  );
}
