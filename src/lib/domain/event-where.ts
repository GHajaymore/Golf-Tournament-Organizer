import { courseModeOf } from "./venue";

/**
 * WHERE AN EVENT IS PLAYED, as one of four answers (R3). The Event screen asks three questions (one course, more
 * than one, the players arrange their own) and this is the ONE place that reads them back from what is stored:
 *
 *   "open"    the players arrange their own: `courseModeOf` says so (never a second reading of `courseMode`).
 *   "several" two or more venues (`EventCourse` rows).
 *   "one"     a course is named, by id, by name, or as the event's single venue.
 *   "unset"   nothing yet. On Event this reads "Required before launch"; only Create may say "Decide later".
 *
 * It takes counts of what is stored and decides nothing about what to store. Score entry (R12) reads "open"
 * through `courseModeOf` too, so the two cannot disagree.
 */
export type Where = "one" | "several" | "open" | "unset";

export function whereOf(
  event: { courseMode: string | null | undefined; courseId: string | null | undefined; course: string | null | undefined },
  venueCount: number,
): Where {
  if (courseModeOf(event.courseMode) === "open") return "open";
  if (venueCount >= 2) return "several";
  if (event.courseId || (event.course ?? "").trim() || venueCount === 1) return "one";
  return "unset";
}
