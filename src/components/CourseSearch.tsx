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
  /**
   * The row the arrow keys are on, or -1 for none.
   *
   * A list that appears as you type is a list you should be able to drive
   * from the keyboard — reaching for the mouse to accept the answer already
   * on screen is the slow half of this interaction, and on a phone-sized
   * screen the list is below the fold until you scroll to it.
   */
  const [active, setActive] = useState(-1);
  const [pending, startTransition] = useTransition();

  /**
   * Which search the results on screen belong to.
   *
   * Typing "Pebble" fires several searches and they can come back in any
   * order, so a slow answer for "Peb" must not replace the answer for
   * "Pebble". The counter is the only thing that makes as-you-type safe.
   */
  const seq = useRef(0);

  const search = () => {
    const q = query.trim();
    setError("");
    setNote(null);
    if (q.length < 3) {
      setError("Type at least three letters of the course name.");
      return;
    }
    const mine = (seq.current += 1);
    startTransition(async () => {
      // The catalogue first: free, instant, and it holds the course most of
      // the time.
      let res = await searchCourseDirectory(q, true);
      if (mine !== seq.current) return;

      /**
       * Nothing catalogued? Ask the directory itself before giving up.
       *
       * This used to be a second button, and a button is the wrong shape for
       * it: a club that types their course and reads "nothing matching that"
       * has already been told no, and pressing something afterwards feels
       * like arguing with the app. The screen should look properly before it
       * says no.
       *
       * Affordable because it only fires when the catalogue found NOTHING,
       * and only once the typing has settled — one metered request per
       * unanswered question, not one per keystroke.
       */
      if (res.ok && (res.hits ?? []).length === 0) {
        res = await searchCourseDirectory(q, false);
        if (mine !== seq.current) return;
      }

      if (!res.ok) {
        setError(res.error ?? "Couldn't reach the course directory.");
        setHits(null);
        return;
      }
      setHits(res.hits ?? []);
      // A new list means the old highlight pointed at a different course.
      setActive(-1);
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
    const t = setTimeout(search, 300);
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
            const list = hits ?? [];
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              if (list.length === 0) return;
              e.preventDefault();
              // Wraps, so holding one arrow never dead-ends.
              const step = e.key === "ArrowDown" ? 1 : -1;
              setActive((i) => (i + step + list.length) % list.length);
              return;
            }
            if (e.key === "Escape") {
              // Backs out of the list first, the query second — one Escape
              // should not throw away what you typed.
              e.preventDefault();
              if (active >= 0) setActive(-1);
              else setQuery("");
              return;
            }
            if (e.key === "Enter") {
              e.preventDefault();
              const chosen = list[active];
              // Enter accepts the highlighted row. With nothing highlighted
              // there is nothing left to do — the list is already the answer.
              if (chosen && !chosen.inLibrary) importOne(chosen);
            }
          }}
          placeholder="Course or town — results appear as you type"
          aria-label="Search for a course by name or town"
          role="combobox"
          aria-expanded={(hits ?? []).length > 0}
          aria-controls="course-search-results"
          aria-activedescendant={active >= 0 ? `course-hit-${active}` : undefined}
        />
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
        // "Fewer letters" first, because it is the advice that actually works.
        // Matching is substring-based, so a transposed letter — "heathewood"
        // for "Heatherwoode" — matches nothing however much of it you type,
        // and typing LESS is the recovery. Telling somebody to check their
        // spelling would be true and useless; naming the trick is not.
        // to stop trying.
        <p className="text-muted" style={{ fontSize: 11.5, margin: "8px 0 0", lineHeight: 1.5 }}>
          Nothing matching that. Try fewer letters — &ldquo;heathe&rdquo; finds Heatherwoode — or the
          town it is in. Or paste your card below; it takes about twenty seconds.
        </p>
      )}

      {hits !== null && hits.length > 0 && (
        <div id="course-search-results" role="listbox" style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
          {hits.map((h, i) => (
            <div
              key={h.id}
              id={`course-hit-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                flexWrap: "wrap",
                padding: "7px 10px",
                // The highlight has to be visible on both grounds, so it is
                // the accent border plus a tint rather than a grey wash.
                border:
                  i === active
                    ? "1px solid var(--color-accent)"
                    : "1px solid var(--color-divider)",
                background: i === active ? "var(--color-surface)" : undefined,
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
