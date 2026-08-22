"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { searchCourseDirectory, importCourseFromDirectory } from "@/app/actions/courses";
import { DIRECTORY_ATTRIBUTION, type DirectoryHit } from "@/lib/domain/course-directory";

/**
 * Look a course up instead of typing fifty-four numbers.
 *
 * The rung above pasting: search a public directory of US courses, pick the
 * one you play, and its card and rated tee sets land in the club's library.
 *
 * It is an accelerator, never the only way in. Coverage is US-only, so a UK or
 * Irish club gets nothing here and must still paste or type — which is why
 * this sits ABOVE those paths on the screen rather than replacing them, and
 * why finding nothing is worded as an ordinary answer rather than a failure.
 *
 * Nothing it imports is trusted. A card that survives import lands `imported`
 * and unverified, and a card the directory got wrong is refused outright with
 * the reason — the course still arrives, with its name and its tees, and the
 * club enters the card. That refusal is not theoretical: the directory returns
 * at least one real course with its pars sorted longest-to-shortest.
 */
export function CourseSearch({ onImported }: { onImported?: (courseId: string) => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<DirectoryHit[] | null>(null);
  const [error, setError] = useState("");
  /** What the last import did, in the club's terms. */
  const [note, setNote] = useState<{ kind: "ok" | "partial"; text: string } | null>(null);
  const [busyId, setBusyId] = useState("");
  const [pending, startTransition] = useTransition();

  const search = () => {
    const q = query.trim();
    setError("");
    setNote(null);
    if (q.length < 3) {
      setError("Type at least three letters of the course name.");
      return;
    }
    startTransition(async () => {
      const res = await searchCourseDirectory(q);
      if (!res.ok) {
        setError(res.error ?? "Couldn't reach the course directory.");
        setHits(null);
        return;
      }
      setHits(res.hits ?? []);
    });
  };

  const importOne = (hit: DirectoryHit) => {
    setError("");
    setNote(null);
    setBusyId(hit.id);
    startTransition(async () => {
      const res = await importCourseFromDirectory(hit.id);
      setBusyId("");
      if (!res.ok) {
        setError(res.error ?? "Couldn't import that course.");
        return;
      }
      const tees = res.teeCount
        ? ` and ${res.teeCount} rated tee ${res.teeCount === 1 ? "set" : "sets"}`
        : "";
      // Two genuinely different outcomes, said differently. "Imported" when
      // the card came with it; when the card was refused the club has a job
      // left to do, and burying that under a tick is how a placeholder card
      // ends up scoring a tournament.
      setNote(
        res.cardImported
          ? { kind: "ok", text: `${hit.name} added, with its card${tees}. Check it against your own before you score with it.` }
          : {
              kind: "partial",
              text: `${hit.name} added${tees}, but without a card — ${res.cardProblem ?? "the directory has no usable one."} Paste or type the card below.`,
            },
      );
      if (res.courseId) onImported?.(res.courseId);
      router.refresh();
    });
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: "block", marginBottom: 6 }}>Look up a course</label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          className="input"
          style={{ minWidth: 200, flex: 1 }}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              search();
            }
          }}
          placeholder="e.g. Green Crest"
          aria-label="Search for a course by name"
        />
        <button type="button" className="btn btn-secondary" onClick={search} disabled={pending}>
          <i className="ph ph-magnifying-glass" /> {pending && !busyId ? "Searching…" : "Search"}
        </button>
      </div>

      {error && (
        <p style={{ fontSize: 11.5, margin: "6px 0 0", color: "var(--color-danger)" }}>
          <i className="ph ph-warning-circle" /> {error}
        </p>
      )}

      {note && (
        <p
          style={{
            fontSize: 12,
            margin: "8px 0 0",
            lineHeight: 1.5,
            color: note.kind === "ok" ? "var(--color-accent-2-300)" : "var(--color-accent)",
          }}
        >
          <i className={note.kind === "ok" ? "ph ph-check-circle" : "ph ph-warning-circle"} /> {note.text}
        </p>
      )}

      {hits !== null && hits.length === 0 && !error && (
        // An ordinary answer, not a failure. The directory covers US courses
        // only, and a club outside it should be pointed at the path that works
        // for them rather than left wondering what went wrong.
        <p className="text-muted" style={{ fontSize: 11.5, margin: "8px 0 0", lineHeight: 1.5 }}>
          No match. The directory covers US courses only — paste your card below, or type it in.
        </p>
      )}

      {hits !== null && hits.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
          {hits.map((h) => (
            <div
              key={h.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                flexWrap: "wrap",
                padding: "7px 10px",
                border: "1px solid var(--color-divider)",
                borderRadius: 8,
              }}
            >
              <span style={{ minWidth: 0, fontSize: 13 }}>
                {h.name}
                <span className="text-muted" style={{ marginLeft: 6, fontSize: 11.5 }}>
                  {[h.city, h.state].filter(Boolean).join(", ")}
                  {h.par > 0 && ` · par ${h.par}`}
                </span>
              </span>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ fontSize: 12 }}
                disabled={pending}
                onClick={() => importOne(h)}
              >
                <i className="ph ph-download-simple" /> {busyId === h.id ? "Adding…" : "Add to library"}
              </button>
            </div>
          ))}
          {/* ODbL 1.0 permits commercial use WITH attribution, so this is a
              condition of using the data rather than a courtesy — which is why
              it sits with the results instead of in a footer nobody reads. */}
          <p className="text-muted" style={{ fontSize: 11, margin: "2px 0 0" }}>
            {DIRECTORY_ATTRIBUTION}
          </p>
        </div>
      )}
    </div>
  );
}
