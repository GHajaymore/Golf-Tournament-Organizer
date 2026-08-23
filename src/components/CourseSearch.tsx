"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  searchCourseDirectory,
  importCourseFromDirectory,
  type DirectorySearchHit,
} from "@/app/actions/courses";
import { DIRECTORY_ATTRIBUTION } from "@/lib/domain/course-directory";

/**
 * Look a course up instead of typing fifty-four numbers.
 *
 * The rung above pasting: type a few letters, pick the course you play, and
 * its card and rated tee sets land in the club's library.
 *
 * RESULTS ARRIVE AS YOU TYPE. Pressing a button to see whether a search
 * found anything is a whole extra decision on a screen a club meets once,
 * while they are still deciding whether this app knows about their course at
 * all. The answer should just appear.
 *
 * Coverage is worldwide — the directory is OpenStreetMap underneath, and the
 * catalogue behind this holds courses from every continent, not just US ones
 * as it did when this screen was written. It is uneven rather than complete,
 * which is why this sits ABOVE pasting and typing rather than replacing them,
 * and why finding nothing is worded as an ordinary answer.
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
  const [hits, setHits] = useState<DirectorySearchHit[] | null>(null);
  const [error, setError] = useState("");
  /** What the last import did, in the club's terms. */
  const [note, setNote] = useState<{ kind: "ok" | "partial"; text: string } | null>(null);
  const [busyId, setBusyId] = useState("");
  const [pending, startTransition] = useTransition();

  /**
   * Which search the results on screen belong to.
   *
   * Typing "Pebble" fires several searches and they can come back in any
   * order, so a slow answer for "Peb" must not replace the answer for
   * "Pebble". The counter is the only thing that makes as-you-type safe.
   */
  const seq = useRef(0);

  const search = (localOnly = false) => {
    const q = query.trim();
    setError("");
    setNote(null);
    if (q.length < 3) {
      setError("Type at least three letters of the course name.");
      return;
    }
    const mine = (seq.current += 1);
    startTransition(async () => {
      const res = await searchCourseDirectory(q, localOnly);
      // A search the user has already typed past.
      if (mine !== seq.current) return;
      if (!res.ok) {
        setError(res.error ?? "Couldn't reach the course directory.");
        setHits(null);
        return;
      }
      setHits(res.hits ?? []);
    });
  };

  /**
   * Search a beat after the typing stops, not on every keystroke.
   *
   * 300ms is long enough that "Pebble Beach" is one search rather than
   * twelve, and short enough that it still feels like the list is following
   * along. Under three letters the box is cleared rather than searched:
   * two letters match half the world and the answer would be noise.
   */
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      seq.current += 1;
      setHits(null);
      setError("");
      return;
    }
    const t = setTimeout(() => search(true), 300);
    return () => clearTimeout(t);
    // `search` is stable enough for this: it reads `query` from the same
    // render this effect belongs to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const importOne = (hit: DirectorySearchHit) => {
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
        ? `, with ${res.teeCount} rated tee ${res.teeCount === 1 ? "set" : "sets"}`
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
              // Names the missing thing and where to put it, without naming a
              // control that may not be on this screen — this component is
              // rendered both beside the course library and on score entry.
              text: `${hit.name} added${tees}, but without a card. ${res.cardProblem ?? "The directory has no usable one."} Add its par and stroke index before scoring a round there.`,
            },
      );
      if (res.courseId) onImported?.(res.courseId);
      router.refresh();
    });
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: "block", marginBottom: 6 }}>Find a course</label>
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
          placeholder="Course or town — results appear as you type"
          aria-label="Search for a course by name"
        />
        {/* Typing reads the catalogue; this asks the directory itself, which
            is the metered call. Worth a press rather than a keystroke. */}
        <button type="button" className="btn btn-secondary" onClick={() => search()} disabled={pending}>
          <i className="ph ph-magnifying-glass" /> {pending && !busyId ? "Searching…" : "Search the full directory"}
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
        // An ordinary answer, not a failure. Coverage is worldwide but uneven,
        // so the honest line is "not in the directory", not "not in the US" —
        // which is what this said, and which told every club outside America
        // to stop trying.
        <p className="text-muted" style={{ fontSize: 11.5, margin: "8px 0 0", lineHeight: 1.5 }}>
          Nothing matching that. Try the town it is in, or paste your card below and it takes
          about twenty seconds.
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
                  {/* Country included: with a worldwide directory, "Royal Golf
                      Club" is several real courses, and a non-US row has no
                      state to tell them apart with. */}
                  {[h.city, h.state, h.country].filter(Boolean).join(", ")}
                  {/* Par doubles as "does it arrive with a card". A course
                      without one still imports — name, city and rated tees —
                      but the club has a card to enter before they can score
                      a round there, and finding that out after adding it is
                      the wrong moment. */}
                  {h.par > 0 ? ` · par ${h.par}` : " · no card yet"}
                </span>
              </span>
              {h.inLibrary ? (
                <span className="tag tag-neutral" style={{ fontSize: 11.5 }}>
                  <i className="ph ph-check" /> In your library
                </span>
              ) : (
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ fontSize: 12 }}
                  disabled={pending}
                  onClick={() => importOne(h)}
                >
                  <i className="ph ph-download-simple" /> {busyId === h.id ? "Adding…" : "Add to library"}
                </button>
              )}
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
