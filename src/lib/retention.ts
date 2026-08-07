import { planFor } from "./plans";

/**
 * Which finished tournaments have outlived their plan's retention.
 *
 * Kept pure and separate from anything that deletes, because this decides what
 * gets destroyed and that deserves to be provable in isolation. The rule is
 * small; the consequence of getting it wrong is a club losing its
 * member-guest results.
 *
 * Four conditions, all required:
 *   - the plan actually has a retention window (paid plans keep everything)
 *   - the tournament is marked completed
 *   - it has a completion timestamp — no timestamp means no clock has started
 *   - that timestamp is further back than the window
 *
 * The third is the one that matters most in practice. Every tournament that
 * existed before retention was introduced has a null completedAt, so none of
 * them is ever selected. Guessing a completion time from updatedAt would have
 * made the feature's first act the deletion of real results.
 */

export interface RetainableEvent {
  id: string;
  status: string;
  completedAt: Date | null;
  /** The owning organization's plan key. */
  plan: string;
  /**
   * An explicit reprieve. Retention takes the later of the plan window and
   * this, so a hold can only extend — it can never shorten a window an
   * organizer was already promised.
   */
  retainUntil?: Date | null;
}

export interface PurgeDecision {
  id: string;
  purge: boolean;
  /** Why, in words — for the dry run and the audit log. */
  reason: string;
  /** Hours past the window, when it is past. */
  overdueHours: number;
}

export function retentionDecision(event: RetainableEvent, now: Date = new Date()): PurgeDecision {
  const hours = planFor(event.plan).retentionHours;

  if (hours === null) {
    return { id: event.id, purge: false, reason: "plan keeps data indefinitely", overdueHours: 0 };
  }
  if (event.status !== "completed") {
    return { id: event.id, purge: false, reason: "not finished", overdueHours: 0 };
  }
  if (!event.completedAt) {
    // Predates retention, or was completed before the timestamp existed.
    return { id: event.id, purge: false, reason: "no completion time recorded", overdueHours: 0 };
  }
  // An explicit hold outranks the plan window. Checked before the arithmetic
  // so a held tournament is never even a candidate.
  if (event.retainUntil && now.getTime() < new Date(event.retainUntil).getTime()) {
    return {
      id: event.id,
      purge: false,
      reason: `held until ${new Date(event.retainUntil).toISOString().slice(0, 10)}`,
      overdueHours: 0,
    };
  }

  const elapsedMs = now.getTime() - new Date(event.completedAt).getTime();
  const elapsedHours = elapsedMs / (1000 * 60 * 60);
  if (elapsedHours < hours) {
    const left = Math.max(0, hours - elapsedHours);
    return {
      id: event.id,
      purge: false,
      reason: `${left.toFixed(1)}h left of the ${hours}h window`,
      overdueHours: 0,
    };
  }

  return {
    id: event.id,
    purge: true,
    reason: `finished ${elapsedHours.toFixed(1)}h ago, past the ${hours}h window`,
    overdueHours: elapsedHours - hours,
  };
}

/** Everything due for deletion, with the reasoning attached. */
export function dueForPurge(events: RetainableEvent[], now: Date = new Date()): PurgeDecision[] {
  return events.map((e) => retentionDecision(e, now)).filter((d) => d.purge);
}

/**
 * How long a finished tournament has left, for telling an organizer while it
 * still matters. Null when nothing is counting down.
 */
export function hoursRemaining(event: RetainableEvent, now: Date = new Date()): number | null {
  const hours = planFor(event.plan).retentionHours;
  if (hours === null || event.status !== "completed" || !event.completedAt) return null;
  const elapsed = (now.getTime() - new Date(event.completedAt).getTime()) / (1000 * 60 * 60);
  const fromPlan = Math.max(0, hours - elapsed);
  // The later of the two, never the earlier — a hold extends, it never cuts
  // short a window somebody was already promised.
  if (!event.retainUntil) return fromPlan;
  const fromHold = (new Date(event.retainUntil).getTime() - now.getTime()) / (1000 * 60 * 60);
  return Math.max(0, fromPlan, fromHold);
}
