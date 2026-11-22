/**
 * "SAME AS ROUND 1 AT THIS COURSE" (R4; the golf professional, Q7): a derivation, never a column. Tees are chosen for the
 * event, a flight or a player (`teeIdFor`), not per round, so a round at a course the event has already played inherits the
 * tee choice made for the first round there. This names that round; it does no arithmetic, and sits in its own file because
 * `handicap.ts` is arithmetic.
 */
export interface RoundAtCourse {
  id: string;
  /** The course the round is played on: its own, else the event's home course. Null when none is named. */
  courseId: string | null;
}

/** The earliest of `before` (the rounds that come first, in play order) played at `courseId`, or null when this is the first there. */
export function inheritedRoundTee(before: readonly RoundAtCourse[], courseId: string | null): RoundAtCourse | null {
  if (courseId === null) return null;
  return before.find((r) => r.courseId === courseId) ?? null;
}
