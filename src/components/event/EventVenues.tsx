"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { setEventCourses } from "@/app/actions/courses";

/**
 * MORE THAN ONE COURSE (R3): the club's courses, each one a tick. Every kind of event may be played on two courses or
 * more (a rotating society, a member-guest over two layouts), so this is offered to all of them, not to one kind.
 *
 * It writes through the existing venue action (`setEventCourses`, which stores each tick as an `EventCourse` row), the
 * same press the club's Courses card has always used, so it saves as it is ticked and says so. It is the VENUES; the
 * event's first course is the picker above it, kept by the one Save. A refusal is said beside the list.
 */
export function EventVenues({
  courses,
  venueIds,
  disabled,
  addHref,
  ownCourseId,
}: {
  /** The event's own course as it is STORED: always one of its venues, drawn ticked and shut, and always sent. */
  ownCourseId: string;
  courses: Array<{ id: string; name: string; city: string }>;
  /** The courses this event is already played on. */
  venueIds: readonly string[];
  disabled: boolean;
  /** Where the club adds a course (Courses), or null while that screen is not shown. */
  addHref: string | null;
}) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(ownCourseId ? [...venueIds, ownCourseId] : venueIds));
  const [error, setError] = useState("");
  const [said, setSaid] = useState("");
  const [pending, startTransition] = useTransition();

  const toggle = (id: string) => {
    if (id === ownCourseId) return;
    const next = new Set(picked);
    if (ownCourseId) next.add(ownCourseId);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    const before = picked;
    setPicked(next);
    setError("");
    setSaid("");
    startTransition(async () => {
      const res = await setEventCourses([...next]);
      if (!res.ok) {
        setPicked(before);
        setError(res.error ?? "Couldn't update the courses for this event.");
        return;
      }
      setSaid(next.size === 1 ? "Saved: 1 course." : `Saved: ${next.size} courses.`);
    });
  };

  return (
    <fieldset data-event-venues style={{ border: "none", margin: 0, padding: 0, minWidth: 0 }}>
      <legend className="field-caption" style={{ padding: 0 }}>Courses this event is played on</legend>
      {courses.length === 0 ? (
        <p className="text-muted" style={{ fontSize: 13, margin: "4px 0 0" }}>The club has no courses yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          {courses.map((c) => (
            <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 44, minWidth: 0, overflowWrap: "anywhere" }}>
              <input type="checkbox" checked={picked.has(c.id)} disabled={disabled || pending || c.id === ownCourseId} onChange={() => toggle(c.id)} />
              <span style={{ minWidth: 0 }}>
                {c.name}
                {c.city ? <span className="text-muted"> · {c.city}</span> : null}
                {c.id === ownCourseId ? <span className="text-muted"> · the event&rsquo;s course</span> : null}
              </span>
            </label>
          ))}
        </div>
      )}
      <p className="text-muted" style={{ fontSize: 13, margin: "6px 0 0", lineHeight: 1.5 }}>
        Each round is played on one course, and you choose which on Rounds &amp; formats.
        {addHref ? (
          <>
            {" "}
            Not here? <Link href={addHref}>Add a course</Link> on the club&rsquo;s Courses.
          </>
        ) : null}
      </p>
      {said && !error && (
        <p className="text-muted" role="status" style={{ fontSize: 13, margin: "4px 0 0" }}>
          {said}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert" style={{ margin: "4px 0 0" }}>
          {error}
        </p>
      )}
    </fieldset>
  );
}
