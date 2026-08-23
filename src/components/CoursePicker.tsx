"use client";
import { useMemo, useRef, useState } from "react";
import { rankCourses, tierOf, Tier } from "@/lib/domain/course-ranking";

/**
 * Choosing a course, in the one way this app chooses a course.
 *
 * Every screen that picked a venue had rolled its own control — a bare
 * `<select>` here, a text field there — so the same act looked and behaved
 * differently depending on where you happened to be standing. A club with
 * thirty courses in its library got a thirty-item dropdown with no way to
 * narrow it, while the directory search two panels away had filtering,
 * ranking and arrow keys. That is not a missing feature so much as the app
 * disagreeing with itself about what picking a course is.
 *
 * So: type to narrow, arrows to move, Enter to take it, Escape to back out,
 * and the same ranking the directory search uses — because "which course did
 * I mean" should not get two answers.
 *
 * It renders as a plain list rather than a native `<select>` for one reason
 * that matters: a native option cannot show a course's town beneath its name,
 * and a club with a Cincinnati and a Columbus "Hillcrest" needs to see which
 * is which. Everything a golfer needs to tell two courses apart is on the row.
 */

export interface CourseOption {
  id: string;
  name: string;
  city?: string;
  /** ISO country, for a library that has reached beyond one country. */
  country?: string;
  /** False when the course still needs its card typed in. Shown, never hidden:
   *  it is pickable, it just cannot be scored on yet. */
  hasCard?: boolean;
}

export interface CoursePickerProps {
  options: readonly CourseOption[];
  /** The chosen course id, or "" for none. */
  value: string;
  onChange: (courseId: string) => void;
  label?: string;
  /** What the empty choice reads as. Omit to require a choice. */
  noneLabel?: string;
  disabled?: boolean;
  /** Shown under the control — a caller's note about what the choice affects. */
  hint?: string;
}

export function CoursePicker({
  options,
  value,
  onChange,
  label = "Course",
  noneLabel,
  disabled = false,
  hint,
}: CoursePickerProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const chosen = options.find((o) => o.id === value) ?? null;

  /**
   * The rows on offer, narrowed by whatever has been typed.
   *
   * An empty query shows everything in the library's own order — a club that
   * has just opened the list is browsing, not searching, and reordering under
   * them would be the control second-guessing a question they have not asked.
   */
  const shown = useMemo(() => {
    const q = query.trim();
    if (!q) return [...options].slice(0, 50);
    /**
     * Narrowed, not merely reordered.
     *
     * Ranking alone left every course in the list with the good matches on
     * top, which is the wrong answer to "narrow it down": typing "crest" in
     * a library of thirty still showed thirty rows, and the reader has to
     * work out where the matches stop. Anything the query does not reach is
     * dropped.
     */
    const ranked = rankCourses(options, q, (o) => o.hasCard !== false).filter(
      (o) => tierOf({ name: o.name, city: o.city ?? "" }, q) !== Tier.NoMatch,
    );
    return ranked.slice(0, 50);
  }, [options, query]);

  const pick = (id: string) => {
    onChange(id);
    setQuery("");
    setOpen(false);
    setActive(-1);
    inputRef.current?.blur();
  };

  const describe = (o: CourseOption): string =>
    [o.city, o.country && o.country !== "US" ? o.country : ""].filter(Boolean).join(", ");

  return (
    <div className="field" style={{ position: "relative" }}>
      <label>{label}</label>
      <input
        ref={inputRef}
        className="input"
        disabled={disabled}
        // Shows what is chosen when idle, and what is being typed when not.
        // A picker that forgets its own answer the moment you touch it is the
        // commonest way one of these goes wrong.
        value={open ? query : (chosen?.name ?? "")}
        placeholder={chosen ? chosen.name : (noneLabel ?? "Type to find a course")}
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onBlur={() => {
          // Deferred, so a click on a row lands before the list disappears.
          blurTimer.current = setTimeout(() => setOpen(false), 120);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            if (shown.length === 0) return;
            e.preventDefault();
            setOpen(true);
            const step = e.key === "ArrowDown" ? 1 : -1;
            setActive((i) => (i + step + shown.length) % shown.length);
            return;
          }
          if (e.key === "Enter") {
            e.preventDefault();
            const row = shown[active];
            if (row) pick(row.id);
            return;
          }
          if (e.key === "Escape") {
            e.preventDefault();
            // Closes the list first and keeps the choice — Escape should never
            // be the thing that clears a venue somebody set last week.
            setOpen(false);
            setActive(-1);
            setQuery("");
          }
        }}
        role="combobox"
        aria-expanded={open}
        aria-controls="course-picker-list"
        aria-activedescendant={active >= 0 ? `course-option-${active}` : undefined}
        aria-label={label}
      />

      {open && (
        <div
          id="course-picker-list"
          role="listbox"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 20,
            marginTop: 4,
            maxHeight: 260,
            overflowY: "auto",
            background: "var(--color-surface)",
            border: "1px solid var(--color-divider)",
            borderRadius: 8,
          }}
          // Keeps the blur from firing before the click registers.
          onMouseDown={() => blurTimer.current && clearTimeout(blurTimer.current)}
        >
          {noneLabel && (
            <button
              type="button"
              role="option"
              aria-selected={value === ""}
              className="btn btn-ghost"
              style={{ width: "100%", justifyContent: "flex-start", fontSize: 13 }}
              onClick={() => pick("")}
            >
              {noneLabel}
            </button>
          )}
          {shown.map((o, i) => (
            <button
              key={o.id}
              id={`course-option-${i}`}
              type="button"
              role="option"
              aria-selected={o.id === value}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(o.id)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "7px 10px",
                fontSize: 13,
                border: "none",
                borderLeft:
                  i === active ? "2px solid var(--color-accent)" : "2px solid transparent",
                background: i === active ? "var(--color-bg)" : "transparent",
                color: "var(--color-text)",
                cursor: "pointer",
              }}
            >
              {o.name}
              <span className="text-muted" style={{ marginLeft: 6, fontSize: 11.5 }}>
                {describe(o)}
                {/* Said here rather than discovered at scoring time, when the
                    round is already under way and the card is missing. */}
                {o.hasCard === false && " · no card yet"}
              </span>
            </button>
          ))}
          {shown.length === 0 && (
            <p className="text-muted" style={{ fontSize: 12, margin: 0, padding: "8px 10px", lineHeight: 1.5 }}>
              None of your courses match that. Try fewer letters, or add the course to your library
              first.
            </p>
          )}
        </div>
      )}

      {hint && (
        <p className="text-muted" style={{ fontSize: 11.5, margin: "4px 0 0", lineHeight: 1.5 }}>
          {hint}
        </p>
      )}
    </div>
  );
}
