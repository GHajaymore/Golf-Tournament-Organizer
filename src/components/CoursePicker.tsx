"use client";
import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { rankCourses, tierOf, Tier } from "@/lib/domain/course-ranking";
import { Icon } from "./Icon";
import {
  searchCourseDirectory,
  importCourseFromDirectory,
  type DirectorySearchHit,
} from "@/app/actions/courses";

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

/**
 * One row of the open list.
 *
 * A union rather than five render blocks, so "what is in the list" and "what
 * the arrow keys can reach" are the same question with one answer.
 */
type PickerRow =
  | { kind: "none"; label: string }
  | { kind: "extra"; id: string; label: string }
  | { kind: "course"; course: CourseOption }
  | { kind: "directory"; hit: DirectorySearchHit }
  | { kind: "new"; name: string };

/** Stable across a re-render, and distinct between row kinds that can share an id. */
function rowKey(row: PickerRow, i: number): string {
  switch (row.kind) {
    case "none":
      return "row-none";
    case "extra":
      return `row-extra-${row.id}`;
    case "course":
      return `row-course-${row.course.id}`;
    case "directory":
      return `row-directory-${row.hit.id}`;
    case "new":
      return `row-new-${i}`;
  }
}

/**
 * What a row reads as.
 *
 * The secondary line is the whole reason this is a list of buttons rather than
 * a native `<select>`: a club with a Cincinnati and a Columbus "Hillcrest"
 * needs to see which is which, and a native option cannot carry the town.
 */
function rowLabel(
  row: PickerRow,
  describe: (o: CourseOption) => string,
  adding: string,
): React.ReactNode {
  const muted = (text: string) => (
    <span className="text-muted" style={{ marginLeft: 6, fontSize: 11.5 }}>
      {text}
    </span>
  );
  switch (row.kind) {
    case "none":
      return row.label;
    case "extra":
      return row.label;
    case "course":
      return (
        <>
          {row.course.name}
          {/* Said here rather than discovered at scoring time, when the round
              is already under way and the card is missing. */}
          {muted(`${describe(row.course)}${row.course.hasCard === false ? " · no card yet" : ""}`)}
        </>
      );
    case "directory":
      return (
        <>
          {row.hit.name}
          {muted(
            [
              [row.hit.city, row.hit.state, row.hit.country].filter(Boolean).join(", "),
              row.hit.par > 0 ? "" : " · no card yet",
              adding === row.hit.id ? " · adding…" : "",
            ].join(""),
          )}
        </>
      );
    case "new":
      return (
        <>
          <Icon name="plus" /> Use &ldquo;{row.name}&rdquo;
        </>
      );
  }
}

export interface CoursePickerProps {
  options: readonly CourseOption[];
  /** The chosen course id, or "" for none. */
  value: string;
  onChange: (courseId: string) => void;
  label?: string;
  /** What the empty choice reads as. Omit to require a choice. */
  noneLabel?: string;
  /**
   * Choices that are not courses — "enter one manually", "no fixed course".
   *
   * Kept out of the filter on purpose. They are actions rather than venues,
   * so narrowing a list of courses must not hide them: somebody typing a name
   * that is not in the library is exactly the person who needs "enter it
   * manually", and that is the moment it would disappear.
   */
  extras?: ReadonlyArray<{ id: string; label: string }>;
  /**
   * Look beyond the club's own courses when they do not have it.
   *
   * A library of four courses is not an answer to "where are we playing" for
   * a society that plays somewhere new every month. With this on, a query
   * the library cannot satisfy falls through to the catalogue of every
   * course the app knows about, and picking one adds it to the library on
   * the way past.
   *
   * REQUIRED, WITH NO DEFAULT, and that is the whole point of it being here.
   *
   * It was optional and therefore off unless remembered, and two of the five
   * call sites had forgotten: the round's venue picker and score entry both
   * asked "where are we playing" and silently offered less than Tournament
   * details did. Nothing reported it, because a missing search is not an
   * error — it is just a shorter list.
   *
   * Off is a legitimate answer. Score entry says `false` deliberately, and
   * says why. What is not legitimate is answering by omission, so the type
   * makes every caller state one, and a new screen cannot inherit the wrong
   * answer from a default nobody chose. Same reason `NavItem.tier` carries no
   * default.
   */
  searchDirectory: boolean;
  /**
   * Take a name that is in neither list.
   *
   * The last rung. A club playing a course nobody has catalogued still has
   * to be able to say where they played, and a picker whose final answer is
   * "not found" makes the app the obstacle.
   */
  onEnterNew?: (name: string) => void;
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
  extras = [],
  searchDirectory = false,
  onEnterNew,
  disabled = false,
  hint,
}: CoursePickerProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [found, setFound] = useState<DirectorySearchHit[]>([]);
  const [adding, setAdding] = useState("");
  const [, startAdd] = useTransition();
  const seq = useRef(0);

  /**
   * A course taken from the DIRECTORY, remembered by name.
   *
   * `options` is a server prop, fixed at page load, so a course picked out of
   * the directory is never in it — it was imported a moment ago, or it lives
   * in a library this reader cannot see. `chosen` is therefore null, and the
   * box went blank: the venue was set, the form knew it, and the one field
   * the screen will not let you past looked untouched.
   *
   * Read off /match/new on 2026-09-11, with the blocker underneath already
   * advanced from "Say where you're playing" to the next question. Nothing
   * was broken except what the reader could see, which is the half that
   * decides whether they try again.
   */
  const [takenFromDirectory, setTakenFromDirectory] = useState<{ id: string; name: string } | null>(null);

  const chosen =
    options.find((o) => o.id === value) ??
    (takenFromDirectory && takenFromDirectory.id === value ? takenFromDirectory : null);
  // An extra choice is a real answer too, and the box has to say so rather
  // than going blank the moment somebody picks "no fixed course".
  const chosenExtra = extras.find((x) => x.id === value && x.id !== "") ?? null;

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

  /**
   * Ask the catalogue only when the club's own list has nothing.
   *
   * Order matters: a club that owns the course should never be shown a
   * directory copy of it to import a second time. And the lookup waits for
   * the typing to settle, so it costs one query per question rather than one
   * per keystroke — the catalogue read is cheap but it is not free.
   */
  useEffect(() => {
    const q = query.trim();
    if (!searchDirectory || q.length < 3 || shown.length > 0) {
      setFound([]);
      return;
    }
    const mine = (seq.current += 1);
    const t = setTimeout(async () => {
      const res = await searchCourseDirectory(q, true);
      // A query the reader has already typed past.
      if (mine !== seq.current) return;
      setFound(res.ok ? (res.hits ?? []).filter((h) => !h.inLibrary).slice(0, 8) : []);
    }, 300);
    return () => clearTimeout(t);
  }, [query, searchDirectory, shown.length]);

  /**
   * EVERY ROW IN THE LIST, IN THE ORDER IT IS SHOWN — one list, not five.
   *
   * The listbox used to be assembled from five separate renderings: the
   * "none" row, the `extras`, the club's own courses, the directory hits and
   * the "Use «what you typed»" row. Only the third of those carried an
   * `id`, was counted by the arrow keys, or could be reached by Enter — so
   * `aria-activedescendant` could only ever name a course the club already
   * owned.
   *
   * That contradicted this component's own opening paragraph, which promises
   * "type to narrow, arrows to move, Enter to take it, Escape to back out",
   * and it broke worst in the commonest state there is: a club with no
   * courses saved yet has `shown.length === 0`, so the arrow handler returned
   * immediately and the keyboard did NOTHING while three choices sat visibly
   * open on the screen. Walked on 2026-09-11 on a brand-new club.
   *
   * The directory results are the sharper half. "Results appear as you type"
   * is the assistance this control exists to give, and reaching them needed a
   * mouse.
   *
   * So the rows are built once, here, and everything downstream — the arrow
   * keys, Enter, the ids, the highlight — reads this one array. A row kind
   * added later is navigable because it is in the list, rather than because
   * somebody remembered to wire it up.
   */
  const rows = useMemo(() => {
    const out: PickerRow[] = [];
    if (noneLabel) out.push({ kind: "none", label: noneLabel });
    for (const x of extras) out.push({ kind: "extra", id: x.id, label: x.label });
    for (const o of shown) out.push({ kind: "course", course: o });
    for (const h of found) out.push({ kind: "directory", hit: h });
    const typed = query.trim();
    if (onEnterNew && typed.length >= 3) out.push({ kind: "new", name: typed });
    return out;
  }, [noneLabel, extras, shown, found, onEnterNew, query]);

  const pick = (id: string) => {
    onChange(id);
    setQuery("");
    setOpen(false);
    setActive(-1);
    inputRef.current?.blur();
  };


  /**
   * Add a directory course to the library, then choose it.
   *
   * One motion, because the club asked for a venue and not for an import.
   * If the import fails the picker stays open with the query intact rather
   * than closing on a choice that did not happen.
   */
  const takeFromDirectory = (hit: DirectorySearchHit) => {
    setAdding(hit.id);
    startAdd(async () => {
      const res = await importCourseFromDirectory(hit.id);
      setAdding("");
      /**
       * THE ID IS THE ANSWER, WHETHER OR NOT THE IMPORT HAPPENED.
       *
       * "Already in your course library" comes back as `ok: false` — correct,
       * nothing was added — WITH the existing course's id attached. Requiring
       * `ok` threw that away, so the click did nothing at all: no venue
       * chosen, no message, the field still empty. A dead control on the one
       * field the form will not let you past.
       *
       * It happens whenever the list this picker SHOWS and the library the
       * import writes to are scoped differently — an organizer whose access
       * to an event comes from an Account rather than an organization
       * membership is exactly that person, and is how this was found on
       * 2026-09-11.
       *
       * The caller asked for a venue, not for an import. A course that is
       * already there is the best possible outcome of that question.
       */
      if (res.courseId) {
        // Before `pick`, so the box has a name to show the moment it closes.
        setTakenFromDirectory({ id: res.courseId, name: hit.name });
        pick(res.courseId);
      }
    });
  };

  /**
   * Taking whichever row is under the cursor or the keyboard.
   *
   * The one place a row's meaning turns into an action, so the mouse and the
   * keyboard cannot come to disagree about what a row does — which is how the
   * directory rows ended up clickable and un-pressable.
   */
  const choose = (row: PickerRow) => {
    switch (row.kind) {
      case "none":
        pick("");
        return;
      case "extra":
        pick(row.id);
        return;
      case "course":
        pick(row.course.id);
        return;
      case "directory":
        // Guarded, or Enter on a row already importing would start a second.
        if (adding === "") takeFromDirectory(row.hit);
        return;
      case "new":
        onEnterNew?.(row.name);
        setOpen(false);
        setQuery("");
        setActive(-1);
        return;
    }
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
        value={open ? query : (chosen?.name ?? chosenExtra?.label ?? "")}
        placeholder={chosenExtra?.label ?? chosen?.name ?? noneLabel ?? "Type to find a course"}
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
            // Every row, not only the club's own courses — see `rows`.
            if (rows.length === 0) return;
            e.preventDefault();
            setOpen(true);
            const step = e.key === "ArrowDown" ? 1 : -1;
            setActive((i) => (i + step + rows.length) % rows.length);
            return;
          }
          if (e.key === "Enter") {
            e.preventDefault();
            const row = rows[active];
            if (row) choose(row);
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
        // The list is filtered by what is typed, which a screen reader should be
        // told before the reader wonders why the options keep changing.
        aria-autocomplete="list"
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
          {rows.map((row, i) => {
            const on = i === active;
            /* The directory's own heading, printed once, before the first row
               that came from it. Adding a course to the library is a different
               act from choosing one already in it, and the row does both. */
            const heading =
              row.kind === "directory" && rows[i - 1]?.kind !== "directory" ? (
                <p
                  className="text-muted"
                  style={{ fontSize: 11, margin: 0, padding: "6px 10px 2px", lineHeight: 1.4 }}
                >
                  Not in your courses yet — from the course directory
                </p>
              ) : null;

            const selected =
              row.kind === "none"
                ? value === ""
                : row.kind === "extra"
                  ? row.id === value
                  : row.kind === "course"
                    ? row.course.id === value
                    : false;

            return (
              <Fragment key={rowKey(row, i)}>
                {heading}
                <button
                  id={`course-option-${i}`}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  disabled={row.kind === "directory" && adding !== ""}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(row)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "7px 10px",
                    fontSize: 13,
                    border: "none",
                    borderLeft: on ? "2px solid var(--color-accent)" : "2px solid transparent",
                    background: on ? "var(--color-bg)" : "transparent",
                    color: "var(--color-text)",
                    cursor: "pointer",
                  }}
                >
                  {rowLabel(row, describe, adding)}
                </button>
              </Fragment>
            );
          })}

          {shown.length === 0 && found.length === 0 && !onEnterNew && (
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
