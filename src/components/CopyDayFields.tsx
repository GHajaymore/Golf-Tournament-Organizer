"use client";
import { useId } from "react";

/**
 * THE TWO DAYS A COPY IS GIVEN: the first day and, if more than one, the last.
 *
 * Every door to a copy of a past tournament uses this (Copy last event, Start
 * from on /choose, the switcher), so they ask the same question in the same
 * words and `cloneEvent` moves the entry window and the rounds by the same
 * distance whichever door was used (`copiedCalendar`). Setup audit item 8.
 */
export function CopyDayFields({
  startOn,
  endOn,
  onStartOn,
  onEndOn,
  today,
}: {
  startOn: string;
  endOn: string;
  onStartOn: (v: string) => void;
  onEndOn: (v: string) => void;
  /** Today at the club, the earliest day the copy may be given. Omitted where the page does not know it; the action still refuses a day already gone. */
  today?: string;
}) {
  const fid = useId();
  return (
    <>
      <div className="field">
        <label htmlFor={`${fid}-start`}>First day</label>
        <input
          id={`${fid}-start`}
          className="input"
          type="date"
          min={today}
          value={startOn}
          onChange={(e) => onStartOn(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor={`${fid}-end`}>Last day (if more than one)</label>
        <input
          id={`${fid}-end`}
          className="input"
          type="date"
          min={startOn || today}
          value={endOn}
          onChange={(e) => onEndOn(e.target.value)}
        />
      </div>
    </>
  );
}
