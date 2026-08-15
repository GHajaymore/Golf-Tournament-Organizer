/**
 * A deadline the organizer can close early or extend past.
 *
 * The same rule governs registration closing and a round's completion
 * deadline, so it lives in one place. Both had the same two problems: the date
 * was ignored, and there was no way to say "we're taking one more" without
 * editing the date and pretending it had always been that.
 *
 * The override wins in both directions, deliberately. A deadline gets extended
 * by a word at the bar long before anyone edits it in software, and an app
 * that argues with the person running the event is an app they work around.
 */

export type DeadlineState = "open" | "closed" | "closed-manual" | "extended";

export interface DeadlineStatus {
  state: DeadlineState;
  /** Whether the thing this deadline governs is still permitted. */
  open: boolean;
  /** Whether an explicit decision is in force, rather than the date. */
  overridden: boolean;
}

/** Whether a stored deadline is a date this can reason about. */
export function isIsoDate(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v.trim());
}

/** Today, as the same yyyy-mm-dd string a date input produces. */
export function todayIso(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The date a stored deadline names, as ISO, or "" if it doesn't name one.
 *
 * Two forms are accepted, and only two. ISO is what a date input produces.
 * "Jun 1, 2026" is what THIS APP wrote into the column for a year: the setup
 * screen ran the picker's ISO value through `toLocaleDateString` before saving,
 * so every deadline set through the UI was stored in a shape `deadlinePassed`
 * could not read — the public form stayed open forever while printing the
 * deadline it was ignoring.
 *
 * Recognising the app's own output is not guesswork; it is unambiguous, carries
 * a year, and is the exact string the picker generated. Anything else — "Sat 14
 * Jun", "end of the month", "" — still names no date, and closing entries on a
 * date nobody set would be worse than leaving them open.
 *
 * Parsed by hand rather than through `Date`, which would apply the server's
 * timezone to a date that has none and can roll a deadline to the day before.
 */
export function parseDeadlineIso(deadline: string): string {
  const value = (deadline ?? "").trim();
  if (isIsoDate(value)) {
    // Shape is not a date. `isIsoDate` is a pattern check, so "2026-13-45"
    // passes it — and deadlines are compared as STRINGS, where a month of 13
    // sorts perfectly happily and closes entries on a day that does not exist.
    const [, month, day] = value.split("-").map(Number);
    if (month < 1 || month > 12 || day < 1 || day > 31) return "";
    return value;
  }

  const m = /^([A-Za-z]{3})[a-z]* (\d{1,2}), (\d{4})$/.exec(value);
  if (!m) return "";
  const month = MONTHS.findIndex((n) => n.toLowerCase() === m[1].toLowerCase());
  const day = Number(m[2]);
  if (month < 0 || day < 1 || day > 31) return "";
  return `${m[3]}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * A deadline as a person reads it: "Jun 1, 2026".
 *
 * Free text is returned unchanged — whatever the organizer typed is what the
 * screen should say.
 */
export function formatDeadline(deadline: string): string {
  const iso = parseDeadlineIso(deadline);
  if (!iso) return (deadline ?? "").trim();
  const [y, m, d] = iso.split("-");
  return `${MONTHS[Number(m) - 1]} ${Number(d)}, ${y}`;
}

/**
 * Whether the deadline has passed.
 *
 * Compared at day granularity, and the day itself counts: a deadline of the
 * 14th means the end of the 14th, not midnight as it begins. Everyone who has
 * ever entered a competition assumes that, and the other reading loses a day
 * of entries and generates a phone call.
 *
 * A deadline that names no date has not passed — see `parseDeadlineIso`.
 */
export function deadlinePassed(deadline: string, now: Date = new Date()): boolean {
  const iso = parseDeadlineIso(deadline);
  if (!iso) return false;
  return iso < todayIso(now);
}

export function deadlineState(
  deadline: string,
  override: boolean | null,
  now: Date = new Date(),
): DeadlineStatus {
  if (override === true) {
    return { state: "closed-manual", open: false, overridden: true };
  }
  const passed = deadlinePassed(deadline, now);
  if (override === false && passed) {
    return { state: "extended", open: true, overridden: true };
  }
  if (passed) {
    return { state: "closed", open: false, overridden: false };
  }
  // An override of `false` before the deadline is a no-op, not a second kind
  // of open — there is nothing to extend past yet.
  return { state: "open", open: true, overridden: false };
}
