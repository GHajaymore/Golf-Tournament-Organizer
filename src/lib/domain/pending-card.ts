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
}): boolean {
  if (!s.queued || s.sending) return false;
  // Offline attempts fail instantly and cost battery for nothing. The `online`
  // event is what wakes this up, not a timer grinding away in a pocket.
  if (!s.online) return false;
  return s.sinceLastAttemptMs >= RETRY_EVERY_MS;
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
