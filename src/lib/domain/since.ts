/**
 * HOW LONG AGO, in the words somebody would use.
 *
 * Written for "you asked them two days ago, no answer yet" — a sentence whose
 * whole job is to tell a person whether to go and chase somebody. That is the
 * only thing this has to be good at, and it decides every choice below.
 *
 * DELIBERATELY COARSE. "just now", "an hour ago", "2 days ago". Nothing here
 * says "1 day, 4 hours and 12 minutes", because the reader is deciding whether
 * to send a text, and no extra precision changes that decision.
 *
 * NO LIBRARY, and no `Intl.RelativeTimeFormat` either. The format is four
 * branches; the formatter would need a unit chosen by the same four branches
 * before it could be called, so it adds a dependency to the part that was
 * already written and not to the part that decides.
 *
 * `now` is a parameter so the whole thing is a pure function of two dates —
 * the rule this codebase applies to every date decision, and the reason its
 * tests do not have to wait for a clock.
 */
export function sinceWords(when: Date | string, now: Date = new Date()): string {
  const then = typeof when === "string" ? new Date(when) : when;
  // An unparseable date says nothing rather than "NaN days ago". The value
  // arrives from a serialized server payload, where a null has been seen.
  if (!(then instanceof Date) || Number.isNaN(then.getTime())) return "recently";

  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);

  /**
   * A FUTURE TIMESTAMP READS AS "just now", not as a negative.
   *
   * Clock skew between a server and a browser is real and small, and the
   * alternative — "asked in -3 seconds" — is the kind of thing that makes a
   * person distrust everything else on the screen.
   */
  if (seconds < 90) return "just now";

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minutes ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`;

  const days = Math.round(hours / 24);
  if (days < 14) return days === 1 ? "yesterday" : `${days} days ago`;

  const weeks = Math.round(days / 7);
  if (weeks < 9) return `${weeks} weeks ago`;

  /**
   * NO "a month ago" BRANCH, and its absence is deliberate.
   *
   * It was written, and the test above caught it being unreachable: weeks run
   * to eight, so anything old enough to reach this line is at least nine weeks
   * — which rounds to two months and never to one. A string no reader can ever
   * see is the same defect as a feature flag nothing reads, just smaller.
   */
  return `${Math.round(days / 30)} months ago`;
}
