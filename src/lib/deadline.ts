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

/**
 * Whether the deadline has passed.
 *
 * Compared at day granularity, and the day itself counts: a deadline of the
 * 14th means the end of the 14th, not midnight as it begins. Everyone who has
 * ever entered a competition assumes that, and the other reading loses a day
 * of entries and generates a phone call.
 *
 * A deadline that isn't a date — free text from before the date picker — has
 * not passed. Guessing at "Sat 14 Jun" would close things on a date nobody set.
 */
export function deadlinePassed(deadline: string, now: Date = new Date()): boolean {
  if (!isIsoDate(deadline)) return false;
  return deadline.trim() < todayIso(now);
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
