/**
 * Who was promoted off the waitlist, and who has not been heard from since.
 *
 * The promotion itself is final: the moment a place opens the next player is in
 * the field, and their slot is not held vacant pending a reply. A golf field is
 * a fixed number of tee times, and keeping one empty for two days while
 * somebody makes up their mind costs the club a player — the opposite of what a
 * waitlist is for. So there is no provisional state here, nothing expires, and
 * none of the forty-odd places that ask "is this player in the field" had to
 * learn a third answer.
 *
 * What is left is a human problem rather than a state machine: somebody who
 * signed up weeks ago, was told the field was full, and has now been told they
 * are in, may not have read the email. The organizer needs to know who to
 * chase, and that is all this decides.
 */

/**
 * How long to leave somebody before the prompt turns into a nudge.
 *
 * Two days is what the email asks for ("tell the organizer within 48 hours if
 * you can't play"), so the screen agrees with the message rather than inventing
 * a different deadline for the same thing.
 */
export const PROMOTION_FOLLOW_UP_MS = 48 * 60 * 60 * 1000;

/** How long the badge stays on screen once it stops being urgent. */
const PROMOTION_VISIBLE_MS = 14 * 24 * 60 * 60 * 1000;

export type PromotionState =
  /** Never on the waitlist, or promoted long enough ago to be old news. */
  | { kind: "none" }
  /** Recently promoted, still inside the window they were asked to reply in. */
  | { kind: "recent"; label: string }
  /** Promoted longer ago than the email asked them to reply in. */
  | { kind: "overdue"; label: string };

/**
 * What to show an organizer about a promoted player.
 *
 * Takes `now` rather than reading the clock, so the boundaries are testable
 * without freezing time — the same reason the rest of `src/lib/domain` does.
 *
 * A promotion eventually stops being interesting. Without the upper bound, a
 * club that ran a waitlist last season would carry a permanent row of badges
 * into this one, and a badge that is always on is a badge nobody sees.
 */
export function promotionState(
  promotedAt: Date | string | null | undefined,
  now: number,
): PromotionState {
  if (!promotedAt) return { kind: "none" };

  const at = promotedAt instanceof Date ? promotedAt.getTime() : Date.parse(String(promotedAt));
  // An unparseable value is not a reason to show a broken badge.
  if (!Number.isFinite(at)) return { kind: "none" };

  const elapsed = now - at;
  // A clock skew between server and browser can put this slightly in the
  // future; treat that as "just now" rather than as a negative age.
  if (elapsed < 0) return { kind: "recent", label: "Promoted just now" };
  if (elapsed > PROMOTION_VISIBLE_MS) return { kind: "none" };

  const label = `Promoted ${describeAge(elapsed)}`;
  return elapsed > PROMOTION_FOLLOW_UP_MS ? { kind: "overdue", label } : { kind: "recent", label };
}

/** Plain English, coarse on purpose — the exact minute has never mattered here. */
function describeAge(ms: number): string {
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours < 1) return "just now";
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}
