"use client";
import { useState, useTransition } from "react";
import { saveTee, deleteTee } from "@/app/actions/courses";
import { courseHandicap, STANDARD_SLOPE } from "@/lib/domain/handicap";

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
}: {
  courseId: string;
  tees: TeeRow[];
  canEdit: boolean;
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
      if (!res.ok && res.error) setError(res.error);
      else setEditing(null);
    });
  };

  const remove = (id: string) => {
    setError("");
    startTransition(async () => {
      const res = await deleteTee(id);
      if (!res.ok && res.error) setError(res.error);
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="card-kicker">Tees &amp; ratings</span>
        {canEdit && (
          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: "2px 10px", fontSize: 12, marginLeft: "auto" }}
            disabled={pending}
            onClick={() => open()}
          >
            <i className="ph ph-plus" /> Add tees
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
                <th style={{ textAlign: "right" }} title="What a 14.0 index plays off here">
                  14.0 plays
                </th>
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
                        <i className="ph ph-pencil-simple" />
                      </button>
                      <button
                        type="button"
                        className="btn btn-icon"
                        title="Remove these tees"
                        disabled={pending}
                        onClick={() => remove(t.id)}
                      >
                        <i className="ph ph-trash" />
                      </button>
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

      {error && <p style={{ fontSize: 12, margin: 0, color: "var(--color-danger)" }}>{error}</p>}

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
  );
}
