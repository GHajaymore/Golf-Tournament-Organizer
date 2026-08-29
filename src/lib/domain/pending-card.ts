/**
 * A card that has not reached the server yet.
 *
 * The scoring screen writes the whole card on a 600ms debounce and, until now,
 * kept it nowhere else. A failed write set a flag and left the strokes in React
 * state — so a scorer behind the 12th with no signal, who then locked their
 * phone or let the tab be evicted, lost the holes they had entered. Not
 * delayed: LOST, with a card that still looked filled in until it reloaded.
 *
 * That is the most damaging failure this app can have. A wrong number can be
 * corrected by anybody who was there; a hole nobody recorded is gone, and the
 * player finds out at the scorer's table.
 *
 * So the rule is: **the local copy is written before the network is tried, and
 * cleared only when the server has confirmed.** Everything here decides what to
 * do with that copy and what to tell the person holding the phone.
 *
 * WHAT THIS IS NOT. It is not a sync engine and does not merge anything. The
 * card is written whole, so a queued card replaces what the server holds — see
 * `staleAgainst` below, which is about noticing that rather than resolving it.
 * Merging needs the server to say what it had, and that is a later change.
 */

/** How long a queued card may sit before the wording stops being reassuring. */
export const NAG_AFTER_MS = 120_000;

/** Between retries. Long enough not to burn battery hunting for a signal. */
export const RETRY_EVERY_MS = 15_000;

/**
 * What one attempt to send actually did.
 *
 * There are THREE outcomes, and the type exists because the code was written as
 * if there were two. A send could resolve (taken) or throw (retry) — so a
 * conflict, where the server answers and deliberately does not take the card,
 * had nowhere to go. It resolved, which the caller read as success: the device
 * copy was deleted and the queue cleared while the chooser was still on screen,
 * leaving the scorer's holes in React state and nowhere else.
 *
 * `held` is that third outcome. The server was reached and said no for a reason
 * a person has to settle, so the copy stays on the phone and retrying is
 * pointless until somebody decides.
 */
export type SendOutcome = "sent" | "held";

export interface PendingState {
  /** Holes typed and not yet confirmed by the server. */
  queued: boolean;
  /** A request is in flight right now. */
  sending: boolean;
  /** The browser's view of connectivity. */
  online: boolean;
  /** How long the oldest unsent change has been waiting, in ms. */
  waitingMs: number;
  /** The last attempt came back with an error the server chose to send. */
  refused: boolean;
  /**
   * The server answered and did not take the card — a conflict awaiting a
   * person. Distinct from `refused`, which is the server saying no for a reason
   * nobody can act on here (a locked card, a closed round).
   */
  held: boolean;
}

export type SyncTone = "idle" | "working" | "queued" | "warn";

export interface SyncStatus {
  tone: SyncTone;
  label: string;
  /**
   * Whether it is safe to walk away. The single most important thing on the
   * screen: a scorer needs to know whether their holes are somewhere other
   * than this phone before they put it in a pocket.
   */
  safeToLeave: boolean;
}

export function syncStatus(s: PendingState): SyncStatus {
  if (s.held) {
    /**
     * Checked FIRST, and it must never read as saved.
     *
     * This state used to be indistinguishable from a clean save: the status
     * line said "Saved", tone idle, while the card sat unsent and the device
     * copy had already been deleted. A scorer reading that puts the phone in
     * their pocket, which is the one thing that loses the holes for good.
     */
    return {
      tone: "warn",
      label: "This card also changed elsewhere — choose which to keep. Your holes are still on this phone.",
      safeToLeave: false,
    };
  }

  if (s.refused) {
    // The server understood and said no — a locked card, a closed round.
    // Retrying cannot fix it, so the wording must not promise that it will.
    return {
      tone: "warn",
      label: "This card wouldn't save. Show it to the committee before you sign.",
      safeToLeave: false,
    };
  }

  if (!s.queued) {
    return { tone: "idle", label: "Saved", safeToLeave: true };
  }

  if (s.sending) {
    return { tone: "working", label: "Saving…", safeToLeave: false };
  }

  if (!s.online) {
    /**
     * The case this whole file exists for, and the wording matters.
     *
     * "Failed" would be a lie — nothing has failed, and the holes are on the
     * phone. But "saved" would be a worse lie. What a scorer needs is that
     * their entry is kept and will go when the signal comes back, so they can
     * carry on scoring rather than standing still waving the phone about.
     */
    return {
      tone: "queued",
      label: "No signal — your holes are saved on this phone and will send when it returns.",
      safeToLeave: true,
    };
  }

  if (s.waitingMs >= NAG_AFTER_MS) {
    // Online, not sending, and still waiting. Something is wrong that is not
    // the golf course, and saying so is better than a spinner forever.
    return {
      tone: "warn",
      label: "Still trying to send your holes. They are kept on this phone.",
      safeToLeave: true,
    };
  }

  return { tone: "working", label: "Saving…", safeToLeave: false };
}

/** Should another attempt be made right now? */
export function shouldRetry(s: {
  queued: boolean;
  sending: boolean;
  online: boolean;
  sinceLastAttemptMs: number;
  /** A conflict is waiting on a person; replaying it just conflicts again. */
  held?: boolean;
}): boolean {
  if (s.held) return false;
  if (!s.queued || s.sending) return false;
  // Offline attempts fail instantly and cost battery for nothing. The `online`
  // event is what wakes this up, not a timer grinding away in a pocket.
  if (!s.online) return false;
  return s.sinceLastAttemptMs >= RETRY_EVERY_MS;
}

/**
 * A card's revision — derived from its CONTENT, not from a clock.
 *
 * The obvious choice is a timestamp, and `Scorecard` does not carry one, which
 * turns out to be the better outcome. A content revision answers the question
 * actually being asked: has this card's numbers changed since I read them.
 *
 * Two consequences that a timestamp gets wrong:
 *
 *   - saving the SAME strokes twice is not a conflict. A retry that already
 *     succeeded, or two people typing the same number, produces no argument to
 *     put in front of anybody;
 *   - a write that changed nothing does not invalidate everybody else's copy.
 *
 * Not cryptographic and does not need to be. It compares two values this app
 * produced a moment apart; there is no adversary, and a hole that could not be
 * distinguished from another would have to differ by a multiple of 2^32.
 */
export function cardRevision(strokes: Array<number | null>): string {
  let h = 2166136261;
  const s = JSON.stringify(strokes ?? []);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    // FNV-1a, written as shifts because Math.imul on the prime is the same
    // thing spelled less obviously.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return `r${h.toString(36)}`;
}

/**
 * Whether a queued card is about to overwrite somebody else's work.
 *
 * A card is written WHOLE, so replaying one that was typed twenty minutes ago
 * replaces whatever the server holds now — including a correction an organizer
 * made in the meantime. This does not resolve that; it detects it, so the
 * screen can ask a human instead of silently picking a winner.
 *
 * Compares the server's revision as it was when this card was last read
 * against what it is now. Equal means nobody else has touched it and the
 * replay is safe.
 */
export function staleAgainst(readAt: string, serverNow: string): boolean {
  if (!readAt || !serverNow) return false;
  return readAt !== serverNow;
}

/** Where one card's pending copy lives. One key per card, never per player. */
export function pendingKey(stageId: string, playerId: string): string {
  // Both ids, because a player has a card per ROUND and a phone may hold
  // several. Keying on the player alone would make Saturday's card overwrite
  // Sunday's the moment both were unsent.
  return `tourneyhq:pending-card:${stageId}:${playerId}`;
}
